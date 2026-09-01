import { desc, eq, or, sql } from 'drizzle-orm';

import { db } from '../lib/db';
import { orders, events, tickets } from '../lib/db/schema';
import {
  deliverFulfilmentMail,
  fulfilOrder,
  FULFILMENT_EVENT_COLUMNS,
} from '../lib/fulfilment';
import { stripe } from '../lib/stripe';

/**
 * Find every order paid at Stripe but not fulfilled here, and fulfil it —
 * `npm run stripe:sweep`.
 *
 * **Why this exists.** The webhook is the source of truth, and the ticket modal
 * self-heals if one goes missing. But that self-heal only runs *while the buyer
 * has the page open*. Someone who pays and immediately closes the tab is beyond
 * its reach: their money is taken, no tickets exist, and nothing will ever try
 * again. That is the single worst state in the system.
 *
 * This closes it from the server side, needing no browser. Run it after any
 * period where webhooks were not being delivered, or on a schedule.
 *
 * Safe to run repeatedly: `fulfilOrder` is idempotent — an already-paid order
 * returns `already-paid` and issues nothing (spec §6.4).
 *
 * It is the manual stand-in for the job worker described in
 * `docs/DEFERRED-JOBS.md`. When a runner exists, this logic belongs in it.
 */

async function main() {
  const stuck = await db
    .select()
    .from(orders)
    .where(
      or(
        eq(orders.status, 'pending'),
        // An order the sweeper (or a buyer) expired while the payment was in
        // flight is exactly §6.3's race — `fulfilOrder` re-checks availability
        // under the lock and either honours or refunds it.
        sql`(${orders.status} = 'expired' AND ${orders.refundedAt} IS NULL)`,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(100);

  if (stuck.length === 0) {
    console.log('\nNothing to sweep — no unfulfilled orders.\n');
    return;
  }

  console.log(`\nChecking ${stuck.length} unfulfilled order(s) against Stripe…\n`);

  let fulfilled = 0;
  let refunded = 0;
  let untouched = 0;

  for (const order of stuck) {
    const label = order.id.slice(0, 8);

    if (!order.stripeSessionId) {
      // The buyer never reached Stripe. Nothing was charged; the hold simply
      // lapses on its own.
      untouched += 1;
      continue;
    }

    let paid = false;
    let paymentIntentId: string | undefined;

    try {
      const session = await stripe.checkout.sessions.retrieve(
        order.stripeSessionId,
      );

      paid = session.payment_status === 'paid';
      paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;
    } catch (error) {
      console.log(`  ${label}  could not read session — ${(error as Error).message.slice(0, 60)}`);
      continue;
    }

    if (!paid) {
      untouched += 1;
      continue;
    }

    console.log(`  ${label}  PAID at Stripe but not fulfilled — fixing…`);

    try {
      const result = await db.transaction(async (tx) =>
        fulfilOrder(tx, { orderId: order.id, paymentIntentId }),
      );

      // Mail after the commit, never inside it (see `lib/mail-send.ts`).
      if (result.outcome === 'issued' || result.outcome === 'refunded') {
        const event = await db.query.events.findFirst({
          columns: FULFILMENT_EVENT_COLUMNS,
          where: eq(events.id, result.order.event_id),
        });

        if (event) await deliverFulfilmentMail(result, event);
      }

      if (result.outcome === 'issued') {
        const issued = await db
          .select()
          .from(tickets)
          .where(eq(tickets.orderId, order.id));

        console.log(`  ${label}  → ${issued.length} ticket(s) issued, email sent`);
        fulfilled += 1;
      } else if (result.outcome === 'refunded') {
        console.log(`  ${label}  → seats were gone; refunded and apologised`);
        refunded += 1;
      } else {
        console.log(`  ${label}  → ${result.outcome} (no action needed)`);
        untouched += 1;
      }
    } catch (error) {
      console.log(`  ${label}  FAILED — ${(error as Error).message.slice(0, 90)}`);
    }
  }

  console.log(
    `\nDone. ${fulfilled} fulfilled, ${refunded} refunded, ${untouched} needed nothing.\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nSweep failed:', error);
    process.exit(1);
  });
