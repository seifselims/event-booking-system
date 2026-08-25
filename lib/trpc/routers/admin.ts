import { APIError } from 'better-auth/api';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { events, orders, tickets, user } from '@/lib/db/schema';

import { adminProcedure, createTRPCRouter } from '../init';

/**
 * The `/admin` surface (spec §8): a cross-organizer view of every event plus
 * platform totals.
 *
 * Deliberately nothing else. Admin *CRUD* is not here — per spec §2, "platform
 * admin is a role, not a section": admins edit and delete through the same
 * organizer procedures, which drop the ownership filter when `role = 'admin'`.
 * Duplicating those here would give the same mutations two code paths and two
 * chances to get tenant isolation wrong.
 */
export const adminRouter = createTRPCRouter({
  /** Every event, any organizer, with its organizer and revenue to date. */
  listAllEvents: adminProcedure.query(() =>
    db
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        status: events.status,
        startsAt: events.startsAt,
        createdAt: events.createdAt,
        organizerId: events.organizerId,
        organizerName: user.name,
        organizerEmail: user.email,
        // Paid orders only — pending holds are not revenue.
        grossPiastres: sql<number>`COALESCE(SUM(${orders.totalPiastres}) FILTER (WHERE ${orders.status} = 'paid'), 0)::int`,
        paidOrders: sql<number>`COUNT(DISTINCT ${orders.id}) FILTER (WHERE ${orders.status} = 'paid')::int`,
      })
      .from(events)
      .innerJoin(user, eq(user.id, events.organizerId))
      .leftJoin(orders, eq(orders.eventId, events.id))
      .groupBy(events.id, user.name, user.email)
      .orderBy(desc(events.createdAt)),
  ),

  /** Headline numbers across the whole platform. */
  platformTotals: adminProcedure.query(async () => {
    const [totals] = await db
      .select({
        events: sql<number>`COUNT(DISTINCT ${events.id})::int`,
        organizers: sql<number>`COUNT(DISTINCT ${events.organizerId})::int`,
      })
      .from(events);

    const [revenue] = await db
      .select({
        grossPiastres: sql<number>`COALESCE(SUM(${orders.totalPiastres}) FILTER (WHERE ${orders.status} = 'paid'), 0)::int`,
        refundedPiastres: sql<number>`COALESCE(SUM(${orders.totalPiastres}) FILTER (WHERE ${orders.status} = 'refunded'), 0)::int`,
        paidOrders: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'paid')::int`,
      })
      .from(orders);

    // Voided tickets belong to refunded orders and are no longer admissible.
    const [issued] = await db
      .select({
        tickets: sql<number>`COUNT(*) FILTER (WHERE ${tickets.voidedAt} IS NULL)::int`,
        checkedIn: sql<number>`COUNT(*) FILTER (WHERE ${tickets.checkedInAt} IS NOT NULL AND ${tickets.voidedAt} IS NULL)::int`,
      })
      .from(tickets);

    return {
      events: totals.events,
      organizers: totals.organizers,
      grossPiastres: revenue.grossPiastres,
      refundedPiastres: revenue.refundedPiastres,
      netPiastres: revenue.grossPiastres - revenue.refundedPiastres,
      paidOrders: revenue.paidOrders,
      ticketsIssued: issued.tickets,
      ticketsCheckedIn: issued.checkedIn,
    };
  }),

  /** Organizers ranked by revenue — the cross-organizer cut of the same data. */
  listOrganizers: adminProcedure.query(() =>
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        events: sql<number>`COUNT(DISTINCT ${events.id})::int`,
        grossPiastres: sql<number>`COALESCE(SUM(${orders.totalPiastres}) FILTER (WHERE ${orders.status} = 'paid'), 0)::int`,
      })
      .from(user)
      .leftJoin(events, eq(events.organizerId, user.id))
      .leftJoin(orders, eq(orders.eventId, events.id))
      .groupBy(user.id)
      .orderBy(
        desc(
          sql`COALESCE(SUM(${orders.totalPiastres}) FILTER (WHERE ${orders.status} = 'paid'), 0)`,
        ),
      ),
  ),

  /**
   * Provision an organizer account.
   *
   * Goes through Better Auth's `signUpEmail` rather than inserting into `user`
   * directly: that is what hashes the password with the configured algorithm
   * and writes the paired `account` row (`providerId: 'credential'`) the
   * password sign-in path reads from. A hand-written `user` row would look
   * complete and be unable to log in.
   *
   * `role` is not accepted here — `input: false` in lib/auth.ts blocks it from
   * every Better Auth write, so new accounts always take the column default
   * (`organizer`). Promotion is a deliberate, separate act.
   */
  createOrganizer: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        email: z.email(),
        // Better Auth's own floor is 8; keep this in step with it.
        password: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        // `asResponse: false` (the default) returns the payload without
        // emitting Set-Cookie, so the admin's own session is untouched — the
        // new user's session token is simply discarded.
        const result = await auth.api.signUpEmail({
          body: {
            name: input.name,
            email: input.email,
            password: input.password,
          },
        });

        return {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: 'organizer' as const,
        };
      } catch (error) {
        // Better Auth signals duplicate email as an APIError, not a DB error.
        if (error instanceof APIError) {
          throw new TRPCError({
            code: error.status === 'UNPROCESSABLE_ENTITY' ? 'CONFLICT' : 'BAD_REQUEST',
            message: error.body?.message ?? 'Could not create organizer.',
            cause: error,
          });
        }
        throw error;
      }
    }),

  /**
   * Delete an organizer and everything they own.
   *
   * Better Auth's `deleteUser` endpoint is self-service — it runs off the
   * caller's own session and takes their password, so an admin cannot use it
   * against a third party. Deleting the `user` row directly is the correct
   * path: `session`, `account`, and `events` all cascade from it
   * (lib/db/schema.ts), which clears the auth records Better Auth owns.
   */
  deleteOrganizer: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You cannot delete your own account.',
        });
      }

      const target = await db.query.user.findFirst({
        columns: { id: true, role: true },
        where: eq(user.id, input.id),
      });

      if (!target) throw new TRPCError({ code: 'NOT_FOUND' });

      if (target.role === 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admins cannot be deleted through this route.',
        });
      }

      // Deleting cascades to their events, and from there to ticket types,
      // orders, and tickets — including paid ones. Refuse while any paid order
      // exists so financial records are never destroyed silently; reconciliation
      // (spec §9) would fail on the gap.
      const [{ paid }] = await db
        .select({ paid: count() })
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(
          and(eq(events.organizerId, input.id), eq(orders.status, 'paid')),
        );

      if (paid > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `This organizer has ${paid} paid order(s). Cancel or archive their events instead.`,
        });
      }

      const [deleted] = await db
        .delete(user)
        .where(eq(user.id, input.id))
        .returning({ id: user.id, email: user.email });

      return deleted;
    }),
});
