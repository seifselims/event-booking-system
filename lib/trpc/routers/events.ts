import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';

import { deleteOwnBlob, isOwnBlobUrl } from '@/lib/blob';
import { EVENT_CATEGORIES } from '@/lib/categories';
import { db } from '@/lib/db';
import { events, orders, ticketTypes, tickets, user } from '@/lib/db/schema';

import {
  createTRPCRouter,
  protectedProcedure,
  organizerProcedure,
  baseProcedure,
} from '../init';

/**
 * Restrict a query to the caller's own events. Admins see every organizer's
 * events (spec §8), so the ownership clause is dropped for them.
 */
function ownsEvent(eventId: string, organizerId: string, isAdmin: boolean) {
  return isAdmin
    ? eq(events.id, eventId)
    : and(eq(events.id, eventId), eq(events.organizerId, organizerId));
}

/**
 * Statuses the public site shows. `sold_out` stays listed — the event is still
 * happening, there is just nothing left to buy.
 */
const PUBLIC_STATUSES = ['active', 'sold_out'] as const;

/**
 * The only `user` columns a public procedure may return.
 *
 * `user` also carries `email` and `role`; neither belongs on a page anyone can
 * load. Declared once so every public read of an organizer selects the same
 * three, rather than each call site being trusted to remember.
 */
const PUBLIC_ORGANIZER_COLUMNS = {
  id: true,
  name: true,
  image: true,
} as const;

/**
 * Events are shown in the venue's local time (`lib/format.ts`), so "tonight"
 * is the rest of the current *Cairo* day, not the server's or the viewer's.
 *
 * The bounds are computed by Postgres rather than in JS: `AT TIME ZONE` gives
 * the same answer regardless of the container's zone, and midnight lands on the
 * right instant across DST without a date library.
 */
const TONIGHT_ZONE = 'Africa/Cairo';

/** Start of the next Cairo day, as a `timestamptz`. */
const CAIRO_DAY_END = sql`((date_trunc('day', now() AT TIME ZONE ${TONIGHT_ZONE}) + interval '1 day') AT TIME ZONE ${TONIGHT_ZONE})`;

/**
 * Delete a poster that an event has stopped using — unless another event is
 * still pointing at it.
 *
 * The same URL can legitimately sit on two rows: `poster_url` accepts pasted
 * links, so an organizer can copy an existing event's poster URL into a second
 * event. Deleting on the first event's save would then blank the second one's
 * artwork with no way to recover it, so the file is only released once nothing
 * references it. Uploads carry a random suffix and are therefore unique, which
 * makes this rare — but it is silent and unrecoverable when it happens.
 */
async function releasePoster(url: string, exceptEventId: string) {
  if (!isOwnBlobUrl(url)) return;

  const stillUsed = await db.query.events.findFirst({
    columns: { id: true },
    where: and(eq(events.posterUrl, url), ne(events.id, exceptEventId)),
  });

  if (stillUsed) return;

  await deleteOwnBlob(url);
}

/**
 * Has this event already happened?
 *
 * Auto-archiving is *derived*, not written: nothing sweeps `events.status` when
 * a date passes, because there is no job runner yet (see
 * `docs/DEFERRED-JOBS.md`). Instead every read that cares computes it, which
 * needs no scheduler and can never fight an organizer's own status choice.
 *
 * `endsAt` wins when set — a festival that runs past midnight is not "past"
 * because its doors opened yesterday. Falls back to `startsAt` otherwise.
 *
 * Evaluated by Postgres so it does not depend on the container's clock, the
 * same reasoning as `CAIRO_DAY_END` above.
 */
const IS_PAST = sql<boolean>`(COALESCE(${events.endsAt}, ${events.startsAt}) < now())`;

/** Lowercase, hyphenated, punctuation stripped — `slug` is globally unique. */
function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** An event cannot finish before it starts. Shared by both write paths. */
const ENDS_BEFORE_STARTS = 'The end time must be after the start time.';

const createEventInput = z
  .object({
    title: z.string().min(1).max(200),
    venue: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    // Nullable, not just optional: the column is nullable, and removing a poster
    // has to be expressible. Omitted leaves it alone, `null` clears it — an
    // absent key is a no-op in `.set()`, so the two cannot share a representation.
    posterUrl: z.url().nullable().optional(),
    // Omitted falls through to the column default (`other`), so an organizer
    // who skips the picker still gets a categorised event.
    category: z.enum(EVENT_CATEGORIES).optional(),
    startsAt: z.date(),
    endsAt: z.date().optional(),
  })
  .refine((input) => !input.endsAt || input.endsAt > input.startsAt, {
    message: ENDS_BEFORE_STARTS,
    path: ['endsAt'],
  });

