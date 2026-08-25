import Link from "next/link";

import { capacityOf, formatEGP, formatEventDate, minPrice } from "@/lib/format";
import type { EventListItem } from "@/lib/trpc/types";
import { rackColour } from "@/lib/palette";

import { EventArt } from "./event-art";

/** Below this many seats, the badge switches to the turquoise "hot" treatment. */
const SCARCE_THRESHOLD = 100;

/**
 * One sleeve in the rack.
 *
 * Note the badge shows CAPACITY, not live remaining — availability is derived
 * from orders under a row lock (spec §5.3) and that layer isn't built. When it
 * lands, this component should take a `remaining` prop instead of calling
 * `capacityOf`.
 */
export function RackCard({
  event,
  index,
}: {
  event: EventListItem;
  index: number;
}) {
  const colour = rackColour(index);
  const from = minPrice(event.ticketTypes);
  const capacity = capacityOf(event.ticketTypes);
  const soldOut = event.status === "sold_out";
  const scarce = !soldOut && capacity > 0 && capacity < SCARCE_THRESHOLD;

  return (
    <Link
      className="rk"
      href={`/e/${event.slug}`}
      style={
        {
          "--rk": colour.rk,
          "--rkink": colour.rkink,
        } as React.CSSProperties
      }
    >
      <div className="rk-art">
        {event.posterUrl ? (
          /* posterUrl is a free-form URL column, so next/image would need
             images.remotePatterns configured first. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.posterUrl} alt="" />
        ) : (
          <EventArt variant={index} />
        )}

        <span className="rk-date">{formatEventDate(event.startsAt)}</span>

        <span className={`rk-left${scarce ? " hot" : ""}`}>
          {soldOut ? "Sold out" : `${capacity.toLocaleString("en-EG")} seats`}
        </span>
      </div>

      <div className="rk-body">
        <h3>{event.title}</h3>
        <span className="rk-venue">{event.venue}</span>

        <div className="rk-foot">
          <div className="rk-price">
            {from === null ? (
              <b>TBA</b>
            ) : (
              <>
                <b className="num">{formatEGP(from)}</b>
                <span>from</span>
              </>
            )}
          </div>

          <span className="rk-go" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}
