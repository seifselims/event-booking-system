"use client";

import { useMemo, useState } from "react";

import { EVENT_CATEGORIES, categoryLabel } from "@/lib/categories";
import type { EventCategory } from "@/lib/categories";
import type { EventListItem } from "@/lib/trpc/types";

import { Pager } from "./pager";
import { RackCard } from "./rack-card";

/** "All" is not a category — it is the absence of a filter. */
type Filter = EventCategory | "all";

/**
 * Sleeves per page.
 *
 * SIX IS LOAD-BEARING, not a layout preference. The ground cross-fade in
 * globals.css is six rules — `#s1:has(.rk:nth-child(1..6):hover)` — while
 * `rackColour` wraps at `index % 6`. A seventh card therefore takes card one's
 * colour but matches no rule, so hovering it fades the ground to nothing.
 * Capping a page at six keeps every rendered card inside the rules that exist.
 *
 * Raising this means adding the matching `nth-child` rules and `RACK_PALETTE`
 * entries together, in lockstep (lib/palette.ts).
 */
const PAGE_SIZE = 6;

export function Rack({
  events,
  heading = "Out now",
  empty = "Nothing on sale right now. Check back — the rack refills every week.",
  filters = true,
  search = true,
}: {
  events: EventListItem[];
  /** The rack head. `/tonight` reuses the grid under its own title. */
  heading?: string;
  empty?: string;
  filters?: boolean;
  /** `/tonight` is a short, time-boxed list where searching is noise. */
  search?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);

  // Only categories the rack actually holds get a pill: a "Sport" pill that can
  // only ever empty the grid is worse than no pill at all. Ordered by
  // `EVENT_CATEGORIES` rather than by first appearance, so the row doesn't
  // reshuffle as the listing changes.
  const available = useMemo(() => {
    const present = new Set(events.map((event) => event.category));
    return EVENT_CATEGORIES.filter((category) => present.has(category));
  }, [events]);

  // A filter can outlive the category that justified it (the listing refetches
  // and that category is gone), which would strand the rack on an empty grid
  // with no pill pressed. Fall back to "all" for the render rather than holding
  // a filter nothing can satisfy.
  const active = filter !== "all" && !available.includes(filter) ? "all" : filter;

  const query = term.trim().toLowerCase();

  // Category, then search. Both narrow the same list, and the order only
  // matters for the empty-state copy below — which of the two emptied the rack.
  //
  // Both are applied client-side over the fully prefetched listing, which keeps
  // one query key with no inputs to keep in sync (docs/prefetching/) and makes
  // typing instant. Past a few hundred events these belong in the procedure's
  // input instead, alongside the page number.
  const shown = useMemo(() => {
    const byCategory =
      active === "all"
        ? events
        : events.filter((event) => event.category === active);

    if (!query) return byCategory;

    return byCategory.filter(
      (event) =>
        event.title.toLowerCase().includes(query) ||
        event.venue.toLowerCase().includes(query),
    );
  }, [events, active, query]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));

  // Clamped on render rather than corrected in an effect: filtering down while
  // on a later page would otherwise paint one empty grid before the fix lands.
  // Same defensive shape as `active` above — hold the state, render the truth.
  const current = Math.min(page, pageCount - 1);

  const paged = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  /** Any change to what is being shown puts you back at the first page. */
  function narrow(change: () => void) {
    change();
    setPage(0);
  }

  return (
    <div className="shell rack" id="rack">
      <div className="rack-head">
        <h2>{heading}</h2>

        <div className="rack-tools">
          {search && events.length > 0 && (
            <input
              type="search"
              className="rack-search"
              value={term}
              onChange={(e) => narrow(() => setTerm(e.target.value))}
              placeholder="Search events"
              aria-label="Search events by title or venue"
            />
          )}

          {/* One pill is pointless — with a single category, "All" and it select
              the same rack. */}
          {filters && available.length > 1 && (
            <div className="rack-filters">
              {(["all", ...available] as Filter[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`pill pill-sm ${
                    option === active ? "pill-solid" : "pill-ghost"
                  }`}
                  aria-pressed={option === active}
                  onClick={() => narrow(() => setFilter(option))}
                >
                  {option === "all" ? "All" : categoryLabel(option)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        // `empty` is written for an empty rack. When a filter or a search term
        // is what emptied it the rack is not actually bare, so say the true
        // thing instead — and name whichever one the reader can undo.
        <p className="hero-lead">
          {query
            ? `Nothing matching “${term.trim()}”${
                active === "all" ? "" : ` under ${categoryLabel(active)}`
              }. Try another search.`
            : active === "all"
              ? empty
              : `Nothing under ${categoryLabel(active)} right now. Try another shelf.`}
        </p>
      ) : (
        // NOTE: the ground cross-fade in globals.css targets
        // `#s1:has(.rk:nth-child(N):hover)`, so nothing may precede the cards
        // inside this grid or the six colour rules shift by one. For the same
        // reason off-page cards are sliced away rather than hidden — CSS counts
        // hidden siblings, so `display: none` would break the indices.
        //
        // The index passed to each card is its position in the RENDERED page,
        // not in `events` — those rules key off `nth-child`, so a card's colour
        // has to follow where it actually sits or the hovered ground stops
        // matching the sleeve under the cursor.
        <div className="rack-grid">
          {paged.map((event, i) => (
            <RackCard key={event.id} event={event} index={i} />
          ))}
        </div>
      )}

      <Pager
        page={current}
        pageCount={pageCount}
        onPage={setPage}
        label="Event pages"
      />
    </div>
  );
}
