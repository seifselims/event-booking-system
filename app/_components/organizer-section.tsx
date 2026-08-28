"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/lib/trpc/react";

import { Rack } from "./rack";

/**
 * One organizer's public page — their identity, then their rack.
 *
 * The input object must match the page's `prefetch` exactly or the query key
 * misses and this refetches on the client (docs/prefetching/).
 *
 * Their events go through the same `Rack` as the landing page: filters stay on
 * (a promoter with a mixed programme is exactly who benefits from them), and
 * search stays on for the same reason.
 */
export function OrganizerSection({ id }: { id: string }) {
  const trpc = useTRPC();
  const { data: organizer } = useSuspenseQuery(
    trpc.events.getOrganizer.queryOptions({ id }),
  );

  return (
    <>
      <div className="shell org-head">
        {organizer.image ? (
          /* Free-form URL column, as with event posters — next/image would need
             images.remotePatterns configured first. */
          // eslint-disable-next-line @next/next/no-img-element
          <img className="org-head-img" src={organizer.image} alt="" />
        ) : null}

        <div>
          <span className="org-head-eyebrow">Organizer</span>
          <h1 className="org-head-name">{organizer.name}</h1>
        </div>
      </div>

      <Rack
        events={organizer.events}
        heading={
          organizer.events.length === 1
            ? "One thing on sale"
            : `${organizer.events.length} things on sale`
        }
      />
    </>
  );
}
