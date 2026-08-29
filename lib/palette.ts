/**
 * Rack card colours — each sleeve in the rack carries its own ground.
 *
 * `rk` / `rkink` are set as inline custom properties on the card and read by
 * the `.rk*` rules in globals.css (`.rk-date` inverts the pair).
 *
 * `field` is the section ground the page cross-fades to while that card is
 * hovered. It DUPLICATES the `#s1:has(.rk:nth-child(N):hover)` rules in
 * globals.css, because CSS cannot read a descendant's custom property from an
 * ancestor. Keep this array's order in lockstep with those six rules — and note
 * they assume nothing precedes the cards inside `.rack-grid`.
 *
 * Every `field` clears 4.5:1 against white (DESIGN.md § Motion).
 */
export type RackColour = {
  /** Card ground. */
  rk: string;
  /** Card ink — text, and the date pill's background. */
  rkink: string;
  /** Section ground while this card is hovered. Mirrored in globals.css. */
  field: string;
};

/**
 * The paper an event page's content objects sit on — the ticket panel, and the
 * art panel behind a poster.
 *
 * A fixed cream panel works on turquoise but disappears on the cream and beige
 * grounds, which are two of the six. So the panel is chosen against the ground:
 * light grounds get brown paper, dark and saturated grounds get cream. Both
 * pairs are straight from the palette and clear 4.5:1.
 *
 * Keyed by the ground's own hex so it cannot drift out of step with
 * `RACK_PALETTE` — a new entry that isn't listed here falls back to cream,
 * which is correct for any saturated ground.
 */
const LIGHT_GROUNDS = new Set(["#F6D6B3", "#FFF8EE", "#FFC93C"]);

export type PanelColour = {
  /** Panel ground. */
  panel: string;
  /** Panel ink. */
  panelInk: string;
};

export function panelFor(colour: RackColour): PanelColour {
  return LIGHT_GROUNDS.has(colour.rk.toUpperCase())
    ? { panel: "#3A1F16", panelInk: "#FFF8EE" }
    : { panel: "#FFF8EE", panelInk: "#3A1F16" };
}

export const RACK_PALETTE: readonly RackColour[] = [
  { rk: "#00C7C3", rkink: "#3A1F16", field: "#0A6E6B" },
  { rk: "#F6D6B3", rkink: "#3A1F16", field: "#6E5230" },
  { rk: "#E8452C", rkink: "#FFF8EE", field: "#B8291B" },
  { rk: "#FFC93C", rkink: "#3A1F16", field: "#7A5400" },
  { rk: "#3A1F16", rkink: "#F6D6B3", field: "#2A1610" },
  { rk: "#FFF8EE", rkink: "#3A1F16", field: "#73310F" },
];

/** Cards cycle through the palette by position in the rack. */
export function rackColour(index: number): RackColour {
  return RACK_PALETTE[index % RACK_PALETTE.length]!;
}

/**
 * The colour to use for an event when no position is available — a pasted or
 * shared `/e/[slug]` link, or a bookmark.
 *
 * Cards are coloured by POSITION (`rackColour`), which is what guarantees six
 * distinct colours on a full page — a hash cannot promise that, and repeats are
 * visible and ugly in a six-up grid. Position, though, is not a property of the
 * event: it changes between `/`, `/tonight`, and an organizer's page, so the
 * event page cannot derive it. It is passed down the link instead
 * (`?c=`, see `paletteIndexFrom`), and this hash is the fallback for when that
 * parameter is absent.
 *
 * **Callers pass the SLUG, not the id**, so `/e/[slug]`'s loading fallback can
 * derive the same colour from the URL alone, before anything is fetched — the
 * page and its skeleton must agree or every navigation flashes.
 *
 * FNV-1a — tiny, dependency-free, and well spread over short ASCII slugs.
 */
export function eventColour(key: string): RackColour {
  return RACK_PALETTE[eventSlot(key)]!;
}

/**
 * Read a palette slot off a `?c=` query value.
 *
 * The value comes from a URL, so it is untrusted: anything that is not an
 * in-range integer returns `null` and the caller falls back to the slug hash.
 * That also covers the ordinary cases — a shared link, a bookmark, someone
 * typing the address — which carry no `c` at all.
 */
export function paletteIndexFrom(value: unknown): number | null {
  if (typeof value !== "string") return null;

  const index = Number(value);

  if (!Number.isInteger(index)) return null;
  if (index < 0 || index >= RACK_PALETTE.length) return null;

  return index;
}

/**
 * Which of the six authored `EventArt` variants an event uses when it has no
 * poster.
 *
 * Keyed to the SLUG rather than to position, unlike the card's colour: this is
 * the event's picture, so it should be the same one on the card and the page
 * without needing the link to carry it. Two identical illustrations in a grid
 * also read as far less of a repeat than two identical flat grounds — and most
 * events have a real poster, so this is the uncommon path.
 */
export function eventArtVariant(key: string): number {
  return eventSlot(key);
}

/** FNV-1a over the key, folded to a palette slot. Tiny, dependency-free, and
 *  well spread over the short ASCII slugs the app uses. */
function eventSlot(key: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    // The classic 16777619 multiply, via imul to stay in 32-bit range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash % RACK_PALETTE.length;
}
