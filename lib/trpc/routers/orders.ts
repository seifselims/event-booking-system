import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { deriveOrderToken } from '@/lib/checkout';
import { db } from '@/lib/db';
import { events, orderItems, orders } from '@/lib/db/schema';
import { MAX_TICKETS_PER_EVENT } from '@/lib/orders';

import { createTRPCRouter, rateLimitedProcedure } from '../init';
import { IS_PAST, PUBLIC_STATUSES } from './events';
import { availabilityByType, syncSoldOut, type Conn } from './tickets';

/** How long a pending order holds its inventory (spec §6.2). */
const HOLD_MINUTES = 10;

/**
 * The most distinct tiers one order may span.
 *
 * Not a product rule — a bound on how many rows a single transaction locks, so
 * one request cannot hold a large slice of an event's inventory while it works.
 */
const MAX_LINES = 10;

/**
 * How many live holds one email may have across the whole platform.
 *
 * **This is the durable half of the rate limit, and the one that matters.**
 * Holds are free, need nothing but an address, and freeze inventory for ten
 * minutes — so a script with fifty disposable addresses can make a two-hundred
 * seat event unbuyable indefinitely at zero cost, from one laptop.
 *
 * `MAX_TICKETS_PER_EVENT` caps one address on one *event*; this closes the hole
 * where four tickets each across fifty events freezes two hundred seats while
 * breaking no existing rule. Checked in Postgres — the one store every instance
 * shares — because the in-process limiter in `lib/rate-limit.ts` resets on every
 * cold start and multiplies by the instance count.
 */
const MAX_CONCURRENT_HOLDS = 3;

const createOrderInput = z.object({
  eventId: z.string(),
  buyerName: z.string().trim().min(1).max(120),
  // Stored on the order and used for the ticket email — and, in the §6.3
  // refund branch, to apologise to someone whose payment we could not honour.
  buyerEmail: z.email().max(254),
  items: z
    .array(
      z.object({
        ticketTypeId: z.string(),
        quantity: z.int().min(1),
      }),
    )
    .min(1)
    .max(MAX_LINES)
    // One tier per line: two lines naming the same tier would each be checked
    // against the full remaining count and could together exceed it.
    .refine(
      (items) =>
        new Set(items.map((item) => item.ticketTypeId)).size === items.length,
      { message: 'Each ticket type may appear only once.' },
    )
    // A cheap upper bound, so an obviously over-sized order is refused before
    // any row is locked. It is *not* the real check: the ceiling counts what
    // this buyer already holds for the event, which needs a read inside the
    // transaction (see `heldForEvent`).
    .refine(
      (items) =>
        items.reduce((sum, item) => sum + item.quantity, 0) <=
        MAX_TICKETS_PER_EVENT,
      {
        message: `You can buy at most ${MAX_TICKETS_PER_EVENT} tickets for one event.`,
      },
    ),
});

/**
 * How many tickets this email already holds for this event.
 *
 * Counts the same orders inventory does (§5.3): `paid`, plus `pending` whose
 * hold has not lapsed. An abandoned checkout therefore stops counting against
 * the buyer at the same moment it stops counting against availability, so the
 * two can never disagree about what is outstanding. `expired` and `refunded`
 * orders release the allowance.
 *
 * **The enforcing call must be inside the purchase transaction.** Read outside
 * it, two concurrent orders from one address would each miss the other's
 * uncommitted rows and both pass — the §6.1 race, wearing a different hat.
 * `remainingAllowance` below reads it outside a transaction on purpose: that one
 * only paints a number, and `createOrder` re-checks under the lock regardless.
 *
 * Email is compared case-insensitively: addresses are not case-sensitive in
 * practice, and `Sam@x.com` must not reset `sam@x.com`'s allowance.
 */
