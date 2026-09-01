/**
 * A fixed-window request counter held in module scope.
 *
 * **Read this before relying on it.** The process's memory is the whole store,
 * which has three consequences worth stating plainly rather than discovering:
 *
 * - **Multi-instance.** Serverless runs N instances, each with its own Map, so
 *   the real global limit is N × the configured one. A limit of 10 across four
 *   warm lambdas is 40. Choose the number knowing that.
 * - **Cold starts.** A fresh instance starts empty, so an attacker who forces
 *   one — or is simply routed to one — gets a fresh budget.
 * - **Not durable.** A deploy resets every counter.
 *
 * So this is a *courtesy* limiter: it stops naive loops, double-submits, and one
 * script hammering one connection. It is **not** a defence against a distributed
 * or determined attacker, and nothing whose correctness matters may depend on
 * it. The durable half of the answer is `livePendingHolds` in
 * `routers/orders.ts`, which asks Postgres — the one store every instance
 * shares.
 *
 * Spec §4 rules out Redis ("One datastore means holds and orders commit in the
 * same transaction, which is the property that makes this correct"), which is
 * why the durable limit is a query rather than a counter.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Above this many tracked keys, sweep the expired ones.
 *
 * Without a bound this Map is itself a denial of service: its keys come from
 * request data, so an attacker sending a novel key each time grows it until the
 * process dies. The sweep is O(n) but runs only on a fresh window past the
 * threshold, not per request.
 */
const SWEEP_THRESHOLD = 10_000;

export type RateLimitResult = { ok: boolean; retryAfterMs: number };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });

    if (buckets.size > SWEEP_THRESHOLD) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }

    return { ok: true, retryAfterMs: 0 };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;

  return { ok: true, retryAfterMs: 0 };
}
