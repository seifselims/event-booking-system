import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EventSection } from "../../_components/event-section";
import { EventSurface } from "../../_components/event-surface";
import { TicketModal } from "../../_components/ticket-modal";

import { paletteIndexFrom } from "@/lib/palette";
import { caller, HydrateClient, prefetch, trpc } from "@/lib/trpc/server";

/**
 * The public event page — where a rack card has always pointed, and until now
 * the 404 that stopped a buyer reaching a ticket at all.
 *
 * The ground is the event's own colour — the same `eventColour(slug)` its rack
 * card carries — so opening a card lands on that card's ground rather than a
 * different one. It lives in `EventSurface`, which `loading.tsx` renders too:
 * keyed to the slug, the field is known from the URL alone, so the fallback and
 * the finished page paint the same colour. Every pair comes from
 * `RACK_PALETTE`, whose ground/ink combinations are already contrast-checked
 * (DESIGN.md § Colour); the page never picks its own colours, which is what
 * keeps `#FF5A00` off copy.
 *
 * This widens DESIGN.md's "event `#00C7C3`" from one fixed ground to the
 * palette — turquoise is still one of the six, no longer the only one.
 *
 * `force-dynamic` for the same reason as `/tonight` and `/organizers`:
 * `getEventBySlug` filters on `IS_PAST` and derives availability from `now()`,
 * both per-request. A build-time snapshot would show stale seat counts.
 */
export const dynamic = "force-dynamic";

/**
 * The title is the event's own, so the tab is useful with several open.
 *
 * This resolves the same query the page then prefetches; both hit the same
 * request-scoped context, so it is not an extra round trip. A missing event
 * falls through to the default rather than throwing — `notFound()` in the page
 * is what turns it into a 404.
 */
export async function generateMetadata({
  params,
}: PageProps<"/e/[slug]">): Promise<Metadata> {
  const { slug } = await params;

  try {
    const event = await (await caller()).events.getEventBySlug({ slug });

    return {
      title: `${event.title} — Gate`,
      description: `${event.title} at ${event.venue}. Tickets on Gate.`,
    };
  } catch {
    return { title: "Event — Gate" };
  }
}

export default async function EventPage({
  params,
  searchParams,
}: PageProps<"/e/[slug]">) {
  const { slug } = await params;

  // `?c=` is the slot the clicked card sat in, so the page opens on that card's
  // ground. Untrusted — `paletteIndexFrom` returns null for anything out of
  // range, and for the ordinary case of a link that never had it.
  const paletteIndex = paletteIndexFrom((await searchParams).c);

  // ORDER MATTERS. `prefetch` is fire-and-forget, so starting it *first* lets
  // it run while the existence check below is awaited — the two overlap instead
  // of queueing. Awaiting the check first would serialise them and hold the
  // whole page for two sequential round trips, which is a visible blank on a
  // cold connection.
  prefetch(trpc.events.getEventBySlug.queryOptions({ slug }));

  // `prefetch` swallows the NOT_FOUND throw, which would otherwise stream a 200
  // with an empty shell — so existence is checked directly, one of the narrow
  // cases `caller()` exists for (lib/trpc/server.tsx). Both share the
  // request-scoped context, so this resolves against work already in flight
  // rather than issuing a second query.
  try {
    await (await caller()).events.getEventBySlug({ slug });
  } catch {
    notFound();
  }

  return (
    <EventSurface slug={slug} paletteIndex={paletteIndex}>
      <HydrateClient>
        <EventSection slug={slug} />

        {/* Opens over this page when Stripe returns with `?paid=<orderId>`.
            Suspense because it reads `useSearchParams`, which opts its subtree
            into client-side rendering — without a boundary that would deopt the
            whole page. It renders nothing at all without the parameter. */}
        <Suspense fallback={null}>
          <TicketModal />
        </Suspense>
      </HydrateClient>
    </EventSurface>
  );
}
