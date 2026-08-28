"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/lib/trpc/react";

import { OrganizersGrid } from "./organizers-grid";

/**
 * The data-bearing half of `/organizers`, and the counterpart to
 * `RackSection`: it reads the index the page has already prefetched, so there
 * is no spinner and no client-side fetch on load (docs/prefetching/).
 */
export function OrganizersSection() {
  const trpc = useTRPC();
  const { data: organizers } = useSuspenseQuery(
    trpc.events.listOrganizers.queryOptions(),
  );

  return <OrganizersGrid organizers={organizers} />;
}
