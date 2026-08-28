import type { Metadata } from "next";
import { Suspense } from "react";

import { OrganizersSection } from "../_components/organizers-section";
import { SiteNav } from "../_components/site-nav";

import { HydrateClient, prefetch, trpc } from "@/lib/trpc/server";

export const metadata: Metadata = {
  title: "Organizers — Gate",
  description: "Everyone putting on events in Cairo, and everything they have on sale.",
};

/**
 * The public organizer index — Side A's rack, cut by who is putting it on
 * rather than by what is playing.
 *
 * `listOrganizers` filters to events that are publicly visible *and* still to
 * come, which `IS_PAST` evaluates against `now()` in Postgres — so this is
 * per-request data and must never be prerendered, the same reasoning as
 * `/tonight`.
 */
export const dynamic = "force-dynamic";

export default function OrganizersPage() {
  prefetch(trpc.events.listOrganizers.queryOptions());

  return (
    // No `id="s1"`: the ground cross-fade is six `nth-child` rules bound to the
    // landing page's sleeves (globals.css). `/tonight` set the precedent — the
    // other public grids keep the ground and skip the fade.
    <section
      className="side"
      style={
        {
          "--ground": "var(--color-tangerine)",
          "--ink": "#fff",
        } as React.CSSProperties
      }
    >
      <div className="side-mark" aria-hidden="true">
        <b>Side A</b> &middot; Organizers
      </div>

      <SiteNav current="organizers" />

      <HydrateClient>
        <Suspense fallback={<div className="shell rack" aria-hidden="true" />}>
          <OrganizersSection />
        </Suspense>
      </HydrateClient>
    </section>
  );
}
