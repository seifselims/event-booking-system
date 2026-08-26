import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { events, orders, ticketTypes, tickets } from '@/lib/db/schema';

import { createTRPCRouter, protectedProcedure, baseProcedure} from '../init';

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

/** Lowercase, hyphenated, punctuation stripped — `slug` is globally unique. */
function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const createEventInput = z.object({
  title: z.string().min(1).max(200),
  venue: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  // Nullable, not just optional: the column is nullable, and removing a poster
  // has to be expressible. Omitted leaves it alone, `null` clears it — an
  // absent key is a no-op in `.set()`, so the two cannot share a representation.
  posterUrl: z.url().nullable().optional(),
  startsAt: z.date(),
  endsAt: z.date().optional(),
});

const updateEventInput = createEventInput.partial().extend({
  id: z.string(),
});

export const eventsRouter = createTRPCRouter({
  /** Public listing — publicly visible events only, newest first. */
  listEvents: baseProcedure.query(() =>
    db.query.events.findMany({
      orderBy: desc(events.createdAt),
      where: inArray(events.status, PUBLIC_STATUSES),
      with: {
        ticketTypes: true,
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
      },
    }),
  ),

  getEvent: baseProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const event = await db.query.events.findFirst({
        where: and(
          eq(events.id, input.id),
          inArray(events.status, PUBLIC_STATUSES),
        ),
        with: {
          ticketTypes: true,
        },
      });

      if (!event) throw new TRPCError({ code: 'NOT_FOUND' });

      return event;
    }),

  createEvent: protectedProcedure
    .input(createEventInput)
    .mutation(async ({ ctx, input }) => {
      const { title, ...rest } = input;

      const [event] = await db
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

      return event;
    }),

  updateEvent: protectedProcedure
    .input(updateEventInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;

      const [event] = await db
        .update(events)
        .set(changes)
        .where(ownsEvent(id, ctx.user.id, ctx.user.role === 'admin'))
        .returning();

      if (!event) throw new TRPCError({ code: 'NOT_FOUND' });

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
    // deleteEvent: protectedProcedure
    // .input(z.object({ id: z.string() }))
    // .mutation(async ({ ctx, input }) => {
    //   const [event] = await db
    //     .delete(events)
    //     .where(ownsEvent(input.id, ctx.user.id, ctx.user.role === 'admin'))
    //     .returning();

    //   if (!event) throw new TRPCError({ code: 'NOT_FOUND' });

    //   return { id: event.id };
    // }),
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

      return event;
    }),
});
