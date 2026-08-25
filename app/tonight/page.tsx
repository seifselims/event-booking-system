import type { Metadata } from "next";
import { Suspense } from "react";

import { SiteNav } from "../_components/site-nav";
import { TonightSection } from "../_components/tonight-section";

import { HydrateClient, prefetch, trpc } from "@/lib/trpc/server";

export const metadata: Metadata = {
  title: "Tonight — Gate",
  description: "Every door opening in Cairo between now and midnight.",
};

/**
 * The nav's "Tonight" (spec §8, public). Side A's rack narrowed to the rest of
 * the current Cairo day — same ground, same sleeves, no hero.
 *
 * `now()` is evaluated per request inside `listTonight`, so this page must never
 * be prerendered: what is on tonight changes by the hour, and a build-time
 * snapshot would be wrong within minutes.
 */
export const dynamic = "force-dynamic";

export default function TonightPage() {
  prefetch(trpc.events.listTonight.queryOptions());

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
        <b>Side A</b> &middot; Tonight
      </div>

      <SiteNav current="tonight" />

      <HydrateClient>
        <Suspense fallback={<div className="shell rack" aria-hidden="true" />}>
          <TonightSection />
        </Suspense>
      </HydrateClient>
    </section>
  );
}
