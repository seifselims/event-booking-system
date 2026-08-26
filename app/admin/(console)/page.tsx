import type { Metadata } from "next";

import { AllEventsTable } from "../../_components/all-events-table";
import { OrganizersPanel } from "../../_components/organizers-panel";
import { PlatformTiles } from "../../_components/platform-tiles";

import { requireAdmin } from "@/lib/session";
import { HydrateClient, prefetch, trpc } from "@/lib/trpc/server";

export const metadata: Metadata = {
  title: "Platform — Gate",
  robots: { index: false, follow: false },
};

/**
 * The platform console (spec §8): totals and every event, across every
 * organizer, plus the organizer roster the admin door promises.
 *
 * Follows the prefetch pattern (docs/prefetching/): all three queries are
 * warmed into this request's QueryClient and handed to the client through
 * `HydrateClient`, so each panel resolves from the hydrated cache on first
 * paint. `prefetch` is deliberately not awaited — the three calls run in
 * parallel and each component suspends on its own key.
 *
 * There is no admin CRUD here. Per spec §2 ("platform admin is a role, not a
 * section") the events table links into the ordinary organizer editor, which
 * widens for admins through `getMyEvent`.
 */
export default async function AdminPage() {
  // Session data, not a tRPC query — the layout has already guaranteed an admin.
  const user = await requireAdmin();

  prefetch(trpc.admin.platformTotals.queryOptions());
  prefetch(trpc.admin.listAllEvents.queryOptions());
  prefetch(trpc.admin.listOrganizers.queryOptions());

  return (
    <div className="shell console-shell">
      <div className="console-head">
        <div>
          <p className="gate-eyebrow">Across every organizer</p>
          <h1 className="console-title">
            The <em>platform</em>.
          </h1>
        </div>
      </div>

      <HydrateClient>
        <PlatformTiles />

        <AllEventsTable />

        <OrganizersPanel currentUserId={user.id} />
      </HydrateClient>
    </div>
  );
}
