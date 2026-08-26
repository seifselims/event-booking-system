/**
 * Display helpers for public-facing event data.
 *
 * Money is stored as integer piastres (AGENTS.md): `250.00 EGP` is `25000`.
 * Nothing here ever does maths on the divided value — it divides once, at the
 * last moment, purely to render.
 */

/** Events are displayed in the venue's local time, not the server's or the viewer's. */
const EVENT_TIME_ZONE = "Africa/Cairo";

/** `45000` → `"EGP 450"`. Whole piastres are dropped when the amount is round. */
export function formatEGP(piastres: number): string {
  const pounds = piastres / 100;
  const hasFraction = piastres % 100 !== 0;

  return `EGP ${new Intl.NumberFormat("en-EG", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(pounds)}`;
}

/** Cheapest tier, in piastres. Returns null when an event has no tiers yet. */
export function minPrice(
  ticketTypes: readonly { pricePiastres: number }[],
): number | null {
  if (ticketTypes.length === 0) return null;
  return Math.min(...ticketTypes.map((t) => t.pricePiastres));
}

/**
 * Total seats across every tier.
 *
 * This is capacity, NOT live availability. Availability is derived from orders
 * under a row lock (spec §5.3) and that layer isn't built yet — when it lands,
 * this is the one function the badge should stop calling.
 */
export function capacityOf(
  ticketTypes: readonly { quantity: number }[],
): number {
  return ticketTypes.reduce((total, t) => total + t.quantity, 0);
}

/**
 * `"SAT 12 SEP"`.
 *
 * The time zone is pinned explicitly: without it the server renders in the
 * container's zone (usually UTC) and the client in the viewer's, which
 * hydration-mismatches on any event near midnight.
 */
/**
 * A `Date` as `"YYYY-MM-DDTHH:mm"` **in Cairo**, for `<input type="datetime-local">`.
 *
 * The obvious `date.toISOString().slice(0, 16)` is wrong here: it renders UTC, so
 * a 21:00 Cairo door shows as 19:00 in the editor, and saving it back shifts the
 * event by the offset every single time. Formatting through `Intl` with the zone
 * pinned — the same trick `formatEventDate` uses — keeps the field showing the
 * clock the organizer actually means.
 */
export function toCairoInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: EVENT_TIME_ZONE,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // `hour12: false` renders midnight as "24" in some ICU versions.
  const hour = get("hour") === "24" ? "00" : get("hour");

  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/**
 * The inverse: `"YYYY-MM-DDTHH:mm"` typed as Cairo wall-clock time, back to the
 * real instant it names.
 *
 * Found by probing — guess that the wall-clock string is UTC, measure how far
 * that guess lands from Cairo's clock, then correct by the difference. One
 * correction settles it for every offset including DST, and re-deriving the
 * offset *after* the shift catches the case where the correction itself crosses
 * a DST boundary.
 */
export function fromCairoInputValue(value: string): Date | null {
  if (!value) return null;

  const guess = new Date(`${value}:00Z`);
  if (Number.isNaN(guess.getTime())) return null;

  const offsetAt = (instant: Date) => {
    // What Cairo's clock reads at `instant`, read back as if it were UTC.
    const asUTC = new Date(`${toCairoInputValue(instant)}:00Z`);
    return asUTC.getTime() - instant.getTime();
  };

  const corrected = new Date(guess.getTime() - offsetAt(guess));

  // Re-check: if the correction crossed a DST change, the offset differs there.
  return new Date(guess.getTime() - offsetAt(corrected));
}

export function formatEventDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: EVENT_TIME_ZONE,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // `en-GB` renders September as "Sept"; the design sets every month in three.
  const month = get("month").replace(".", "").slice(0, 3);

  return `${get("weekday")} ${get("day")} ${month}`.toUpperCase();
}