/**
 * `.partial()` cannot carry the refine above: on an update either date may be
 * absent, and the one that is missing has to come from the stored row. The
 * cross-field check therefore lives in the `updateEvent` mutation, which can
 * read the event first.
 */
const updateEventInput = z
  .object({
    title: z.string().min(1).max(200),
    venue: z.string().min(1).max(200),
    description: z.string().max(5000),
    posterUrl: z.url().nullable(),
    category: z.enum(EVENT_CATEGORIES),
    startsAt: z.date(),
    endsAt: z.date().nullable(),
  })
  .partial()
  .extend({ id: z.string() });

/**
 * A first tier, created alongside its event.
 *
 * Deliberately narrower than `createTicketTypeInput` in `routers/tickets.ts`:
 * no `eventId` (the event does not exist yet), and no sales window — an
 * organizer setting up a new event is choosing what to sell, not scheduling
 * when it goes on sale. The full set is available in the editor afterwards.
 */
const initialTierInput = z.object({
  name: z.string().min(1).max(100),
  pricePiastres: z.int().min(0),
  quantity: z.int().min(1),
  maxPerOrder: z.int().min(1).max(100).optional(),
});

const createEventWithTiersInput = createEventInput.safeExtend({
  // Optional: an organizer may create the shell now and price it later, which
  // is exactly what `draft` is for.
  tiers: z.array(initialTierInput).max(10).optional(),
  // Publish straight away, or keep it a draft. Only these two: `cancelled` and
  // `archived` are not states you create something in, and `sold_out` is
  // derived from availability, never chosen.
  status: z.enum(['draft', 'active']).default('draft'),
});

