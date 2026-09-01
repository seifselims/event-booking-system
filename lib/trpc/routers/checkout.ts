import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { appUrl, orderTicketUrl, verifyOrderToken } from '@/lib/checkout';
import { db } from '@/lib/db';
import { events, orders } from '@/lib/db/schema';
import {
  deliverFulfilmentMail,
  fulfilOrder,
  FULFILMENT_EVENT_COLUMNS,
} from '@/lib/fulfilment';
import { qrDataUrl } from '@/lib/qr';
import { CURRENCY, stripe, toStripeAmount } from '@/lib/stripe';

import { createTRPCRouter, baseProcedure, rateLimitedProcedure } from '../init';
import { syncSoldOut } from './tickets';

/**
 * Stripe's floor for a Checkout Session's lifetime is 30 minutes; our hold is
 * ten (spec §6.2). They are two different clocks and **the database one is
 * authoritative** — inventory frees at `hold_expires_at` regardless of what
 * Stripe thinks. One extra minute over the floor so a slow request cannot land
 * at 29:59 and be rejected outright.
 *
 * The gap is closed actively, not passively: when the hold lapses or the buyer
 * releases it, we call `sessions.expire()`. What is left over — a buyer who
 * pays at minute 10:30 on a session we have not yet shut — is exactly the race
 * spec §6.3 exists to handle.
 */
const SESSION_MINUTES = 31;

const orderRef = z.object({
  orderId: z.string(),
  /**
   * The buyer's magic-link token. Required on every mutation: these are public
   * procedures with no session behind them, so the token is the only thing
   * separating the buyer from anyone who has seen an order id.
   */
  token: z.string().min(1).max(64),
});

