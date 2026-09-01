import { formatEGP, formatEventDate } from "@/lib/format";
import { HydrateClient } from "@/lib/trpc/server";

import { TicketAwait } from "./ticket-await";

/**
 * The issued tickets, one stub each (spec §7.1 step 7).
 *
 * A **Server** Component: the QR data URLs are rendered upstream and arrive as
 * props. Keeping it server-side keeps ticket secrets out of the client bundle —
 * they reach the browser only as already-rasterised images.
 *
 * The one client island is `TicketAwait`, mounted while the order is still
 * pending: the webhook that issues the tickets can land *after* this page
 * renders, and without a poll the buyer would sit on a promise the page never
 * keeps.
 *
 * Reuses the `.stub` grammar from `globals.css` (DESIGN.md § Components), whose
 * `.stub-tear` notches are punched in `var(--ground)` — so they read as holes in
 * the turquoise field this page sets, with no per-page colour work.
 */
export function TicketStubs({
  orderId,
  status,
  eventTitle,
  venue,
  startsAt,
  buyerName,
  totalPiastres,
  stubs,
}: {
  orderId: string;
  status: string;
  eventTitle: string;
  venue: string;
  startsAt: Date;
  buyerName: string;
  totalPiastres: number;
  stubs: {
    id: string;
    tierName: string;
    checkedInAt: Date | null;
    qr: string;
  }[];
}) {
  // Paid at Stripe, but the webhook has not landed yet. The redirect issues
  // nothing by design, so this is the normal path for a second or two — say
  // what is happening rather than showing an empty page that looks like a loss,
  // and actually watch for it rather than only claiming to.
  if (status === "pending") {
    return (
      <div className="shell tk">
        <div className="tk-head">
          <h1 className="tk-title">{eventTitle}</h1>
          <p className="tk-note">
            We&rsquo;re confirming your payment. This page updates itself within
            a few seconds — you can safely leave it open.
          </p>

          <HydrateClient>
            <TicketAwait orderId={orderId} />
          </HydrateClient>
        </div>
      </div>
    );
  }

  if (status === "refunded" || status === "expired") {
    return (
      <div className="shell tk">
        <div className="tk-head">
          <h1 className="tk-title">{eventTitle}</h1>
          <p className="tk-note">
            This order was refunded, so its tickets are no longer valid. If you
            were charged, the money is on its way back to your card.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell tk">
      <div className="tk-head">
        <h1 className="tk-title">{eventTitle}</h1>

        <div className="tk-facts">
          <div>
            <span>When</span>
            <b>
              <time dateTime={startsAt.toISOString()}>
                {formatEventDate(startsAt)}
              </time>
            </b>
          </div>
          <div>
            <span>Where</span>
            <b>{venue}</b>
          </div>
          <div>
            <span>Paid</span>
            <b className="num">{formatEGP(totalPiastres)}</b>
          </div>
        </div>
      </div>

      <div className="tk-grid">
        {stubs.map((stub, i) => (
          <div className="stub tk-stub" key={stub.id}>
            <div className="stub-head">
              <span>{stub.tierName}</span>
              <b>
                {String(i + 1).padStart(2, "0")}/
                {String(stubs.length).padStart(2, "0")}
              </b>
            </div>

            <div className="tk-qr">
              {/* Already a data URL; next/image would only add indirection. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stub.qr} alt="" width={200} height={200} />
            </div>

            <div className="tk-holder">{buyerName}</div>

            {stub.checkedInAt && (
              <div className="tk-used">
                Scanned in at{" "}
                <time dateTime={stub.checkedInAt.toISOString()}>
                  {new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                    timeZone: "Africa/Cairo",
                  }).format(stub.checkedInAt)}
                </time>
              </div>
            )}

            {/* The perforation. Its notches show the section's ground through
                the paper — see `.stub-tear` in globals.css. */}
            <div className="stub-tear">ADMIT ONE</div>
          </div>
        ))}
      </div>

      <p className="tk-fine">
        📸 Screenshot these if you like — you can also reopen this page any time
        from the link in your confirmation email. Keep it private: anyone who
        opens the link can use these tickets.
      </p>
    </div>
  );
}
