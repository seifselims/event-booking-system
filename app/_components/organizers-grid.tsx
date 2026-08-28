"use client";

import { useMemo, useState } from "react";

import type { OrganizerListItem } from "@/lib/trpc/types";

import { OrganizerCard } from "./organizer-card";
import { Pager } from "./pager";

/**
 * The organizer index, paged and searchable.
 *
 * The rack's twin — same page size and the same reason for it (see `Rack`),
 * same search-then-slice order, same clamp-on-render. There are no category
 * pills: an organizer is not on one shelf, and filtering people by the
 * categories of their events would be a different, murkier control.
 */
const PAGE_SIZE = 6;

export function OrganizersGrid({
  organizers,
}: {
  organizers: OrganizerListItem[];
}) {
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);

  const query = term.trim().toLowerCase();

  const shown = useMemo(
    () =>
      query
        ? organizers.filter((organizer) =>
            organizer.name.toLowerCase().includes(query),
          )
        : organizers,
    [organizers, query],
  );

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const paged = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  return (
    <div className="shell rack">
      <div className="rack-head">
        <h2>
          {organizers.length === 0
            ? "No organizers yet"
            : "Who's putting it on"}
        </h2>

        {organizers.length > 0 && (
          <div className="rack-tools">
            <input
              type="search"
              className="rack-search"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setPage(0);
              }}
              placeholder="Search organizers"
              aria-label="Search organizers by name"
            />
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="hero-lead">
          {query
            ? `No organizer matching “${term.trim()}”. Try another name.`
            : "Nobody has anything on sale right now. Check back — the rack refills every week."}
        </p>
      ) : (
        <div className="rack-grid">
          {paged.map((organizer, i) => (
            <OrganizerCard
              key={organizer.id}
              organizer={organizer}
              index={i}
            />
          ))}
        </div>
      )}

      <Pager
        page={current}
        pageCount={pageCount}
        onPage={setPage}
        label="Organizer pages"
      />
    </div>
  );
}
