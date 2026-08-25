"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/lib/trpc/react";

import { Rack } from "./rack";

/**
 * The data-bearing half of `/tonight`, and the counterpart to `RackSection`:
 * it reads the listing the page has already prefetched, so there is no spinner
 * and no client-side fetch on load.
 *
 * The category filters are hidden here — the rack head's second slot is the
 * count, and there is no category column to filter on anyway.
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
      more={false}
    />
  );
}
