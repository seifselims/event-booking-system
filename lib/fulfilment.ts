import { eq, sql } from 'drizzle-orm';

import { orderItems, orders } from '@/lib/db/schema';
import { orderTicketUrl } from '@/lib/checkout';
import { sendApologyEmail, sendTicketEmail } from '@/lib/mail-send';
import { stripe } from '@/lib/stripe';
import { issueTickets } from '@/lib/tickets-issue';
import { availabilityByType, syncSoldOut, type Conn } from '@/lib/trpc/routers/tickets';

/**
 * Turning a completed Stripe payment into tickets — spec §6.3, the expiry/payment
 * race.
 *
 * A buyer's ten-minute hold can lapse *while their card is being processed*.
 * Another buyer takes the last seat in that gap. Then the webhook arrives and we
 * are holding money for a ticket that no longer exists. This cannot be
 * prevented, only handled, and this function is where it is handled:
 *
 * ```
 * status = 'paid'      → already done, return (idempotent)
 * status = 'refunded'  → anomaly, log and return
 * hold still valid     → issue tickets, mark paid
 * hold expired ↓
 *   re-check availability UNDER THE ROW LOCK
 *   ├─ still available → honour it. They paid; if we can serve them, we do.
 *   └─ gone            → refund, mark expired, apologise
 * ```
 *
 * **Everything here must run inside one transaction**, passed as `conn`, and the
 * caller must have inserted the `webhook_events` row in that same transaction
 * first (§6.4). If any of this throws, the whole thing — the event id included —
 * rolls back, and Stripe's retry gets a genuine second attempt.
 *
 * Emails are deliberately *not* sent here. They are returned as an intent for
 * the caller to send after the commit; see `FulfilResult`.
 */

/** What the caller should email once the transaction has committed. */
export type FulfilResult =
  | { outcome: 'already-paid' | 'anomaly-refunded' | 'unknown-order' }
  | {
      outcome: 'issued';
      order: OrderRow;
      tickets: { id: string; secret: string; tierName: string }[];
      ticketUrl: string;
    }
  | { outcome: 'refunded'; order: OrderRow };

type OrderRow = {
  id: string;
  event_id: string;
  status: string;
  hold_expires_at: Date;
  total_piastres: number;
  buyer_email: string;
  buyer_name: string;
  stripe_payment_intent_id: string | null;
};

export async function fulfilOrder(
  conn: Conn,
  { orderId, paymentIntentId }: { orderId?: string | null; paymentIntentId?: string | null },
): Promise<FulfilResult> {
  if (!orderId) {
    // A session created outside `createCheckoutSession`. Nothing to fulfil and
    // a retry cannot conjure metadata, so the caller returns 200 — but this is
    // loud because it means something is minting sessions we don't know about.
    console.error('[fulfil] webhook carried no orderId');
    return { outcome: 'unknown-order' };
  }

  // Lock the order row before reading its status. This is what serialises
  // fulfilment against `releaseHold` and against Stripe delivering two event
  // types for one session — without it, we can read `pending`, have the other
  // path write `expired`, and then write `paid` over a released hold.
  const { rows } = await conn.execute(sql`
    SELECT id, event_id, status, hold_expires_at, total_piastres,
           buyer_email, buyer_name, stripe_payment_intent_id
    FROM orders WHERE id = ${orderId} FOR UPDATE
  `);

  const order = rows[0] as OrderRow | undefined;

  if (!order) {
    console.error('[fulfil] unknown order', orderId);
    return { outcome: 'unknown-order' };
  }

  // ── Branch 1: already paid. A duplicate delivery, or `completed` followed by
  //    `async_payment_succeeded` for the same session. Idempotent no-op.
  if (order.status === 'paid') {
    return { outcome: 'already-paid' };
  }

  // ── Branch 2: money against an order we already refunded. Do NOT refund
  //    again — that is how one payment becomes two reversals. Flagged for a
  //    human to reconcile.
  if (order.status === 'refunded') {
    console.error(
      '[fulfil] ANOMALY: payment received on an already-refunded order',
      orderId,
    );
    return { outcome: 'anomaly-refunded' };
  }

  const holdValid =
    order.status === 'pending' && new Date(order.hold_expires_at) > new Date();

  // ── Branch 3: the happy path. The hold is live, the seat is theirs.
  if (holdValid) {
    return issueFor(conn, order, paymentIntentId);
  }

  // ── Branch 4: the hold lapsed (or `releaseHold` / a sweeper expired it)
  //    while Stripe processed the card. Re-check under the tier lock.
  const items = await conn
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  // Sorted, exactly as `createOrder` sorts: every transaction acquiring these
  // locks in the same sequence is what makes deadlock structurally impossible.
  const tierIds = items.map((item) => item.ticketTypeId).sort();

  // An order with no items cannot happen — `createOrder` writes both in one
  // transaction — but `IN ()` is a syntax error, so a corrupt row would take
  // down the webhook rather than surfacing itself. Refund is the safe reading:
  // we cannot serve what we cannot enumerate.
  if (tierIds.length === 0) {
    console.error('[fulfil] order has no items', order.id);
    return refundFor(conn, order, paymentIntentId);
  }

  // `IN (...)`, not `= ANY($1::text[])` — see the note in `createOrder`: a JS
  // array reaches Postgres as one scalar and fails with `22P02`.
  await conn.execute(sql`
    SELECT id FROM ticket_types
    WHERE id IN (${sql.join(
      tierIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    ORDER BY id
    FOR UPDATE
  `);

  const availability = await availabilityByType(conn, order.event_id);
  const availableById = new Map(
    availability.map((row) => [row.ticketTypeId, row.available]),
  );

  // This order is no longer a live hold, so its own rows are not counted in
  // `taken` — the number read here is genuinely what is free for it to take.
  const canHonour = items.every(
    (item) => (availableById.get(item.ticketTypeId) ?? 0) >= item.quantity,
  );

  // ── 4a: the seats came back. Honour it.
  //
  // Deliberately asymmetric: a *new* buyer arriving at this instant would be
  // refused, but this one has already paid. If we can serve them, we serve them.
  if (canHonour) {
    return issueFor(conn, order, paymentIntentId);
  }

  // ── 4b: gone. Refund, and tell them why.
  return refundFor(conn, order, paymentIntentId);
}