export const eventsRouter = createTRPCRouter({
  /** Public listing — publicly visible events only, newest first. */
  listEvents: baseProcedure.query(() =>
    db.query.events.findMany({
      orderBy: desc(events.createdAt),
      // Past events drop off the public site without anyone archiving them —
      // this is the derived half of auto-archive (see `IS_PAST`).
      where: and(inArray(events.status, PUBLIC_STATUSES), sql`NOT ${IS_PAST}`),
      with: {
        ticketTypes: true,
        // Named columns, never the whole row: `user` also holds `email` and
        // `role`, and this is a public procedure.
        organizer: { columns: PUBLIC_ORGANIZER_COLUMNS },
      },
    }),
  ),

  /**
   * The nav's "Tonight" — publicly visible events starting between now and
   * midnight in Cairo, soonest first.
   *
   * Doors that have already opened are dropped: `startsAt >= now()` keeps the
   * list to things you can still turn up for.
   */
  listTonight: baseProcedure.query(() =>
    db.query.events.findMany({
      orderBy: asc(events.startsAt),
      where: and(
        inArray(events.status, PUBLIC_STATUSES),
        gte(events.startsAt, sql`now()`),
        lt(events.startsAt, CAIRO_DAY_END),
      ),
      with: {
        ticketTypes: true,
        organizer: { columns: PUBLIC_ORGANIZER_COLUMNS },
      },
    }),
  ),

  /**
   * The public organizer index — everyone with something on sale.
   *
   * Organizers with nothing publicly visible are excluded rather than listed
   * empty: an `innerJoin` on the same predicate the rack uses means a card can
   * never lead to a page with no events on it.
   *
   * Ordered by soonest door rather than by event count, so the grid leads with
   * whoever has something happening next.
   */
  listOrganizers: baseProcedure.query(() =>
    db
      .select({
        id: user.id,
        name: user.name,
        image: user.image,
        events: sql<number>`COUNT(${events.id})::int`,
        // `.mapWith(events.startsAt)` rather than a bare `sql<Date>`: that type
        // parameter is an unchecked assertion, and an aggregate does not carry
        // the column's decoder, so the driver would hand back whatever it
        // parses a bare timestamptz as. `formatEventDate` calls
        // `Intl.DateTimeFormat` on this, which needs a real Date.
        nextStartsAt: sql`MIN(${events.startsAt})`.mapWith(events.startsAt),
      })
      .from(user)
      .innerJoin(
        events,
        and(
          eq(events.organizerId, user.id),
          inArray(events.status, PUBLIC_STATUSES),
          sql`NOT ${IS_PAST}`,
        ),
      )
      .where(eq(user.role, 'organizer'))
      .groupBy(user.id)
      .orderBy(asc(sql`MIN(${events.startsAt})`)),
  ),

  /**
   * One organizer's public page: who they are, and everything of theirs still
   * on sale — soonest first.
   *
   * Same visibility rule as `listEvents`, so a draft never reaches this page.
   * An organizer with nothing visible throws `NOT_FOUND` rather than rendering
   * an empty shelf, which keeps this consistent with `listOrganizers` never
   * offering them a card in the first place.
   */
  getOrganizer: baseProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const organizer = await db.query.user.findFirst({
        columns: PUBLIC_ORGANIZER_COLUMNS,
        where: and(eq(user.id, input.id), eq(user.role, 'organizer')),
      });

      if (!organizer) throw new TRPCError({ code: 'NOT_FOUND' });

      const organizerEvents = await db.query.events.findMany({
        orderBy: asc(events.startsAt),
        where: and(
          eq(events.organizerId, input.id),
          inArray(events.status, PUBLIC_STATUSES),
          sql`NOT ${IS_PAST}`,
        ),
        with: {
          ticketTypes: true,
          organizer: { columns: PUBLIC_ORGANIZER_COLUMNS },
        },
      });

      if (organizerEvents.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      return { ...organizer, events: organizerEvents };
    }),

  getEvent: baseProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const event = await db.query.events.findFirst({
        where: and(
          eq(events.id, input.id),
          inArray(events.status, PUBLIC_STATUSES),
          // Consistent with `listEvents`: a past event is gone from the public
          // site, so its page 404s rather than offering tickets to a finished
          // door.
          sql`NOT ${IS_PAST}`,
        ),
        with: {
          ticketTypes: true,
        },
      });

      if (!event) throw new TRPCError({ code: 'NOT_FOUND' });

      return event;
    }),

  /**
   * Create an event, optionally with its first ticket tiers.
   *
   * Both writes share one transaction: `ticket_types.event_id` is a foreign key,
   * so the tiers cannot exist before the event — and a tier that fails to insert
   * must not leave a priced-but-empty event behind. Either the whole event
   * arrives configured or nothing does.
   *
   * The event lands as `draft` (the column default), so creating it never
   * publishes it. Publishing is a separate, deliberate act in the editor.
   *
   * `organizerProcedure`, not `protectedProcedure`: this is the one event action
   * an admin is refused outright. `organizerId` is stamped from the session, so
   * an admin creating an event would make *themselves* its organizer — platform
   * oversight should not mint events it then owns. Admins still edit and delete
   * any organizer's events through the widening procedures below.
   */
  createEvent: organizerProcedure
    .input(createEventWithTiersInput)
    .mutation(async ({ ctx, input }) => {
      const { title, tiers, ...rest } = input;

      // The same two preconditions the editor's status controls apply, enforced
      // here because a procedure is reachable without ever rendering that UI.
      if (rest.status === 'active') {
        if (!tiers?.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Add a ticket tier before publishing, or there is nothing to sell.',
          });
        }

        if ((rest.endsAt ?? rest.startsAt) <= new Date()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'That date has already passed, so it cannot be published.',
          });
        }
      }

      return db.transaction(async (tx) => {
        const [event] = await tx
          .insert(events)
          .values({
            id: randomUUID(),
            organizerId: ctx.user.id,
            title,
            // Suffixed because `events_slug_uidx` is unique across all organizers.
            slug: `${slugify(title)}-${randomUUID().slice(0, 8)}`,
            ...rest,
          })
          .returning();

        if (tiers?.length) {
          await tx.insert(ticketTypes).values(
            tiers.map((tier) => ({
              id: randomUUID(),
              eventId: event.id,
              ...tier,
            })),
          );
        }

        return event;
      });
    }),

  updateEvent: protectedProcedure
    .input(updateEventInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;

      const touchesDates =
        changes.startsAt !== undefined || changes.endsAt !== undefined;

      // The row as it stands. Needed to clean up a poster it is about to lose,
      // and to validate a date change against the date that isn't being sent —
      // `updateEventInput` is partial, so "ends before starts" can only be
      // judged against the stored values.
      //
      // Read inside the same ownership scope: on someone else's event this
      // comes back undefined and the UPDATE below throws NOT_FOUND anyway.
      const before =
        changes.posterUrl !== undefined || touchesDates
          ? await db.query.events.findFirst({
              columns: { posterUrl: true, startsAt: true, endsAt: true },
              where: ownsEvent(id, ctx.user.id, ctx.user.role === 'admin'),
            })
          : undefined;

      if (touchesDates && before) {
        // Whichever side isn't in this payload keeps its stored value.
        const startsAt = changes.startsAt ?? before.startsAt;
        const endsAt =
          changes.endsAt !== undefined ? changes.endsAt : before.endsAt;

        if (endsAt && endsAt <= startsAt) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: ENDS_BEFORE_STARTS,
          });
        }
      }

      const [event] = await db
        .update(events)
        .set(changes)
        .where(ownsEvent(id, ctx.user.id, ctx.user.role === 'admin'))
        .returning();

      if (!event) throw new TRPCError({ code: 'NOT_FOUND' });

      // Replaced or removed: the previous file is now unreferenced. Deleted
      // after the write, and only once it succeeded — losing the bytes while
      // the row still points at them would be worse than leaking them.
      if (before?.posterUrl && before.posterUrl !== event.posterUrl) {
        await releasePoster(before.posterUrl, id);
      }

      return event;
    }),

  /** Publish makes the event visible on the public `/e/[slug]` page. */
  setEventStatus: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['draft', 'active', 'cancelled', 'archived', 'sold_out']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [event] = await db
        .update(events)
        .set({ status: input.status })
        .where(ownsEvent(input.id, ctx.user.id, ctx.user.role === 'admin'))
        .returning();

      if (!event) throw new TRPCError({ code: 'NOT_FOUND' });

      return event;
    }),
  /**
   * Delete an event outright.
   *
   * Scoped like every other organizer query — an organizer deletes their own,
   * an admin widens to any (spec §2).
   *
   * Refused while a paid order exists. `orders.event_id` cascades, so the
   * delete would take paid orders and their issued tickets with it; the same
   * reasoning as `deleteOrganizer` and `deleteTicketType`. Cancelling or
   * archiving is the right move for an event that has sold — it keeps the
   * financial record that reconciliation (spec §9) has to balance.
   */
  deleteEvent: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const scope = ownsEvent(input.id, ctx.user.id, ctx.user.role === 'admin');

      // Read first: the poster has to be released after the row is gone, and
      // the ownership check has to happen before the paid-order count means
      // anything.
      const event = await db.query.events.findFirst({
        columns: { id: true, posterUrl: true },
        where: scope,
      });

      if (!event) throw new TRPCError({ code: 'NOT_FOUND' });

      const [{ paid }] = await db
        .select({ paid: count() })
        .from(orders)
        .where(and(eq(orders.eventId, input.id), eq(orders.status, 'paid')));

      if (paid > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `This event has ${paid} paid order(s). Cancel or archive it instead.`,
        });
      }

      const [deleted] = await db.delete(events).where(scope).returning();

      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND' });

      // Nothing references the poster now. After the delete, and never fatal —
      // a leaked file is cheaper than a delete reported as failed.
      await releasePoster(deleted.posterUrl ?? '', deleted.id);

      return { id: deleted.id };
    }),

    getMyEvents: protectedProcedure.query(({ ctx }) =>
      db.query.events.findMany({
        where:
          ctx.user.role === 'admin'
            ? undefined
            : eq(events.organizerId, ctx.user.id),
        orderBy: desc(events.createdAt),
      }),
    ),

    /**
     * The dashboard's events table: each event with its capacity, tickets sold,
     * and revenue to date. Same scoping rule as `getMyEvents` — admins see every
     * organizer's events.
     *
     * Capacity and revenue are aggregated in separate subqueries on purpose:
     * joining ticket_types and orders in one pass multiplies their rows against
     * each other, which would inflate both sums.
     */
    getMyEventsWithStats: protectedProcedure.query(({ ctx }) => {
      const isAdmin = ctx.user.role === 'admin';

      const capacity = db
        .select({
          eventId: ticketTypes.eventId,
          capacity: sql<number>`COALESCE(SUM(${ticketTypes.quantity}), 0)::int`.as(
            'capacity',
          ),
          minPrice: sql<number | null>`MIN(${ticketTypes.pricePiastres})::int`.as(
            'min_price',
          ),
          tiers: sql<number>`COUNT(*)::int`.as('tiers'),
        })
        .from(ticketTypes)
        .groupBy(ticketTypes.eventId)
        .as('capacity');

      const sales = db
        .select({
          eventId: orders.eventId,
          grossPiastres:
            sql<number>`COALESCE(SUM(${orders.totalPiastres}) FILTER (WHERE ${orders.status} = 'paid'), 0)::int`.as(
              'gross_piastres',
            ),
          paidOrders:
            sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'paid')::int`.as(
              'paid_orders',
            ),
        })
        .from(orders)
        .groupBy(orders.eventId)
        .as('sales');

      // Non-voided tickets only — a refund voids its tickets, and a voided seat
      // is back on sale, so counting it as sold would overstate the event.
      const sold = db
        .select({
          eventId: orders.eventId,
          sold: sql<number>`COUNT(*)::int`.as('sold'),
          checkedIn:
            sql<number>`COUNT(*) FILTER (WHERE ${tickets.checkedInAt} IS NOT NULL)::int`.as(
              'checked_in',
            ),
        })
        .from(tickets)
        .innerJoin(orders, eq(orders.id, tickets.orderId))
        .where(isNull(tickets.voidedAt))
        .groupBy(orders.eventId)
        .as('sold');

      return db
        .select({
          id: events.id,
          slug: events.slug,
          title: events.title,
          venue: events.venue,
          status: events.status,
          startsAt: events.startsAt,
          createdAt: events.createdAt,
          isPast: IS_PAST,
          capacity: sql<number>`COALESCE(${capacity.capacity}, 0)::int`,
          tiers: sql<number>`COALESCE(${capacity.tiers}, 0)::int`,
          minPricePiastres: capacity.minPrice,
          grossPiastres: sql<number>`COALESCE(${sales.grossPiastres}, 0)::int`,
          paidOrders: sql<number>`COALESCE(${sales.paidOrders}, 0)::int`,
          ticketsSold: sql<number>`COALESCE(${sold.sold}, 0)::int`,
          ticketsCheckedIn: sql<number>`COALESCE(${sold.checkedIn}, 0)::int`,
        })
        .from(events)
        .leftJoin(capacity, eq(capacity.eventId, events.id))
        .leftJoin(sales, eq(sales.eventId, events.id))
        .leftJoin(sold, eq(sold.eventId, events.id))
        .where(isAdmin ? undefined : eq(events.organizerId, ctx.user.id))
        .orderBy(desc(events.startsAt));
    }),

    /** Headline tiles above the dashboard table, over the same scoped set. */
    getMyTotals: protectedProcedure.query(async ({ ctx }) => {
      const isAdmin = ctx.user.role === 'admin';
      const scope = isAdmin ? undefined : eq(events.organizerId, ctx.user.id);

      const [eventCounts] = await db
        .select({
          total: sql<number>`COUNT(*)::int`,
          live: sql<number>`COUNT(*) FILTER (WHERE ${events.status} IN ('active', 'sold_out'))::int`,
          draft: sql<number>`COUNT(*) FILTER (WHERE ${events.status} = 'draft')::int`,
        })
        .from(events)
        .where(scope);

      const [revenue] = await db
        .select({
          grossPiastres: sql<number>`COALESCE(SUM(${orders.totalPiastres}) FILTER (WHERE ${orders.status} = 'paid'), 0)::int`,
          refundedPiastres: sql<number>`COALESCE(SUM(${orders.totalPiastres}) FILTER (WHERE ${orders.status} = 'refunded'), 0)::int`,
          paidOrders: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'paid')::int`,
        })
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(scope);

      const [ticketCounts] = await db
        .select({
          issued: sql<number>`COUNT(*) FILTER (WHERE ${tickets.voidedAt} IS NULL)::int`,
          checkedIn: sql<number>`COUNT(*) FILTER (WHERE ${tickets.checkedInAt} IS NOT NULL AND ${tickets.voidedAt} IS NULL)::int`,
        })
        .from(tickets)
        .innerJoin(orders, eq(orders.id, tickets.orderId))
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(scope);

      return {
        events: eventCounts.total,
        liveEvents: eventCounts.live,
        draftEvents: eventCounts.draft,
        grossPiastres: revenue.grossPiastres,
        refundedPiastres: revenue.refundedPiastres,
        netPiastres: revenue.grossPiastres - revenue.refundedPiastres,
        paidOrders: revenue.paidOrders,
        ticketsIssued: ticketCounts.issued,
        ticketsCheckedIn: ticketCounts.checkedIn,
      };
    }),
    /** Organizer-facing single fetch — unlike `getEvent`, this returns drafts. */
    getMyEvent: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const event = await db.query.events.findFirst({
        where: ownsEvent(input.id, ctx.user.id, ctx.user.role === 'admin'),
        with: {
          ticketTypes: true,
        },
      });

      if (!event) throw new TRPCError({ code: 'NOT_FOUND' });

      // Same rule as the SQL `IS_PAST`, applied in JS because the relational
      // API selects columns rather than expressions. Both compare instants, so
      // the container's zone doesn't enter into it.
      const isPast = (event.endsAt ?? event.startsAt).getTime() < Date.now();

      return { ...event, isPast };
    }),
});
