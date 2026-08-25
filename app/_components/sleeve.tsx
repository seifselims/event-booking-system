import { formatEGP, formatEventDate } from "@/lib/format";
import type { EventListItem } from "@/lib/trpc/types";

import { SleeveArt } from "./event-art";

/**
 * The hero object: a record sleeve with its vinyl peeking out, and the event's
 * tiers set as a numbered track listing.
 *
 * The lift and the vinyl slide are CSS-only (`.sleeve:hover`), so this stays a
 * Server Component.
 */
export function Sleeve({ event }: { event: EventListItem }) {
  return (
    <div className="sleeve-stage">
      <div className="sleeve">
        <div className="vinyl" aria-hidden="true" />

        <div className="sleeve-art">
          <SleeveArt />
        </div>

        <div className="listing">
          <div className="listing-h">
            <span>{event.title}</span>
            <span>{formatEventDate(event.startsAt)}</span>
          </div>

          {event.ticketTypes.map((tier, i) => (
            <div className="trk" key={tier.id}>
              <b>{String(i + 1).padStart(2, "0")}</b>
              <span>{tier.name}</span>
              <i>{formatEGP(tier.pricePiastres).replace("EGP ", "")}</i>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
