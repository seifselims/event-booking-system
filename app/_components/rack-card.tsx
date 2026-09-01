import Link from "next/link";

import { formatEGP, formatEventDate, minPrice } from "@/lib/format";
import type { EventListItem } from "@/lib/trpc/types";
import { eventArtVariant, rackColour, RACK_PALETTE } from "@/lib/palette";

import { EventArt } from "./event-art";

/** Below this many seats, the badge switches to the turquoise "hot" treatment. */
const SCARCE_THRESHOLD = 100;

/**
 * One sleeve in the rack.
 *
 * The badge shows **live remaining seats** (spec §5.3), computed by the listing
 * procedure via `availabilityByEvent` — paid orders and unexpired holds both
 * count as taken, and both release the moment they stop qualifying.
 *
 * It used to show `capacityOf(ticketTypes)`, the organizer's configured total,
 * which never moved as tickets sold. That is not a stale number but a wrong one,
 * and it is the number a buyer decides on.
 *
 * Still a *display* value: no seat is reserved until an order exists, and
 * `createOrder` recomputes under a row lock. Two people can read "3 left" at the
 * same instant and only one of them can act on it.
 */
export function RackCard({
  event,
  index,
}: {
  event: EventListItem;
  index: number;
}) {
  // Colour is POSITIONAL, which is what guarantees six distinct grounds on a
  // full page — a per-event hash cannot promise that, and repeats in a six-up
  // grid are the first thing you notice.
  //
  // Position is not a property of the event, though, so `/e/[slug]` cannot
  // re-derive it: the link carries it as `?c=`, and the page falls back to the
  // slug hash when it is absent (lib/palette.ts). Art stays keyed to the slug —
  // it is the event's picture, not its slot's.
  const colour = rackColour(index);
  const from = minPrice(event.ticketTypes);
  // `sold_out` is the organizer-visible status; `remaining === 0` is what
  // availability actually says. Either one means nothing is buyable, and the
  // second catches the window before `syncSoldOut` has flipped the status.
  const remaining = event.remaining;
  const soldOut = event.status === "sold_out" || remaining <= 0;
  const scarce = !soldOut && remaining < SCARCE_THRESHOLD;

  return (
    <Link
      className="rk"
      href={`/e/${event.slug}?c=${index % RACK_PALETTE.length}`}
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
          <EventArt variant={eventArtVariant(event.slug)} />
        )}

        <span className="rk-date">{formatEventDate(event.startsAt)}</span>

        <span className={`rk-left${scarce ? " hot" : ""}`}>
          {soldOut
            ? "Sold out"
            : `${remaining.toLocaleString("en-EG")} left`}
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
