import { and, eq, lt, sql } from 'drizzle-orm';

import { db } from '../lib/db';
import { orders } from '../lib/db/schema';
import { stripe } from '../lib/stripe';
import { syncSoldOut } from '../lib/trpc/routers/tickets';

/**
 * The hold-expiry sweeper (spec §6.2) — `npm run holds:sweep`.
 *
 * **What it is not.** It is not what frees inventory. `availabilityByType`
 * already reads `status = 'paid' OR (status = 'pending' AND hold_expires_at >
 * now())`, so a lapsed hold stops consuming a seat the instant its timestamp
 * passes, with no writer involved. Availability is correct without this script
 * and was before it existed.
 *
 * **What it is for.** Making the stored row agree with how it is already being
 * counted. Without it a `pending` order sits `pending` forever — the buyer's
 * dashboard lies, reconciliation has to special-case "pending but actually
 * dead", and expiry is implied rather than recorded.
 *
 * **Why it races the webhook, and how it wins safely.** A hold lapsing at the
 * same moment a payment lands is spec §6.3. This script must never write
 * `expired` over a sale, so it borrows every guard from `releaseHold`
 * (`lib/trpc/routers/checkout.ts`), which solves the identical problem from the
 * buyer's side:
 *
 *   1. `SELECT … FOR UPDATE` — serialise against the webhook's fulfilment
 *      transaction rather than interleaving with it.
 *   2. Re-read the status under that lock; anything but `pending` is left alone.
 *   3. Ask *Stripe*, not our own clock, whether money is in flight. A session
 *      that is `complete`, or `open` with a non-`unpaid` payment_status, is a
 *      buyer mid-payment — skip it and let the webhook finish.
 *   4. Expire the Stripe session before writing, so its 31-minute window cannot
 *      outlive our 10-minute hold and manufacture the §6.3 refund branch.
 *   5. Write conditionally (`WHERE status = 'pending'`), so a webhook that
 *      committed between the SELECT and the UPDATE still wins.
 *
 * Safe to run repeatedly and on a schedule; it is the stand-in for the job
 * runner in `docs/DEFERRED-JOBS.md`, whose "ordering" section puts this first.
 */

/** How many lapsed holds to consider in one pass. */
const BATCH = 200;

async function main() {
  const lapsed = await db
    .select({
      id: orders.id,
      eventId: orders.eventId,
      stripeSessionId: orders.stripeSessionId,
    })
    .from(orders)
    .where(
      and(eq(orders.status, 'pending'), lt(orders.holdExpiresAt, new Date())),
    )
    // Uses orders_status_holdExpiresAt_idx.
    .orderBy(orders.holdExpiresAt)
    .limit(BATCH);

  if (lapsed.length === 0) {
    console.log('\nNothing to expire — no lapsed holds.\n');
    return;
  }

  console.log(`\nFound ${lapsed.length} lapsed hold(s)…\n`);

  let expired = 0;
  let paying = 0;
  let settled = 0;
  let failed = 0;

  for (const order of lapsed) {
    const label = order.id.slice(0, 8);

    try {
      // Guard 3 runs before the transaction opens: it is a network call to
      // Stripe, and holding a row lock across one would keep the webhook
      // waiting on an external round trip.
      if (order.stripeSessionId) {
        const session = await stripe.checkout.sessions.retrieve(
          order.stripeSessionId,
        );

        // They paid; the webhook is on its way. Leaving the hold intact is what
        // lets §6.3 find it valid and issue their tickets.
        if (session.status === 'complete') {
          console.log(`  ${label}  paid at Stripe — leaving for the webhook`);
          paying += 1;
          continue;
        }

        // An async payment method sitting between authorised and settled.
        if (session.status === 'open' && session.payment_status !== 'unpaid') {
          console.log(`  ${label}  payment in flight — skipping`);
          paying += 1;
          continue;
        }

        if (session.status === 'open') {
          // Slam Stripe's window shut before we resell the seat.
          await stripe.checkout.sessions
            .expire(order.stripeSessionId)
            .catch(() => {});
        }
      }

      const outcome = await db.transaction(async (tx) => {
        // Guard 1: serialise against fulfilment.
        const { rows } = await tx.execute(sql`
          SELECT status FROM orders WHERE id = ${order.id} FOR UPDATE
        `);

        const row = rows[0] as { status: string } | undefined;

        // Guard 2: it settled while we were talking to Stripe.
        if (!row || row.status !== 'pending') return row?.status ?? 'gone';

        // Guard 5: conditional write — a webhook that committed since the
        // SELECT still wins.
        const [updated] = await tx
          .update(orders)
          .set({ status: 'expired' })
          .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
          .returning({ id: orders.id });

        if (!updated) return 'raced';

        // This event may have been `sold_out` only because of this hold. Same
        // transaction, so no write lands between the count and the status.
        await syncSoldOut(tx, order.eventId);

        return 'expired';
      });

      if (outcome === 'expired') {
        console.log(`  ${label}  → expired, seats returned`);
        expired += 1;
      } else {
        console.log(`  ${label}  → already ${outcome}; left alone`);
        settled += 1;
      }
    } catch (error) {
      console.log(`  ${label}  FAILED — ${(error as Error).message.slice(0, 90)}`);
      failed += 1;
    }
  }

  console.log(
    `\nDone. ${expired} expired, ${paying} still paying, ${settled} already settled` +
      (failed > 0 ? `, ${failed} failed` : '') +
      '.\n',
  );

  // A failure here is worth a non-zero exit so a scheduler can alert on it.
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error('\nHold sweep failed:', error);
    process.exit(1);
  });
