import Link from "next/link";

import { formatEventDate } from "@/lib/format";
import type { OrganizerListItem } from "@/lib/trpc/types";
import { rackColour } from "@/lib/palette";

import { EventArt } from "./event-art";

/**
 * One organizer in the grid — the rack sleeve's counterpart.
 *
 * Deliberately the same object as `RackCard`: same palette by position, same
 * art slot with the same fallback when there is no picture, same foot. A buyer
 * moving between `/` and `/organizers` should recognise the shelf, not learn a
 * second card.
 *
 * `.og` rather than `.rk`, because `.rk` carries the ground cross-fade's
 * `nth-child` contract on the landing page (globals.css). The two share their
 * visual rules through a selector list there; only the hover-fade is `.rk`'s.
 */
export function OrganizerCard({
  organizer,
  index,
}: {
  organizer: OrganizerListItem;
  index: number;
}) {
  const colour = rackColour(index);

  return (
    <Link
      className="og"
      href={`/organizers/${organizer.id}`}
      style={
        {
          "--rk": colour.rk,
          "--rkink": colour.rkink,
        } as React.CSSProperties
      }
    >
      <div className="rk-art">
        {organizer.image ? (
          /* `image` is a free-form URL column like `posterUrl` — it holds either
             an upload of ours or a pasted link, so next/image would need
             images.remotePatterns configured first. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={organizer.image} alt="" />
        ) : (
          <EventArt variant={index} />
        )}

        <span className="rk-date">{formatEventDate(organizer.nextStartsAt)}</span>
      </div>

      <div className="rk-body">
        <h3>{organizer.name}</h3>
        <span className="rk-venue">
          {organizer.events} {organizer.events === 1 ? "event" : "events"} on
          sale
        </span>

        <div className="rk-foot">
          <div className="rk-price">
            <b>See them all</b>
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
