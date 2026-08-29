import { eventColour, panelFor, RACK_PALETTE } from "@/lib/palette";

import { SiteNav } from "./site-nav";

/**
 * The event page's field — ground, ink, and the paper its content objects sit
 * on — plus the chrome that stands on it.
 *
 * The colour comes from `paletteIndex` when the link carried one (`?c=`), so
 * the page opens on the ground of the card that was clicked. Rack cards are
 * coloured by position — that is what keeps six on a page distinct — and
 * position is not something this page can re-derive, hence passing it down.
 *
 * Without it (a shared link, a bookmark, a typed address) it falls back to
 * hashing the SLUG. Either way the colour is known from the URL alone, before
 * anything is fetched — which is what lets `loading.tsx` paint the same field.
 * That matters because `loading.tsx` takes no params ("Loading UI components do
 * not accept any parameters", `next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/loading.md`); a colour that needed the fetched event
 * would force it to guess, and every navigation would flash.
 *
 * Shared by `page.tsx` and its `loading.tsx` so both paint the same field, and
 * the only thing that changes when the content arrives is the content.
 */
export function EventSurface({
  slug,
  paletteIndex,
  children,
}: {
  slug: string;
  /** Slot the clicked card sat in, from `?c=`. Null when the link had none. */
  paletteIndex?: number | null;
  children: React.ReactNode;
}) {
  const colour =
    paletteIndex === null || paletteIndex === undefined
      ? eventColour(slug)
      : RACK_PALETTE[paletteIndex]!;
  // The ticket panel has to stay legible on all six grounds — a fixed cream
  // panel vanishes on the cream and beige ones (lib/palette.ts).
  const { panel, panelInk } = panelFor(colour);

  return (
    <section
      className="side side-full"
      style={
        {
          "--ground": colour.rk,
          "--ink": colour.rkink,
          "--panel": panel,
          "--panel-ink": panelInk,
        } as React.CSSProperties
      }
    >
      <div className="side-mark" aria-hidden="true">
        <b>Side D</b> &middot; Event
      </div>

      <SiteNav current="rack" />

      {children}
    </section>
  );
}
