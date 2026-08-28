"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/lib/trpc/react";

import { Rack } from "./rack";

/**
 * The data-bearing half of `/tonight`, and the counterpart to `RackSection`:
 * it reads the listing the page has already prefetched, so there is no spinner
 * and no client-side fetch on load.
 *
 * The category filters and the search box are both hidden here: this is the
 * rest of one evening, a list short enough to read, and the rack head's second
 * slot is already carrying the count. Pagination still applies — six sleeves is
 * a page whether or not you can filter them.
 */
export function TonightSection() {
  const trpc = useTRPC();
  const { data: events } = useSuspenseQuery(
    trpc.events.listTonight.queryOptions(),
  );

  return (
    <Rack
      events={events}
      heading={
        events.length === 0
          ? "Nothing tonight"
          : `${events.length} ${events.length === 1 ? "door" : "doors"} tonight`
      }
      empty="No doors open tonight in Cairo. The rack is still full — flip back and pick another night."
      filters={false}
      search={false}
    />
  );
}
