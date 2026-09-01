import { desc, eq } from 'drizzle-orm';

import { db } from '../lib/db';
import { orders, webhookEvents } from '../lib/db/schema';
import { stripe } from '../lib/stripe';

/**
 * Preflight for the checkout path — `npm run stripe:check`.
 *
 * The failure this exists for is silent: `stripe listen` stops, everything keeps
 * *looking* fine, and you only find out when a real buyer pays and gets nothing.
 * Run this before testing a purchase and it tells you in a couple of seconds.
 *
 * Read-only apart from nothing at all: it inspects config, asks Stripe who we
 * are, and reads two tables. It never writes.
 */

const ok = (label: string, detail = '') =>
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
const bad = (label: string, detail = '') =>
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
const warn = (label: string, detail = '') =>
  console.log(`  ⚠️  ${label}${detail ? ` — ${detail}` : ''}`);

async function main() {
  let fatal = false;

  console.log('\nEnvironment');

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    bad('STRIPE_SECRET_KEY is not set');
    fatal = true;
  } else if (/^(sk|rk)_live_/.test(key)) {
    warn('STRIPE_SECRET_KEY is a LIVE key', 'real money will move');
  } else {
    ok('STRIPE_SECRET_KEY', 'test mode');
  }

  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  if (!whsec) {
    bad('STRIPE_WEBHOOK_SECRET is not set', 'run `npm run stripe:listen`');
    fatal = true;
  } else if (!whsec.startsWith('whsec_')) {
    bad('STRIPE_WEBHOOK_SECRET does not look like a signing secret');
    fatal = true;
  } else {
    ok('STRIPE_WEBHOOK_SECRET', `${whsec.slice(0, 12)}…`);
  }

  for (const name of ['DATABASE_URL', 'BETTER_AUTH_SECRET'] as const) {
    if (process.env[name]) ok(name);
    else {
      bad(`${name} is not set`);
      fatal = true;
    }
  }

  if (process.env.SMTP_HOST) {
    ok('SMTP_HOST', process.env.SMTP_HOST);
  } else {
    warn('SMTP_HOST is not set', 'ticket emails will fail (tickets still work)');
  }

  console.log('\nStripe');

  if (key) {
    try {
      // Any authenticated read proves the key works. Prices is chosen because
      // the restricted key can read it and it costs nothing.
      await stripe.checkout.sessions.list({ limit: 1 });
      ok('API reachable and the key authenticates');
    } catch (error) {
      bad('Stripe rejected the key', (error as Error).message.slice(0, 80));
      fatal = true;
    }
  }

  console.log('\nWebhook delivery');

  const [latest] = await db
    .select()
    .from(webhookEvents)
    .orderBy(desc(webhookEvents.processedAt))
    .limit(1);

  if (!latest) {
    warn('No webhook has EVER been received', 'the tunnel may never have run');
  } else {
    const ageMin = (Date.now() - latest.processedAt.getTime()) / 60_000;

    if (ageMin < 60) {
      ok('Recent webhook', `${latest.type}, ${ageMin.toFixed(0)} min ago`);
    } else {
      warn(
        'Last webhook is old',
        `${latest.type}, ${(ageMin / 60).toFixed(1)} h ago`,
      );
    }
  }

  // A tunnel can be up and still never deliver the event that *matters*. If we
  // have only ever seen failure events, the fulfilment path has never actually
  // run — which looks identical to a dead tunnel from the outside.
  const seen = await db
    .selectDistinct({ type: webhookEvents.type })
    .from(webhookEvents);

  const seenTypes = new Set(seen.map((row) => row.type));

  if (
    !seenTypes.has('checkout.session.completed') &&
    !seenTypes.has('checkout.session.async_payment_succeeded')
  ) {
    warn(
      'No checkout.session.completed has EVER arrived',
      'fulfilment has never run from a webhook',
    );
    console.log(
      '     If the tunnel is running, check that it was started WITHOUT an',
    );
    console.log(
      '     --events filter that omits it, and that it was up when you paid.',
    );
  } else {
    ok('checkout.session.completed has arrived before');
  }

  // The symptom that matters: money taken, nothing delivered.
  const stuck = await db
    .select()
    .from(orders)
    .where(eq(orders.status, 'pending'))
    .orderBy(desc(orders.createdAt))
    .limit(10);

  const paidButPending: string[] = [];

  for (const order of stuck) {
    if (!order.stripeSessionId) continue;

    try {
      const session = await stripe.checkout.sessions.retrieve(
        order.stripeSessionId,
      );
      if (session.payment_status === 'paid') paidButPending.push(order.id);
    } catch {
      // A session we cannot read tells us nothing useful here.
    }
  }

  if (paidButPending.length > 0) {
    bad(
      `${paidButPending.length} order(s) PAID at Stripe but still pending here`,
      'a webhook was missed',
    );
    for (const id of paidButPending) console.log(`     ${id}`);
    console.log(
      '\n     Fix: start `npm run stripe:listen`, then open the buyer\'s',
    );
    console.log('     checkout page — it self-heals in 3 seconds.');
  } else {
    ok('No paid-but-unfulfilled orders');
  }

  console.log(
    fatal
      ? '\nNot ready — fix the ❌ items above.\n'
      : '\nReady to take a payment.\n',
  );

  process.exit(fatal ? 1 : 0);
}

main().catch((error) => {
  console.error('\nCheck failed:', error);
  process.exit(1);
});
