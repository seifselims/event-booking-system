import type { EventListItem } from "@/lib/trpc/types";

import { RackCard } from "./rack-card";

/**
 * Filters are presentational for now — the schema has no category column, so
 * there is nothing to filter on. They keep the rack head's composition and
 * cost no client JS. Wire them up when `events.category` exists.
 */
const FILTERS = ["All", "Music", "Comedy", "Conference", "Sport"];

export function Rack({
  events,
  heading = "Out now",
  empty = "Nothing on sale right now. Check back — the rack refills every week.",
  filters = true,
  more = true,
}: {
  events: EventListItem[];
  /** The rack head. `/tonight` reuses the grid under its own title. */
  heading?: string;
  empty?: string;
  filters?: boolean;
  more?: boolean;
}) {
  return (
    <div className="shell rack" id="rack">
      <div className="rack-head">
        <h2>{heading}</h2>

        {filters && (
          <div className="rack-filters">
            {FILTERS.map((filter, i) => (
              <button
                key={filter}
                type="button"
                className={`pill pill-sm ${i === 0 ? "pill-solid" : "pill-ghost"}`}
                aria-pressed={i === 0}
              >
                {filter}
              </button>
            ))}
          </div>
        )}
      </div>

      {events.length === 0 ? (
        <p className="hero-lead">{empty}</p>
      ) : (
        // NOTE: the ground cross-fade in globals.css targets
        // `#s1:has(.rk:nth-child(N):hover)`, so nothing may precede the cards
        // inside this grid or the six colour rules shift by one.
        <div className="rack-grid">
          {events.map((event, i) => (
            <RackCard key={event.id} event={event} index={i} />
          ))}
        </div>
      )}

      {more && events.length > 0 && (
        <div className="rack-foot">
          <button type="button" className="pill pill-ghost">
            Show the rest
          </button>
        </div>
      )}
    </div>
  );
}
