import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';

import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

/**
 * This context creator accepts `headers` so it can be reused in both
 * the RSC server caller (where you pass `next/headers`) and the
 * API route handler (where you pass the request headers).
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth.api.getSession({ headers: opts.headers });

  return {
    session,
    user: session?.user ?? null,
    /**
     * The caller's address, for the courtesy rate limiter only.
     *
     * Read here rather than inside procedures so the HTTP path and the RSC
     * `caller()` path cannot diverge. **Never stored on a row** — it keys an
     * in-memory counter and nothing else.
     *
     * The first entry of `x-forwarded-for` is the client's own and is
     * spoofable; behind a proxy the rightmost hop is not. This is a key, not an
     * identity, and the durable limit (`livePendingHolds`) is what actually
     * holds.
     */
    ip: opts.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
  };
};

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

// Avoid exporting the entire t-object since it's not very descriptive.
// For instance, the use of a t variable is common in i18n libraries.
const t = initTRPC.context<TRPCContext>().create({
  /**
   * superjson lets Date (booking slots, timestamps) survive the
   * server -> client hydration boundary as real Date objects.
   * @see https://trpc.io/docs/server/data-transformers
   */
  transformer: superjson,
});

// Base router and procedure helpers
export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure;

/**
 * A public procedure with a per-IP request ceiling.
 *
 * For unauthenticated write paths, where the cost of an abusive caller lands on
 * other buyers rather than on themselves. Read `lib/rate-limit.ts` before
 * relying on the numbers: the counter is per-process, so N serverless instances
 * means N × the limit, and a cold start is a fresh budget. It stops naive loops
 * and double-submits, not a distributed attacker.
 *
 * Anything whose *correctness* depends on a limit needs a database check
 * instead — see `livePendingHolds` in `routers/orders.ts`.
 */
export const rateLimitedProcedure = (
  name: string,
  limit: number,
  windowMs: number,
) =>
  t.procedure.use(async ({ ctx, next }) => {
    const { ok, retryAfterMs } = rateLimit(`${name}:${ctx.ip}`, limit, windowMs);

    if (!ok) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      });
    }

    return next();
  });

/** Requires an authenticated session; narrows `user` to non-null. */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  return next({
    ctx: { ...ctx, session: ctx.session, user: ctx.user },
  });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next({ ctx });
});

/**
 * Organizers only — the mirror of `adminProcedure`.
 *
 * Most organizer-facing procedures use `protectedProcedure` and let admins
 * *widen* their scope (`role === 'admin' ? undefined : eq(...)`). This is for
 * the few actions an admin must not take at all: an admin creating an event
 * would become its organizer, which is not a thing platform oversight should
 * produce. Admins still edit and delete any organizer's events through the
 * widening procedures.
 */
export const organizerProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role === 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admins cannot create events. Create one as an organizer instead.',
    });
  }
  return next({ ctx });
});