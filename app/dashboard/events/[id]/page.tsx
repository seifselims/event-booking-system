import type { Metadata } from "next";

import { EventEditor } from "../../../_components/event-editor";

import { HydrateClient, prefetch, trpc } from "@/lib/trpc/server";

export const metadata: Metadata = {
  title: "Event — Gate",
  robots: { index: false, follow: false },
};

/**
 * One event, as its organizer sees it (spec §8): details, ticket tiers, status.
 *
 * Follows the prefetch pattern (docs/prefetching/) — `getMyEvent` is warmed into
 * this request's QueryClient and handed to the client through `HydrateClient`,
 * so `EventEditor` resolves from the hydrated cache on first paint. The `{ id }`
 * input has to match the client's `queryOptions({ id })` exactly, or the key
 * misses and it refetches.
 *
 * `getMyEvent` returns tiers with the event, so there is nothing else to warm.
 *
 * The `/dashboard` layout already runs `requireUser()`; the real permission is
 * `getMyEvent`'s ownership filter, which throws NOT_FOUND for an event that
 * isn't the caller's (and widens for admins).
 */
export default async function EventPage({
  params,
}: PageProps<"/dashboard/events/[id]">) {
  const { id } = await params;

  prefetch(trpc.events.getMyEvent.queryOptions({ id }));

  return (
    <div className="shell console-shell">
      <HydrateClient>
        <EventEditor id={id} />
      </HydrateClient>
    </div>
  );
}