async function heldForEvent(
  conn: Conn,
  eventId: string,
  buyerEmail: string,
) {
  const [row] = await conn
    .select({
      tickets: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)::int`,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orders.eventId, eventId),
        sql`LOWER(${orders.buyerEmail}) = LOWER(${buyerEmail})`,
        sql`(${orders.status} = 'paid' OR (${orders.status} = 'pending' AND ${orders.holdExpiresAt} > now()))`,
      ),
    );

  return row?.tickets ?? 0;
}

/**
 * How many live pending holds this email has, across every event.
 *
 * The inventory-freeze defence (see `MAX_CONCURRENT_HOLDS`). Called inside the
 * purchase transaction beside `heldForEvent`, for the same reason: read outside
 * it, concurrent requests from one address each miss the other's uncommitted
 * rows and all pass.
 *
 * Only *live* holds count — an abandoned checkout stops counting against the
 * buyer the moment its hold lapses, exactly as it stops counting against
 * availability. Uses the existing `orders_buyerEmail_idx`.
 */
async function livePendingHolds(conn: Conn, buyerEmail: string) {
  const [row] = await conn
    .select({ held: sql<number>`COUNT(*)::int` })
    .from(orders)
    .where(
      and(
        sql`LOWER(${orders.buyerEmail}) = LOWER(${buyerEmail})`,
        eq(orders.status, 'pending'),
        sql`${orders.holdExpiresAt} > now()`,
      ),
    );

  return row?.held ?? 0;
}

/**
 * Create a pending order holding its tickets for ten minutes (spec §6.1, §7.1
 * step 2).
 *
 * **This is the procedure the oversell problem lives in.** Everything about its
 * shape is that: it locks the ticket-type rows it is about to sell, recomputes
 * availability *while holding those locks*, and only then writes. A check made
 * before the lock — however correct at the instant it ran — is worthless, because
 * every concurrent request would pass its own check before any of them wrote.
 *
 * `baseProcedure`: buyers are guests with no account (spec §2), so there is no
 * session to scope this by. That makes every input hostile — nothing here trusts
 * a price, a total, or an availability number from the client. Prices are read
 * from the locked rows and the total is summed server-side.
 *
 * Returns the order id and `holdExpiresAt`; creating the Stripe Checkout Session
 * is the next step and deliberately does not happen here. A hold that exists
 * without a payment attempt simply expires, which is the harmless direction —
 * whereas a payment against an order that failed to commit is not.
 */
export const ordersRouter = createTRPCRouter({
  /**
   * How many more tickets this email may buy for this event.
   *
   * Lets the selector clamp its steppers to the buyer's *real* remaining
   * allowance instead of the full four, so someone who already holds two is
   * never walked into a refusal on submit.
   *
   * Returns a bare number and nothing else. The input is an arbitrary email on
   * a public procedure, so anything richer — a name, an order id, a history —
   * would let anyone probe who has tickets to what. The count alone still
   * discloses *whether* an address holds tickets for a given event, which is
   * why it is deliberately the only thing here.
   *
   * Display only. It reads outside a transaction and is stale the moment it
   * returns; `createOrder` re-derives it under the row lock, which is the
   * number that decides anything.
   */
  // Rate-limited because the input is an arbitrary email: without a ceiling
  // this is an enumeration oracle, telling a scripted wordlist which addresses
  // hold tickets for a given event, one bit at a time.
  remainingAllowance: rateLimitedProcedure('allowance', 20, 60_000)
    .input(
      z.object({ eventId: z.string(), buyerEmail: z.email().max(254) }),
    )
    .query(async ({ input }) => {
      const held = await heldForEvent(db, input.eventId, input.buyerEmail);

      return {
        remaining: Math.max(0, MAX_TICKETS_PER_EVENT - held),
      };
    }),

  // Two layers of limit. This one is per-IP and in-process — it stops a naive
  // loop and a double-submit. The one that actually holds is
  // `livePendingHolds`, inside the transaction below.
  createOrder: rateLimitedProcedure('createOrder', 10, 60_000)
    .input(createOrderInput)
    .mutation(async ({ input }) => {
      // Judged by exactly the public visibility rule, so a buyer cannot hold a
      // seat on a draft, cancelled, archived, or finished event by calling this
      // directly — the page guard is not the permission.
      const event = await db.query.events.findFirst({
        columns: { id: true },
        where: and(
          eq(events.id, input.eventId),
          inArray(events.status, PUBLIC_STATUSES),
          sql`NOT ${IS_PAST}`,
        ),
      });

      if (!event) throw new TRPCError({ code: 'NOT_FOUND' });

      const ids = input.items.map((item) => item.ticketTypeId);

      return db.transaction(async (tx) => {
        // 1. Lock every tier this order touches, in a deterministic order.
        //
        // Sorting is what makes deadlock structurally impossible: two orders
        // spanning tiers [X, Y] and [Y, X] would otherwise each hold one and
        // wait on the other forever. Sorted, every transaction acquires the
        // same locks in the same sequence.
        //
        // Raw SQL because Drizzle's query builder has no `FOR UPDATE`.
        //
        // `IN (...)` with one bound parameter per id, **not** `= ANY($1::text[])`:
        // Drizzle flattens a JS array into a single scalar parameter, so
        // Postgres receives one string where it expects an array literal and
        // fails with `22P02 malformed array literal`. `sql.join` expands to one
        // placeholder per id, so the values are still bound — never interpolated
        // into the statement text.
        const locked = await tx.execute(sql`
          SELECT id, event_id, name, price_piastres, max_per_order,
                 sales_start_at, sales_end_at
          FROM ticket_types
          WHERE id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})
          ORDER BY id
          FOR UPDATE
        `);

        const tiers = new Map(
          (locked.rows as LockedTier[]).map((row) => [row.id, row]),
        );

        // An id that matched nothing is a bad request, not a sold-out tier.
        if (tiers.size !== ids.length) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        // 2. Recompute availability now that the rows are locked. Reusing the
        //    same derivation the public page displayed, passed `tx` so it reads
        //    inside this transaction rather than around it.
        const availability = await availabilityByType(tx, input.eventId);
        const availableById = new Map(
          availability.map((row) => [row.ticketTypeId, row.available]),
        );

        // 3. Enforce the per-buyer ceiling against what this email *already*
        //    holds for the event. Inside the transaction for the same reason
        //    availability is: two orders racing from one address would each
        //    read the other as absent.
        // The inventory-freeze ceiling, checked under the same lock. An address
        // sitting on three live holds across the platform is not a buyer having
        // trouble deciding; it is the shape of a script parking seats.
        const openHolds = await livePendingHolds(tx, input.buyerEmail);

        if (openHolds >= MAX_CONCURRENT_HOLDS) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: `You already have ${openHolds} checkouts open. Finish or cancel one before starting another.`,
          });
        }

        const alreadyHeld = await heldForEvent(
          tx,
          input.eventId,
          input.buyerEmail,
        );
        const remainingAllowance = MAX_TICKETS_PER_EVENT - alreadyHeld;
        const requested = input.items.reduce(
          (sum, item) => sum + item.quantity,
          0,
        );

        if (requested > remainingAllowance) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              remainingAllowance <= 0
                ? `You already have ${MAX_TICKETS_PER_EVENT} tickets for this event, which is the maximum.`
                : `You can buy ${remainingAllowance} more ticket${remainingAllowance === 1 ? '' : 's'} for this event — the limit is ${MAX_TICKETS_PER_EVENT} per person.`,
          });
        }

        const lines = input.items.map((item) => {
          const tier = tiers.get(item.ticketTypeId)!;

          // Every tier must belong to the event named in the input. Without
          // this, one event's id could be paired with another's cheap tier.
          if (tier.event_id !== input.eventId) {
            throw new TRPCError({ code: 'BAD_REQUEST' });
          }

          const now = new Date();

          if (tier.sales_start_at && tier.sales_start_at > now) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: `${tier.name} isn't on sale yet.`,
            });
          }

          if (tier.sales_end_at && tier.sales_end_at < now) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: `Sales for ${tier.name} have closed.`,
            });
          }

          // The organizer's cap can only ever be stricter than the platform's:
          // a tier set to 10 is still bound by `MAX_TICKETS_PER_EVENT`. The
          // whole-order total is already checked against the buyer's remaining
          // allowance above; this catches a tier that limits itself further.
          const tierCap = Math.min(tier.max_per_order, MAX_TICKETS_PER_EVENT);

          if (item.quantity > tierCap) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: `You can buy at most ${tierCap} ${tier.name} per order.`,
            });
          }

          const available = availableById.get(item.ticketTypeId) ?? 0;

          if (available < item.quantity) {
            throw new TRPCError({
              code: 'CONFLICT',
              message:
                available <= 0
                  ? `${tier.name} just sold out.`
                  : `Only ${available} ${tier.name} left.`,
            });
          }

          return {
            ticketTypeId: item.ticketTypeId,
            quantity: item.quantity,
            // Priced from the locked row, never from the client. The tier's
            // price could have changed since the page was rendered, and the
            // order must record what was actually charged.
            unitPricePiastres: tier.price_piastres,
          };
        });

        const totalPiastres = lines.reduce(
          (sum, line) => sum + line.unitPricePiastres * line.quantity,
          0,
        );

        // 4. Write the hold. Committing releases the locks.
        const orderId = randomUUID();
        const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);

        const [order] = await tx
          .insert(orders)
          .values({
            id: orderId,
            eventId: input.eventId,
            buyerName: input.buyerName,
            buyerEmail: input.buyerEmail,
            status: 'pending',
            totalPiastres,
            holdExpiresAt,
          })
          .returning();

        await tx.insert(orderItems).values(
          lines.map((line) => ({
            id: randomUUID(),
            orderId,
            ticketTypeId: line.ticketTypeId,
            quantity: line.quantity,
            unitPricePiastres: line.unitPricePiastres,
          })),
        );

        // This hold may have taken the last seat. `syncSoldOut` runs inside the
        // transaction, as its docstring requires, so the count it reads includes
        // the rows just written and no other write can land between the two.
        await syncSoldOut(tx, input.eventId);

        return {
          orderId: order.id,
          holdExpiresAt: order.holdExpiresAt,
          totalPiastres: order.totalPiastres,
          // Returned once, here, so the buyer can reach their own checkout and
          // ticket pages. Derived from the id (`lib/checkout.ts`), so this is a
          // convenience for the client rather than a secret being minted — but
          // it is the only time the flow hands it over, and every mutation on
          // the order requires it back.
          token: deriveOrderToken(order.id),
        };
      });
    }),
});

/** One `ticket_types` row as returned by the raw locking SELECT. */
type LockedTier = {
  id: string;
  event_id: string;
  name: string;
  price_piastres: number;
  max_per_order: number;
  sales_start_at: Date | null;
  sales_end_at: Date | null;
};
