import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TicketStubs } from "../../../_components/ticket-stubs";

import { verifyOrderToken } from "@/lib/checkout";
import { qrDataUrl } from "@/lib/qr";
import { caller } from "@/lib/trpc/server";

/**
 * The buyer's tickets, behind a magic link (spec §8, §7.1 step 7).
 *
 * Buyers are guests with no account, so this URL *is* the credential. That
 * shapes the whole page: no login, no session, and `robots: noindex` because a
 * crawled ticket link is a given-away ticket.
 *
 * `caller()` rather than the prefetch pattern — one of the narrow cases
 * `lib/trpc/server.tsx` documents it for. The QR images are rendered here on the
 * server and handed down as props; no Client Component ever reads this query,
 * so routing it through the cache would buy nothing.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your tickets — Gate",
  robots: { index: false, follow: false },
};

export default async function TicketsPage({
  params,
}: PageProps<"/orders/[id]/[token]">) {
  const { id, token } = await params;

  // Verified BEFORE any query runs. A wrong token has to be indistinguishable
  // from a wrong id — same 404, no extra database work, nothing in the timing
  // that says "right order, wrong token".
  if (!verifyOrderToken(id, token)) notFound();

  let order;

  try {
    // The procedure re-verifies the token itself. That is not redundant:
    // AGENTS.md's "two layers of authorisation, always" — this page guard is a
    // redirect, the procedure guard is the permission, and the procedure is
    // reachable without ever rendering this page.
    order = await (await caller()).checkout.orderWithTickets({
      orderId: id,
      token,
    });
  } catch {
    notFound();
  }

  // Rendered from `secret` at request time, never stored (`lib/qr.ts`).
  const stubs = await Promise.all(
    order.tickets
      .filter((ticket) => !ticket.voidedAt)
      .map(async (ticket) => ({
        id: ticket.id,
        tierName: ticket.ticketType.name,
        checkedInAt: ticket.checkedInAt,
        qr: await qrDataUrl(ticket.secret),
      })),
  );

  return (
    <section
      className="side side-full"
      style={
        {
          // DESIGN.md pins tickets to turquoise. Unlike `/e/[slug]`, this page
          // takes no `?c=` — it is not reached from a rack card, and a ticket
          // should look the same every time its owner opens it.
          "--ground": "var(--color-turquoise)",
          "--ink": "var(--color-brown)",
        } as React.CSSProperties
      }
    >
      <div className="side-mark" aria-hidden="true">
        <b>Side F</b> &middot; Tickets
      </div>

      <TicketStubs
        orderId={id}
        status={order.status}
        eventTitle={order.event.title}
        venue={order.event.venue}
        startsAt={order.event.startsAt}
        buyerName={order.buyerName}
        totalPiastres={order.totalPiastres}
        stubs={stubs}
      />
    </section>
  );
}
