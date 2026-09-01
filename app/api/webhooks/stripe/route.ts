import { and, eq } from 'drizzle-orm';
import type Stripe from 'stripe';

import { db } from '@/lib/db';
import { events, orders, webhookEvents } from '@/lib/db/schema';
import {
  deliverFulfilmentMail,
  fulfilOrder,
  FULFILMENT_EVENT_COLUMNS,
  type FulfilResult,
} from '@/lib/fulfilment';
import { stripe } from '@/lib/stripe';
import { syncSoldOut, type Conn } from '@/lib/trpc/routers/tickets';

/**
 * Stripe's webhook — the source of truth for whether a buyer paid (spec §7.1).
 *
 * The redirect back from Stripe issues nothing: it can be lost, blocked, or
 * forged, and a buyer who closes the tab at the wrong moment would never get
 * their tickets. Every state change that follows a payment happens here.
 *
 * `nodejs`, not Edge: `constructEvent` uses `node:crypto` synchronously, and on
 * Edge it fails every signature with an error that points nowhere useful.
 */
export const runtime = 'nodejs';

/** A POST-only mutation endpoint — nothing about it may ever be cached. */
export const dynamic = 'force-dynamic';

/** Thrown to unwind the transaction when this event was already handled. */
class AlreadyProcessed extends Error {}

function webhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET is not set. Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` and copy the whsec_… it prints.',
    );
  }

  return secret;
}

/** Postgres `unique_violation`. The §6.4 idempotency check depends on it. */
function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  // The RAW body, read before anything can parse it (spec §6.4, §13). The
  // signature is an HMAC over bytes, so a parsed-and-reserialised body — with
  // different whitespace and key order — fails verification in a way that looks
  // exactly like a wrong secret. App Router does not pre-parse, so `text()` is
  // all that is needed; there is no body-parser to opt out of.
  const raw = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(raw, signature, webhookSecret());
  } catch (error) {
    console.error('[stripe webhook] signature verification failed', error);

    // 400 and no retry: a body that will not verify never will, and asking
    // Stripe to resend it is just amplification. This branch also *is* the
    // endpoint's rate limit — without the signing secret nothing gets past
    // here, and this path touches no database.
    return new Response('Invalid signature', { status: 400 });
  }

  let result: FulfilResult | null = null;

  try {
    result = await db.transaction(async (tx) => {
      // §6.4: the idempotency row goes in FIRST, in the same transaction as the
      // work it guards. If fulfilment then throws, this row rolls back with it
      // and Stripe's retry gets a genuine second attempt rather than being
      // permanently locked out by a row recording work that never happened.
      try {
        await tx.insert(webhookEvents).values({
          stripeEventId: event.id,
          type: event.type,
          payload: event as unknown as Record<string, unknown>,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new AlreadyProcessed();
        throw error;
      }

      return handleEvent(tx, event);
    });
  } catch (error) {
    if (error instanceof AlreadyProcessed) {
      // 200. Stripe retries on any non-2xx, and this event's work is already
      // committed — a 4xx or 5xx here would have it retrying forever against a
      // constraint that can never let it through.
      return new Response('Already processed', { status: 200 });
    }

    console.error('[stripe webhook] failed', event.id, event.type, error);

    // 500, and we *want* this retry. The transaction rolled back, so nothing
    // committed and the event id is gone with it: the retry is a clean attempt
    // at work that genuinely has not happened. This is the database-down and
    // refund-failed case.
    return new Response('Processing failed', { status: 500 });
  }

  // Mail only after the commit — never inside the transaction, where it would
  // hold ticket-type locks across SMTP and let a bounce roll back a payment.
  if (result && (result.outcome === 'issued' || result.outcome === 'refunded')) {
    const event_ = await db.query.events.findFirst({
      columns: FULFILMENT_EVENT_COLUMNS,
      where: eq(events.id, result.order.event_id),
    });

    if (event_) {
      await deliverFulfilmentMail(result, event_);
    }
  }

  return new Response(null, { status: 200 });
}

async function handleEvent(tx: Conn, event: Stripe.Event): Promise<FulfilResult | null> {
  switch (event.type) {
    // The buyer completed Checkout. For a card that means the money is taken;
    // for an async method it can still fail, which is what `payment_status`
    // distinguishes below.
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session;

      // A session can be `complete` while the money is still in flight. Issuing
      // here would hand out tickets for a payment that can still fail. EGP is
      // card-only today, so this is rare — but it is the one guard between us
      // and free tickets the day another method is enabled.
      if (session.payment_status !== 'paid') return null;

      return fulfilOrder(tx, {
        orderId: session.metadata?.orderId ?? session.client_reference_id,
        paymentIntentId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id,
      });
    }

    // The session hit its `expires_at`, or `releaseHold` expired it for us.
    // Either way it can never be paid — this one is terminal.
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId ?? session.client_reference_id;

      if (!orderId) return null;

      const [released] = await tx
        .update(orders)
        .set({ status: 'expired', holdExpiresAt: new Date() })
        // Guarded on `pending`. In practice our own hold lapsed ~21 minutes
        // earlier so this is usually a no-op, which is correct — the guard is
        // what stops an out-of-order delivery expiring an order that got paid.
        .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
        .returning();

      if (released) await syncSoldOut(tx, released.eventId);

      return null;
    }

    // A card was declined. **This is not terminal.** The session is still open
    // and the buyer is looking at "try another card" — they often succeed
    // moments later. Killing the order here would mean the successful retry
    // lands on an order we already expired, and §6.3 would then refund a
    // payment that actually worked. Record the reason and change nothing else.
    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const orderId = intent.metadata?.orderId;

      if (!orderId) return null;

      await tx
        .update(orders)
        .set({
          lastPaymentError:
            intent.last_payment_error?.message ??
            'Your payment was declined. Try another card.',
        })
        // Scoped to `pending` so a late-arriving failure cannot stamp an error
        // onto an order that has since been paid.
        .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
        .returning();

      return null;
    }

    default:
      // 200 and ignore. A 4xx for event types we simply do not care about would
      // fill the Stripe dashboard with red and teach us to ignore it.
      return null;
  }
}
