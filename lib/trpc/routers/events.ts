import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';

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
  posterUrl: z.url().optional(),
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
