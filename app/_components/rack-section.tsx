"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/lib/trpc/react";

import { Hero } from "./hero";
import { Marquee } from "./marquee";
import { Rack } from "./rack";

/**
 * The data-bearing half of the landing page.
 *
 * This is the only client component in the tree, and it exists purely to read
 * the listing that `app/page.tsx` has already prefetched — `useSuspenseQuery`
 * resolves from the hydrated cache on first paint, so there is no spinner and
 * no client-side fetch on load.
 *
 * `Hero`, `Marquee`, and `Rack` stay presentational and take their data as
 * props, so the CSS-only interactions below this point are unchanged.
 */
export function RackSection() {
  const trpc = useTRPC();
  const { data: events } = useSuspenseQuery(
    trpc.events.listEvents.queryOptions(),
  );

  const [featured] = events;

  return (
    <>
      {featured && <Hero featured={featured} totalEvents={events.length} />}

      <Marquee />

      <Rack events={events} />
    </>
  );
}