/** Reject a token that does not match, without saying which part was wrong. */
function assertToken(orderId: string, token: string) {
  if (!verifyOrderToken(orderId, token)) {
    // NOT_FOUND, never FORBIDDEN: a wrong token must be indistinguishable from
    // a wrong id, or the error itself confirms which order ids are real.
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
}

export const checkoutRouter = createTRPCRouter({
  /**
   * Hand the buyer a Stripe Checkout URL for a pending order (spec §7.1 step 3).
   *
   * **Idempotent by construction.** Two tabs, a double-click, or a retry after a
   * slow response must never produce two Sessions: two Sessions are two
   * PaymentIntents, and a buyer can pay both. The stored `stripe_session_id` is
   * read *before* anything is created — the unique index on that column only
   * fires on the write, by which time Stripe has already minted the session and
   * the damage is done.
   */
  createCheckoutSession: baseProcedure
    .input(orderRef)
    .mutation(async ({ input }) => {
      assertToken(input.orderId, input.token);

      const order = await db.query.orders.findFirst({
        where: eq(orders.id, input.orderId),
        with: {
          items: { with: { ticketType: { columns: { name: true } } } },
          event: { columns: { title: true, slug: true } },
        },
      });

      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });

      // A paid order must never get a second session — that is how one buyer is
      // charged twice for one set of seats.
      if (order.status !== 'pending') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            order.status === 'paid'
              ? 'This order is already paid.'
              : 'This order is no longer open.',
        });
      }

      if (order.holdExpiresAt <= new Date()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Your ten minutes ran out. Please choose your tickets again.',
        });
      }

      // ── Reuse before create. ──
      if (order.stripeSessionId) {
        const existing = await stripe.checkout.sessions.retrieve(
          order.stripeSessionId,
        );

        if (existing.status === 'open' && existing.url) {
          return {
            url: existing.url,
            holdExpiresAt: order.holdExpiresAt,
          };
        }

        // `complete` means the webhook is in flight or has landed. The buyer
        // should be polling, not paying again.
        if (existing.status === 'complete') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This order has already been paid.',
          });
        }

        // `expired` while the hold is somehow still live: fall through and mint
        // a fresh one rather than stranding the buyer on a dead link.
      }

      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: order.items.map((item) => ({
            quantity: item.quantity,
            price_data: {
              currency: CURRENCY,
              // The price the ORDER recorded, never re-read from `ticket_types`.
              // A tier's price can change between the hold and this call, and
              // the buyer must be charged what they were quoted — and what
              // `total_piastres` says we will owe them on a refund.
              unit_amount: toStripeAmount(item.unitPricePiastres),
              product_data: {
                name: `${order.event.title} — ${item.ticketType.name}`,
              },
            },
          })),
          customer_email: order.buyerEmail,
          client_reference_id: order.id,
          metadata: { orderId: order.id },
          // Mirrored onto the PaymentIntent because `payment_intent.payment_failed`
          // carries no session — without this, a decline cannot find its order.
          payment_intent_data: { metadata: { orderId: order.id } },
          expires_at: Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60,
          // Back to the event the buyer came from, with `?paid=` naming the
          // order so the page can open the ticket modal over it. Issues nothing
          // and carries no Stripe session id: the webhook is the source of
          // truth (spec §7.1, "Never issue tickets on the redirect"), and this
          // parameter only tells the page *which* order to ask about — it can
          // prove nothing on its own, since the modal's query still demands the
          // token from `sessionStorage`.
          success_url: `${appUrl()}/e/${order.event.slug}?paid=${order.id}`,
          // A read-only page. See `releaseHold` for why this must not mutate.
          cancel_url: `${appUrl()}/checkout/${order.id}?back=1`,
        },
        // Belt and braces against a retried call racing the read above: the same
        // key returns the same Session rather than a second one.
        { idempotencyKey: `checkout:${order.id}` },
      );

      // Guarded claim. If a concurrent call won the race, zero rows come back
      // and we expire the session we just made rather than leaving a payable
      // link nobody is tracking.
      const [claimed] = await db
        .update(orders)
        .set({
          stripeSessionId: session.id,
          checkoutExpiresAt: new Date(session.expires_at * 1000),
        })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.status, 'pending'),
            isNull(orders.stripeSessionId),
          ),
        )
        .returning();

      if (!claimed) {
        await stripe.checkout.sessions.expire(session.id).catch(() => {});

        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Checkout was already started for this order. Reload the page.',
        });
      }

      return { url: session.url!, holdExpiresAt: order.holdExpiresAt };
    }),

  /**
   * Give the seats back — the buyer pressed Back, or their countdown ran out.
   *
   * **Only ever reached by an explicit click.** Stripe's `cancel_url` points at
   * a read-only page, never at this: arriving there is not evidence of not
   * paying (a buyer can pay, then hit Back twice), and link previewers and
   * prefetchers issue GETs nobody asked for. An unauthenticated GET that
   * cancelled an order would let a stray request release seats someone had
   * already paid for.
   */
  releaseHold: baseProcedure.input(orderRef).mutation(async ({ input }) => {
    assertToken(input.orderId, input.token);

    return db.transaction(async (tx) => {
      // Lock the order first, so this cannot interleave with the webhook's
      // fulfilment — otherwise we read `pending`, it writes `paid`, and we
      // write `expired` over a sale.
      const { rows } = await tx.execute(sql`
        SELECT id, status, stripe_session_id, event_id
        FROM orders WHERE id = ${input.orderId} FOR UPDATE
      `);

      const row = rows[0] as
        | {
            id: string;
            status: string;
            stripe_session_id: string | null;
            event_id: string;
          }
        | undefined;

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      // ── Guard 1: never cancel something already settled. This is the
      //    paid-then-Back race. Not an error — the buyer did nothing wrong, and
      //    the UI should send them to their tickets.
      if (row.status !== 'pending') {
        return { released: false, status: row.status };
      }

      // ── Guard 2: ask Stripe, not the browser.
      if (row.stripe_session_id) {
        const session = await stripe.checkout.sessions.retrieve(
          row.stripe_session_id,
        );

        // They paid; the webhook is on its way. Leave the hold exactly where it
        // is so §6.3 finds it valid and issues their tickets.
        if (session.status === 'complete') {
          return { released: false, status: 'paying' as const };
        }

        // An async method sitting between authorised and settled. Releasing
        // here would free a seat that is about to be bought.
        if (session.status === 'open' && session.payment_status !== 'unpaid') {
          return { released: false, status: 'paying' as const };
        }

        if (session.status === 'open') {
          // Slam Stripe's 31-minute window shut. Without this the session stays
          // payable for another twenty minutes after we have resold the seat —
          // manufacturing the §6.3 refund branch on purpose.
          await stripe.checkout.sessions
            .expire(row.stripe_session_id)
            .catch(() => {});
        }
      }

      const [released] = await tx
        .update(orders)
        .set({
          status: 'expired',
          // Pushed to now as well as the status, so the derived §5.3 query frees
          // the seat on either condition rather than relying on one of them.
          holdExpiresAt: new Date(),
        })
        // Conditional, so a webhook that committed between the SELECT and here
        // still wins.
        .where(and(eq(orders.id, input.orderId), eq(orders.status, 'pending')))
        .returning();

      if (!released) return { released: false, status: 'paid' as const };

      // The seats are back, and this event may have been `sold_out` only
      // because of this hold.
      await syncSoldOut(tx, row.event_id);

      return { released: true, status: 'expired' as const };
    });
  }),

  /**
   * What the countdown page polls (spec §7.1 step 7: "The redirect page just
   * polls the order status").
   *
   * Deliberately thin. It is a public procedure reachable with an order id, so
   * it returns no buyer email and no line items — the token exists precisely so
   * the ticket page can require more than an id. `ticketUrl` appears only once
   * the order is paid, because before then there is nothing to look at.
   */
  orderStatus: baseProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ input }) => {
      const order = await db.query.orders.findFirst({
        columns: {
          id: true,
          status: true,
          holdExpiresAt: true,
          totalPiastres: true,
          lastPaymentError: true,
        },
        where: eq(orders.id, input.orderId),
      });

      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });

      return {
        status: order.status,
        holdExpiresAt: order.holdExpiresAt,
        totalPiastres: order.totalPiastres,
        lastPaymentError: order.lastPaymentError,
        ticketUrl: order.status === 'paid' ? orderTicketUrl(order.id) : null,
      };
    }),

  /**
   * Ask Stripe directly whether this order was paid, and fulfil it if so.
   *
   * **A safety net, not the normal path.** The webhook is still the source of
   * truth and handles every ordinary purchase. This exists because a webhook can
   * genuinely fail to arrive — `stripe listen` dies in development, an endpoint
   * is misconfigured in production, Stripe has an incident — and the buyer is
   * then sitting on a paid order that will never become tickets.
   *
   * Safe to call repeatedly. It re-reads the session from Stripe rather than
   * trusting the caller, and `fulfilOrder` is idempotent: a second call on a
   * paid order returns `already-paid` and issues nothing.
   *
   * Rate-limited because it reaches an external API on every call, and requires
   * the token because it is a write path in all but name.
   */
  reconcile: rateLimitedProcedure('reconcile', 6, 60_000)
    .input(orderRef)
    .mutation(async ({ input }) => {
      assertToken(input.orderId, input.token);

      const order = await db.query.orders.findFirst({
        columns: { id: true, status: true, stripeSessionId: true, eventId: true },
        where: eq(orders.id, input.orderId),
      });

      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });

      // Nothing to reconcile: either already settled, or never reached Stripe.
      if (order.status !== 'pending' || !order.stripeSessionId) {
        return { changed: false, status: order.status };
      }

      const session = await stripe.checkout.sessions.retrieve(
        order.stripeSessionId,
      );

      if (session.payment_status !== 'paid') {
        return { changed: false, status: order.status };
      }

      // Paid at Stripe but still pending here — the webhook never landed. Run
      // the same §6.3 machine it would have, in its own transaction.
      const result = await db.transaction(async (tx) =>
        fulfilOrder(tx, {
          orderId: order.id,
          paymentIntentId:
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id,
        }),
      );

      // Mail after the commit, never inside it (see `lib/mail-send.ts`).
      if (result.outcome === 'issued' || result.outcome === 'refunded') {
        const event = await db.query.events.findFirst({
          columns: FULFILMENT_EVENT_COLUMNS,
          where: eq(events.id, result.order.event_id),
        });

        if (event) await deliverFulfilmentMail(result, event);
      }

      return { changed: result.outcome === 'issued', status: result.outcome };
    }),

  /**
   * The buyer's tickets with their QR codes already rendered, for the modal
   * that opens on the event page the moment payment clears.
   *
   * The QR images are rasterised **here on the server** and sent down as data
   * URLs, exactly as the standalone ticket page does it. The raw `secret` never
   * crosses to the browser: a secret in a client payload is one `view-source`
   * away from being copied, whereas a PNG has to be photographed.
   *
   * Returns nothing until the order is actually paid — before the webhook lands
   * there are no tickets, and this must never imply otherwise.
   */
  ticketsForModal: baseProcedure
    .input(orderRef)
    .query(async ({ input }) => {
      assertToken(input.orderId, input.token);

      const order = await db.query.orders.findFirst({
        where: eq(orders.id, input.orderId),
        with: {
          event: { columns: { title: true, venue: true, startsAt: true } },
          tickets: { with: { ticketType: { columns: { name: true } } } },
        },
      });

      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });

      if (order.status !== 'paid') {
        return { ready: false as const, status: order.status };
      }

      const stubs = await Promise.all(
        order.tickets
          .filter((ticket) => !ticket.voidedAt)
          .map(async (ticket) => ({
            id: ticket.id,
            tierName: ticket.ticketType.name,
            qr: await qrDataUrl(ticket.secret),
          })),
      );

      return {
        ready: true as const,
        status: order.status,
        eventTitle: order.event.title,
        venue: order.event.venue,
        startsAt: order.event.startsAt,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        totalPiastres: order.totalPiastres,
        ticketUrl: orderTicketUrl(order.id),
        stubs,
      };
    }),

  /**
   * The buyer's tickets, behind the magic-link token (spec §8).
   *
   * The token is re-verified here even though the page already checked it:
   * AGENTS.md's "two layers of authorisation, always" — a page guard is a
   * redirect, a procedure guard is the permission, and this procedure is
   * reachable without ever rendering that page.
   */
  orderWithTickets: baseProcedure
    .input(orderRef)
    .query(async ({ input }) => {
      assertToken(input.orderId, input.token);

      const order = await db.query.orders.findFirst({
        where: eq(orders.id, input.orderId),
        with: {
          event: {
            columns: {
              title: true,
              venue: true,
              startsAt: true,
              slug: true,
            },
          },
          tickets: { with: { ticketType: { columns: { name: true } } } },
        },
      });

      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });

      return order;
    }),
});
