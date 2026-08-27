import type { Metadata } from "next";
import Link from "next/link";

import { StatTiles } from "../_components/stat-tiles";
import { EventsTable } from "../_components/events-table";

import { requireUser } from "@/lib/session";
import { HydrateClient, prefetch, trpc } from "@/lib/trpc/server";

export const metadata: Metadata = {
  title: "Dashboard — Gate",
  robots: { index: false, follow: false },
};

/**
 * The organizer console (spec §8): headline numbers over the events list.
 *
 * Follows the prefetch pattern (docs/prefetching/): both queries are warmed
 * into this request's QueryClient and handed to the client through
 * `HydrateClient`, so `StatTiles` and `EventsTable` resolve from the hydrated
 * cache on first paint — no spinner, and no client-side fetch on load.
 *
 * `prefetch` is deliberately not awaited; the two calls run in parallel and the
 * components suspend on the same query keys until they resolve.
 *
 * Both procedures are scoped by `protectedProcedure`; an admin sees every
 * organizer's events through the same call.
 */
export default async function DashboardPage() {
  // Session data, not a tRPC query — the layout has already guaranteed a user.
  const user = await requireUser();

  prefetch(trpc.events.getMyTotals.queryOptions());
  prefetch(trpc.events.getMyEventsWithStats.queryOptions());

  const firstName = (user.name || user.email).split(/[\s@]/)[0];

  return (
    <div className="shell console-shell">
      <div className="console-head">
        <div>
          <p className="gate-eyebrow">
            {user.role === "admin" ? "Every event on the platform" : "Your events"}
          </p>
          <h1 className="console-title">
            Evening, <em>{firstName}</em>.
          </h1>
        </div>

        <Link className="pill pill-turq" href="/dashboard/events/new">
          New event
        </Link>
      </div>

      <HydrateClient>
        <StatTiles />

        <EventsTable isAdmin={user.role === "admin"} />
      </HydrateClient>
    </div>
  );
}