/**
 * Give the money back for an order we cannot serve (§6.3, branch 4b).
 *
 * Stripe is called **inside** the transaction, which is uncomfortable and
 * deliberate. The alternative — commit `expired`, then refund — loses the refund
 * entirely if the process dies in between, leaving us holding money with no
 * record that we owe it. This way a refund failure throws, everything rolls
 * back, the webhook returns 500, and Stripe retries the whole unit.
 */
async function refundFor(
  conn: Conn,
  order: OrderRow,
  paymentIntentId?: string | null,
): Promise<FulfilResult> {
  const paymentIntent = paymentIntentId ?? order.stripe_payment_intent_id;

  if (!paymentIntent) {
    // Nothing to refund against. Throwing gets a retry, by which time the
    // PaymentIntent may have arrived on a later event.
    throw new Error(`[fulfil] no PaymentIntent to refund for order ${order.id}`);
  }

  await stripe.refunds.create(
    { payment_intent: paymentIntent, reason: 'requested_by_customer' },
    // Keyed on the order, so a retry of this exact path never issues a second
    // refund — spec §7.2's rule applied to the automatic case.
    { idempotencyKey: `refund:${order.id}` },
  );

  await conn
    .update(orders)
    .set({
      // `expired` + `refundedAt`, not `refunded`: this is "we took money we
      // could not honour", which reporting must be able to tell apart from an
      // organizer-initiated §7.2 refund of a seat that was genuinely delivered.
      status: 'expired',
      refundedAt: new Date(),
      stripePaymentIntentId: paymentIntent,
      holdExpiresAt: new Date(),
    })
    .where(eq(orders.id, order.id));

  await syncSoldOut(conn, order.event_id);

  return { outcome: 'refunded', order };
}

/** Mark paid and write the ticket rows — branches 3 and 4a share this. */
async function issueFor(
  conn: Conn,
  order: OrderRow,
  paymentIntentId?: string | null,
): Promise<FulfilResult> {
  await conn
    .update(orders)
    .set({
      status: 'paid',
      paidAt: new Date(),
      stripePaymentIntentId: paymentIntentId ?? order.stripe_payment_intent_id,
      // Clear any decline recorded from an earlier attempt in this session —
      // they got there in the end, and the countdown page should not still be
      // showing "your card was declined".
      lastPaymentError: null,
    })
    .where(eq(orders.id, order.id));

  const issued = await issueTickets(conn, order.id);

  // The hold has become a sale. The count is unchanged, but the tier may now be
  // genuinely exhausted rather than merely held — and `syncSoldOut` must run in
  // this transaction, per its own docstring, so nothing lands between the two.
  await syncSoldOut(conn, order.event_id);

  // Tier names for the email, read here while the transaction is open.
  const tierNames = await conn
    .select({
      ticketTypeId: orderItems.ticketTypeId,
      name: sql<string>`(SELECT name FROM ticket_types WHERE id = ${orderItems.ticketTypeId})`,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  const nameById = new Map(tierNames.map((row) => [row.ticketTypeId, row.name]));

  return {
    outcome: 'issued',
    order,
    tickets: issued.map((ticket) => ({
      id: ticket.id,
      secret: ticket.secret,
      tierName: nameById.get(ticket.ticketTypeId) ?? 'Ticket',
    })),
    ticketUrl: orderTicketUrl(order.id),
  };
}

/**
 * Send whatever the fulfilment decided on — **after** the transaction commits.
 *
 * Split out so the transaction never holds a lock across SMTP, and so a mail
 * failure can never roll back a payment. See `lib/mail-send.ts` for why these
 * must not throw.
 */
export async function deliverFulfilmentMail(
  result: FulfilResult,
  event: { title: string; venue: string; startsAt: Date },
) {
  if (result.outcome === 'issued') {
    await sendTicketEmail({
      orderId: result.order.id,
      buyerName: result.order.buyer_name,
      buyerEmail: result.order.buyer_email,
      eventTitle: event.title,
      venue: event.venue,
      startsAt: event.startsAt,
      totalPiastres: result.order.total_piastres,
      tickets: result.tickets,
      ticketUrl: result.ticketUrl,
    });
    return;
  }

  if (result.outcome === 'refunded') {
    await sendApologyEmail({
      orderId: result.order.id,
      buyerName: result.order.buyer_name,
      buyerEmail: result.order.buyer_email,
      eventTitle: event.title,
      totalPiastres: result.order.total_piastres,
    });
  }
}

/** The event columns `deliverFulfilmentMail` needs, for the caller's lookup. */
export const FULFILMENT_EVENT_COLUMNS = {
  title: true,
  venue: true,
  startsAt: true,
} as const;
