import { RackSection } from "./_components/rack-section";
import { SiteNav } from "./_components/site-nav";

import { HydrateClient, prefetch, trpc } from "@/lib/trpc/server";

/**
 * Never prerender. Building the tRPC context reads `next/headers` (session +
 * rate-limit IP), which throws during a static render — and the listing is
 * per-request anyway, since `remaining` is derived live.
 */
export const dynamic = "force-dynamic";

/**
 * The public landing page — "Side A", the rack.
 *
 * Server half: prefetch the listing into this request's QueryClient and hand
 * it to the client through `HydrateClient`. `prefetch` is deliberately not
 * awaited — it is fire-and-forget, and `RackSection` suspends on the same
 * query key until it resolves (docs/prefetching/).
 *
 * Everything outside `RackSection` — the ground, the side mark, the nav — stays
 * a Server Component, and the interactions inside it (ground cross-fade, sleeve
 * lift, marquee) remain CSS-only.
 */
export default function Home() {
  prefetch(trpc.events.listEvents.queryOptions());

  return (
    <section
      className="side"
      id="s1"
      style={
        {
          "--ground": "var(--color-tangerine)",
          "--ink": "#fff",
        } as React.CSSProperties
      }
    >
      <div className="side-mark" aria-hidden="true">
        <b>Side A</b> &middot; The rack
      </div>

      <SiteNav />

      <HydrateClient>
        <RackSection />
      </HydrateClient>
    </section>
  );
}
