import { formatEGP, formatEventDate } from '@/lib/format';

/**
 * Ticket and apology emails.
 *
 * Plain strings, no template engine — these are two messages, and a dependency
 * would cost more than it saves. Both carry a text alternative: a QR image with
 * no text part reads as spam to most filters, and the buyer may be on a client
 * that shows text only.
 *
 * Colours are inlined rather than tokenised. Email clients strip `<style>` and
 * do not resolve CSS custom properties, so the design tokens in `globals.css`
 * cannot reach here — these hexes are DESIGN.md's brown/beige/turquoise
 * transcribed by hand, and they have to be kept in step by hand too.
 */

const BROWN = '#3A1F16';
const BEIGE = '#F6D6B3';
const CREAM = '#FFF8EE';

type TicketEmailInput = {
  buyerName: string;
  eventTitle: string;
  venue: string;
  startsAt: Date;
  totalPiastres: number;
  /** One entry per issued ticket, in the order the attachments are added. */
  tickets: { id: string; tierName: string; cid: string }[];
  ticketUrl: string;
};

export function ticketEmail(input: TicketEmailInput) {
  const count = input.tickets.length;
  const noun = count === 1 ? 'ticket' : 'tickets';

  const subject = `Your ${noun} — ${input.eventTitle}`;

  const text = [
    `Hi ${input.buyerName},`,
    ``,
    `Here ${count === 1 ? 'is' : 'are'} your ${count} ${noun} for ${input.eventTitle}.`,
    ``,
    `When:  ${formatEventDate(input.startsAt)}`,
    `Where: ${input.venue}`,
    `Paid:  ${formatEGP(input.totalPiastres)}`,
    ``,
    `Show the QR code at the door. Your tickets are always available here:`,
    input.ticketUrl,
    ``,
    `Keep this link private — anyone who has it can use these tickets.`,
    ``,
    `— Gate`,
  ].join('\n');

  const stubs = input.tickets
    .map(
      (ticket) => `
      <tr><td style="padding:0 0 18px">
        <table role="presentation" width="100%" style="background:${CREAM};border-radius:14px">
          <tr><td style="padding:20px 22px;text-align:center">
            <div style="font:700 12px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:${BROWN};opacity:.7">
              ${escapeHtml(ticket.tierName)}
            </div>
            <img src="cid:${ticket.cid}" width="200" height="200" alt="Ticket QR code"
                 style="display:block;margin:14px auto;border-radius:8px" />
            <div style="font:400 11px/1.4 ui-monospace,Menlo,Consolas,monospace;color:${BROWN};opacity:.55">
              ${escapeHtml(ticket.id.slice(0, 8))}
            </div>
          </td></tr>
        </table>
      </td></tr>`,
    )
    .join('');

  const html = `
<table role="presentation" width="100%" style="background:${BEIGE};padding:28px 0">
  <tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px">
      <tr><td style="padding:0 0 22px">
        <div style="font:800 26px/1.2 Helvetica,Arial,sans-serif;color:${BROWN}">
          ${escapeHtml(input.eventTitle)}
        </div>
        <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${BROWN};padding-top:6px">
          ${escapeHtml(formatEventDate(input.startsAt))} &middot; ${escapeHtml(input.venue)}
        </div>
      </td></tr>
      ${stubs}
      <tr><td style="padding:4px 0 0">
        <div style="font:400 14px/1.6 Helvetica,Arial,sans-serif;color:${BROWN}">
          Show the QR at the door. Your ${noun} also live at
          <a href="${escapeAttr(input.ticketUrl)}" style="color:${BROWN}">this link</a>
          &mdash; keep it private, anyone who has it can use ${count === 1 ? 'it' : 'them'}.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  return { subject, text, html };
}

type ApologyEmailInput = {
  buyerName: string;
  eventTitle: string;
  totalPiastres: number;
};

/**
 * The §6.3 message: we took the money, the seat was gone, we refunded.
 *
 * This is a genuinely bad experience, so the mail says what happened plainly and
 * does not hide the refund behind cheer. The buyer will see the reversal on
 * their statement in a few days and should already know why.
 */
export function apologyEmail(input: ApologyEmailInput) {
  const subject = `Refunded — ${input.eventTitle}`;

  const text = [
    `Hi ${input.buyerName},`,
    ``,
    `Your payment for ${input.eventTitle} went through, but the last tickets sold`,
    `while it was being processed. We could not honour the order, so we have`,
    `refunded ${formatEGP(input.totalPiastres)} in full.`,
    ``,
    `The refund returns to your original payment method, usually within 5–10`,
    `business days. You have not been charged for anything.`,
    ``,
    `We're sorry — this one is on us.`,
    ``,
    `— Gate`,
  ].join('\n');

  const html = `
<table role="presentation" width="100%" style="background:${BEIGE};padding:28px 0">
  <tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px">
      <tr><td style="padding:22px 24px;background:${CREAM};border-radius:14px">
        <div style="font:800 22px/1.3 Helvetica,Arial,sans-serif;color:${BROWN}">
          We refunded your order
        </div>
        <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${BROWN};padding-top:12px">
          Your payment for <b>${escapeHtml(input.eventTitle)}</b> went through, but the
          last tickets sold while it was being processed. We could not honour the
          order, so we have refunded <b>${escapeHtml(formatEGP(input.totalPiastres))}</b> in full.
        </div>
        <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${BROWN};padding-top:12px">
          It returns to your original payment method, usually within 5&ndash;10
          business days. We're sorry &mdash; this one is on us.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  return { subject, text, html };
}

/**
 * Escape interpolated values.
 *
 * Event titles and buyer names are user-supplied and land inside HTML. Without
 * this a title containing markup would break the layout at best, and at worst
 * carry an injected link into someone's inbox with our From address on it.
 */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
