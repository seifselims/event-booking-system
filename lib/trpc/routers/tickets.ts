import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { events, orderItems, orders, ticketTypes } from '@/lib/db/schema';

import { createTRPCRouter, baseProcedure, protectedProcedure } from '../init';

/** Any Drizzle connection — the db itself, or a transaction handle. */
type DB = typeof db;
type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
type Conn = DB | Tx;

/**
 * Remaining tickets per type for one event, derived (spec §5.3) — there is no
 * `remaining` column. Inventory counts as taken when an order is `paid`, or
 * `pending` with a hold that has not yet expired.
 *
 * Never trust this at purchase time: §6.1 recomputes it under a row lock.
 */
async function availabilityByType(conn: Conn, eventId: string) {
  const rows = await conn
    .select({
      ticketTypeId: ticketTypes.id,
      quantity: ticketTypes.quantity,
      taken: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)::int`,
    })
    .from(ticketTypes)
    .leftJoin(orderItems, eq(orderItems.ticketTypeId, ticketTypes.id))
    .leftJoin(
      orders,
      and(
        eq(orders.id, orderItems.orderId),
        sql`(${orders.status} = 'paid' OR (${orders.status} = 'pending' AND ${orders.holdExpiresAt} > now()))`,
      ),
    )
    .where(eq(ticketTypes.eventId, eventId))
    .groupBy(ticketTypes.id, ticketTypes.quantity);

  return rows.map((row) => ({
    ticketTypeId: row.ticketTypeId,
    quantity: row.quantity,
    taken: row.taken,
    available: row.quantity - row.taken,
  }));
}

/**
 * Point `events.status` at what availability actually says, in both directions:
 * `active` -> `sold_out` when nothing is left, and back to `active` when a
 * refund or an expired hold frees inventory up again.
 *
 * `sold_out` is a display convenience, not a source of truth — the event is
 * still happening, so it stays listed publicly. Availability itself is always
 * derived. Call this from inside the §6.1 purchase transaction, passing that
 * transaction as `conn`, so the ticket-type rows are already locked and no
 * other write can land between the count and the status update.
 *
 * Only `active` and `sold_out` are touched; `draft`, `cancelled`, and
 * `archived` are organizer decisions and are left alone.
 */
export async function syncSoldOut(conn: Conn, eventId: string) {
  const availability = await availabilityByType(conn, eventId);

  // An event with no ticket types is not sold out, it is unconfigured.
  if (availability.length === 0) return null;

  const soldOut = availability.every((type) => type.available <= 0);
  const next = soldOut ? 'sold_out' : 'active';

  const [updated] = await conn
    .update(events)
    .set({ status: next })
    .where(
      and(
        eq(events.id, eventId),
        // Re-check inside the UPDATE so a concurrent organizer edit to
        // `draft`/`cancelled`/`archived` is never silently overwritten.
        sql`${events.status} IN ('active', 'sold_out')`,
      ),
    )
    .returning();

  return updated ?? null;
}

/** Ticket types belong to an event; ownership is checked on that event. */
async function assertOwnsEvent(
  eventId: string,
  organizerId: string,
  isAdmin: boolean,
) {
  const event = await db.query.events.findFirst({
    columns: { id: true },
    where: isAdmin
      ? eq(events.id, eventId)
      : and(eq(events.id, eventId), eq(events.organizerId, organizerId)),
  });

  if (!event) throw new TRPCError({ code: 'NOT_FOUND' });

  return event;
}

/** Resolve the owning event for a ticket type, then check ownership of it. */
async function assertOwnsTicketType(
  ticketTypeId: string,
  organizerId: string,
  isAdmin: boolean,
) {
  const ticketType = await db.query.ticketTypes.findFirst({
    columns: { id: true, eventId: true },
    where: eq(ticketTypes.id, ticketTypeId),
  });

  if (!ticketType) throw new TRPCError({ code: 'NOT_FOUND' });

  await assertOwnsEvent(ticketType.eventId, organizerId, isAdmin);

  return ticketType;
}

const createTicketTypeInput = z.object({
  eventId: z.string(),
  name: z.string().min(1).max(100),
  pricePiastres: z.int().min(0),
  quantity: z.int().min(1),
  maxPerOrder: z.int().min(1).max(100).optional(),
  salesStartAt: z.date().optional(),
  salesEndAt: z.date().optional(),
});

const updateTicketTypeInput = createTicketTypeInput
  .omit({ eventId: true })
  .partial()
  .extend({ id: z.string() });

export const ticketsRouter = createTRPCRouter({
  /** Live remaining count for the public event page (spec §5.3). */
  availability: baseProcedure
    .input(z.object({ eventId: z.string() }))
    .query(({ input }) => availabilityByType(db, input.eventId)),

  listTicketTypes: protectedProcedure
    .input(z.object({ eventId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOwnsEvent(
        input.eventId,
        ctx.user.id,
        ctx.user.role === 'admin',
      );

      return db.query.ticketTypes.findMany({
        where: eq(ticketTypes.eventId, input.eventId),
      });
    }),

  createTicketType: protectedProcedure
    .input(createTicketTypeInput)
    .mutation(async ({ ctx, input }) => {
      await assertOwnsEvent(
        input.eventId,
        ctx.user.id,
        ctx.user.role === 'admin',
      );

      const [ticketType] = await db
        .insert(ticketTypes)
        .values({ id: randomUUID(), ...input })
        .returning();

      // Adding inventory to a sold-out event puts it back on sale.
      await syncSoldOut(db, input.eventId);

      return ticketType;
    }),

  updateTicketType: protectedProcedure
    .input(updateTicketTypeInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;

      const existing = await assertOwnsTicketType(
        id,
        ctx.user.id,
        ctx.user.role === 'admin',
      );

      const [ticketType] = await db
        .update(ticketTypes)
        .set(changes)
        .where(eq(ticketTypes.id, id))
        .returning();

      // Raising or lowering `quantity` can cross the sold-out line either way.
      await syncSoldOut(db, existing.eventId);

      return ticketType;
    }),

  /**
   * Remove a tier that was never sold.
   *
   * `order_items.ticket_type_id` and `tickets.ticket_type_id` reference this
   * table *without* `onDelete: cascade`, so a tier with sales cannot be deleted
   * — the FK would reject it, and orphaning an issued ticket from the tier that
   * priced it would lose the record of what someone actually bought. The check
   * lives here rather than only in the UI because a procedure is reachable
   * without ever rendering its page.
   */
  deleteTicketType: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await assertOwnsTicketType(
        input.id,
        ctx.user.id,
        ctx.user.role === 'admin',
      );

      const [sold] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(orderItems)
        .where(eq(orderItems.ticketTypeId, input.id));

      if (sold.count > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'This tier has already sold tickets and cannot be deleted. Set its quantity to what has sold to stop further sales.',
        });
      }

      await db.delete(ticketTypes).where(eq(ticketTypes.id, input.id));

      // The event may have been sold out only because this tier was exhausted.
      await syncSoldOut(db, existing.eventId);

      return { id: input.id, eventId: existing.eventId };
    }),
});
