import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';
import { MAIL_FROM, mailer } from '@/lib/mail';
import { apologyEmail, ticketEmail } from '@/lib/mail-templates';
import { qrPngBuffer } from '@/lib/qr';

/**
 * Sending the buyer's mail, and recording that we tried.
 *
 * **Never call these inside the fulfilment transaction.** SMTP is a network call
 * to a third party: holding the ticket-type row locks across it would serialise
 * every other buyer behind a slow relay, and a bounce would roll back a payment
 * we have already taken.
 *
 * **Never let these throw.** By the time they run the tickets exist and are live
 * at the buyer's link. Throwing would 500 the webhook, Stripe would retry, the
 * idempotency row would be gone with the rolled-back transaction, and fulfilment
 * would run again — issuing a *second* set of tickets because a mail server was
 * down. A missed email is recoverable; duplicate tickets are not.
 *
 * Every attempt writes a `jobs` row (spec §7.1 step 8 wants a worker; there
 * isn't one — see `docs/DEFERRED-JOBS.md`). Sending inline means the buyer
 * actually gets their tickets today; the row means a failure is visible, and
 * retryable with a `WHERE completed_at IS NULL` the day a runner lands.
 */

type SendOutcome = { sent: boolean };

async function recordJob(
  type: string,
  payload: Record<string, unknown>,
  error: string | null,
) {
  try {
    await db.insert(jobs).values({
      id: randomUUID(),
      type,
      payload,
      attempts: 1,
      lastError: error,
      // Left null on failure, which is exactly what a future worker will look
      // for. Set on success so nothing re-sends a mail that already arrived.
      completedAt: error ? null : new Date(),
    });
  } catch (jobError) {
    // The bookkeeping failing must not take down the caller either.
    console.error('[mail] could not record job row', type, jobError);
  }
}

type TicketMailInput = {
  orderId: string;
  buyerName: string;
  buyerEmail: string;
  eventTitle: string;
  venue: string;
  startsAt: Date;
  totalPiastres: number;
  tickets: { id: string; secret: string; tierName: string }[];
  ticketUrl: string;
};

export async function sendTicketEmail(
  input: TicketMailInput,
): Promise<SendOutcome> {
  try {
    // One `cid:` per ticket. Gmail and most clients strip `data:` URIs in
    // `<img src>`, so an inline attachment is the only form that renders — a
    // data URL would reach the buyer as a broken image and no ticket.
    const attachments = await Promise.all(
      input.tickets.map(async (ticket) => ({
        filename: `ticket-${ticket.id.slice(0, 8)}.png`,
        content: await qrPngBuffer(ticket.secret),
        cid: `qr-${ticket.id}`,
      })),
    );

    const body = ticketEmail({
      buyerName: input.buyerName,
      eventTitle: input.eventTitle,
      venue: input.venue,
      startsAt: input.startsAt,
      totalPiastres: input.totalPiastres,
      tickets: input.tickets.map((ticket) => ({
        id: ticket.id,
        tierName: ticket.tierName,
        cid: `qr-${ticket.id}`,
      })),
      ticketUrl: input.ticketUrl,
    });

    await mailer.sendMail({
      from: MAIL_FROM,
      to: input.buyerEmail,
      subject: body.subject,
      text: body.text,
      html: body.html,
      attachments,
    });

    await recordJob('email.tickets', { orderId: input.orderId }, null);

    return { sent: true };
  } catch (error) {
    console.error('[mail] ticket email failed', input.orderId, error);

    await recordJob(
      'email.tickets',
      { orderId: input.orderId },
      error instanceof Error ? error.message : String(error),
    );

    return { sent: false };
  }
}

type ApologyMailInput = {
  orderId: string;
  buyerName: string;
  buyerEmail: string;
  eventTitle: string;
  totalPiastres: number;
};

export async function sendApologyEmail(
  input: ApologyMailInput,
): Promise<SendOutcome> {
  try {
    const body = apologyEmail({
      buyerName: input.buyerName,
      eventTitle: input.eventTitle,
      totalPiastres: input.totalPiastres,
    });

    await mailer.sendMail({
      from: MAIL_FROM,
      to: input.buyerEmail,
      subject: body.subject,
      text: body.text,
      html: body.html,
    });

    await recordJob('email.apology', { orderId: input.orderId }, null);

    return { sent: true };
  } catch (error) {
    // Worse than a missed ticket email: the buyer has been refunded and does
    // not know why. Logged loudly, and the job row is the trail back to it.
    console.error('[mail] apology email failed', input.orderId, error);

    await recordJob(
      'email.apology',
      { orderId: input.orderId },
      error instanceof Error ? error.message : String(error),
    );

    return { sent: false };
  }
}
