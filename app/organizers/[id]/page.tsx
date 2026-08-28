import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrganizerSection } from "../../_components/organizer-section";
import { SiteNav } from "../../_components/site-nav";

import { caller, HydrateClient, prefetch, trpc } from "@/lib/trpc/server";

export const metadata: Metadata = {
  title: "Organizer — Gate",
};

/**
 * One organizer's public page: everything of theirs still on sale.
 *
 * `getOrganizer` excludes past events via `IS_PAST`, which Postgres evaluates
 * against `now()` — per-request data, so this must never be prerendered (same
 * reasoning as `/tonight` and `/organizers`).
 *
 * The `{ id }` input has to match the client's `queryOptions({ id })` exactly,
 * or the key misses and it refetches (docs/prefetching/).
 *
 * `getOrganizer` throws NOT_FOUND for a non-organizer, an unknown id, or an
 * organizer with nothing visible — which is the whole visibility rule, so there
 * is nothing to check separately here. But `prefetch` is fire-and-forget and
 * swallows that throw: the page would then stream a 200 with an empty shell.
 * So the existence check is a direct `caller()` read — one of the narrow cases
 * that helper is for (lib/trpc/server.tsx) — and `notFound()` turns it into a
 * real 404. The `prefetch` below still runs so the client reads from the
 * hydrated cache rather than refetching; both hit the same request-scoped
 * context, so this is not a second round trip to the database's benefit.
 */
export const dynamic = "force-dynamic";

export default async function OrganizerPage({
  params,
}: PageProps<"/organizers/[id]">) {
  const { id } = await params;

  try {
    await (await caller()).events.getOrganizer({ id });
  } catch {
    notFound();
  }

  prefetch(trpc.events.getOrganizer.queryOptions({ id }));

  return (
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
        <b>Side A</b> &middot; Organizer
      </div>

      <SiteNav current="organizers" />

      <HydrateClient>
        <OrganizerSection id={id} />
      </HydrateClient>
    </section>
  );
}
