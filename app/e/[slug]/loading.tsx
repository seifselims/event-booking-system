"use client";

import { useParams, useSearchParams } from "next/navigation";

import { EventSurface } from "../../_components/event-surface";

import { paletteIndexFrom } from "@/lib/palette";

/**
 * Suspense boundary for the public event page.
 *
 * A **Client** Component, deliberately. `loading.tsx` takes no props — "Loading
 * UI components do not accept any parameters" — so the only way to know which
 * event is loading is to read the URL, which `useParams` and `useSearchParams`
 * do. Both inputs the page uses come from there (the slug, and the clicked
 * card's slot in `?c=`), so this fallback paints the *same* field the finished
 * page will and the ground never changes during the load. Anything derived
 * from the fetched event instead would force a guess here, and every navigation
 * would flash one colour before settling on another.
 *
 * It renders the same `EventSurface` as the page, so the ground, the side mark,
 * and the nav are not placeholders — they are the real thing, already in place.
 * Only the content below them is skeletal, mirroring the page's two-column
 * shape so nothing jumps when it lands.
 */
export default function Loading() {
  const params = useParams<{ slug: string }>();
  // Same two inputs the page reads, so the skeleton and the finished page paint
  // the identical ground and nothing changes colour mid-load.
  const paletteIndex = paletteIndexFrom(useSearchParams().get("c"));

  return (
    <EventSurface slug={params.slug} paletteIndex={paletteIndex}>
      {/* `role="status"` so a screen reader announces the wait; the shapes
          themselves are decorative. */}
      <div className="shell ev" role="status" aria-label="Loading event">
        <div className="ev-art sk" aria-hidden="true" />

        <div className="ev-body" aria-hidden="true">
          <div className="sk sk-chip" />
          <div className="sk sk-title" />
          <div className="sk sk-facts" />
          <div className="sk sk-panel" />
        </div>
      </div>
    </EventSurface>
  );
}
