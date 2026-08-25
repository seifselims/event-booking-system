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
