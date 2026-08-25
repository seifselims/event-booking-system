import Link from "next/link";

import type { EventListItem } from "@/lib/trpc/types";
import { RACK_PALETTE } from "@/lib/palette";

import { Sleeve } from "./sleeve";

/**
 * First viewport. The headline and the featured sleeve, with a strip of colour
 * chips standing in for the rest of the rack.
 */
export function Hero({
  featured,
  totalEvents,
}: {
  featured: EventListItem;
  totalEvents: number;
}) {
  return (
    <div className="hero">
      <div className="shell hero-in">
        <div>
          <h1 className="hero-title">
            Tickets for
            <br />
            the night
            <br />
            <em>you&rsquo;ll keep.</em>
          </h1>

          <p className="hero-lead">
            No account. No app. Pick your seats, pay, and the QR lands in your
            inbox before you&rsquo;ve put your phone away.
          </p>

          <div className="hero-acts">
            <Link className="pill pill-solid" href="#rack">
              Flip the rack &rarr;
            </Link>
            <Link className="pill pill-ghost" href="/tickets">
              I have a ticket
            </Link>
          </div>

          <div className="rack-strip">
            <div className="rack-chips" aria-hidden="true">
              {RACK_PALETTE.map((colour) => (
                <i key={colour.rk} style={{ background: colour.rk }} />
              ))}
            </div>
            <span>
              {totalEvents} {totalEvents === 1 ? "sleeve" : "sleeves"} out this
              month
            </span>
          </div>
        </div>

        <Sleeve event={featured} />
      </div>
    </div>
  );
}
