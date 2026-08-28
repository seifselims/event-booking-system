/**
 * Event categories — the rack's filter pills, the editor's picker, and the
 * `events.category` column all read this one list.
 *
 * The stored value is the lowercase key; `EVENT_CATEGORY_LABELS` is the only
 * place a display string lives, so renaming a label never touches the database.
 *
 * **Keep this in lockstep with the `category` enum in `lib/db/schema.ts`** —
 * Drizzle's column enum is a literal list and cannot import from here without
 * breaking `drizzle-kit`'s static read of the schema file.
 *
 * `other` is the column default: every event has a category, so the filter never
 * has to reason about nulls, and an event whose organizer didn't choose one
 * still appears under "All".
 */
export const EVENT_CATEGORIES = [
  "music",
  "comedy",
  "conference",
  "sport",
  "theatre",
  "film",
  "art",
  "food",
  "nightlife",
  "workshop",
  "other",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  music: "Music",
  comedy: "Comedy",
  conference: "Conference",
  sport: "Sport",
  theatre: "Theatre",
  film: "Film",
  art: "Art",
  food: "Food",
  nightlife: "Nightlife",
  workshop: "Workshop",
  other: "Other",
};

export function categoryLabel(category: EventCategory) {
  return EVENT_CATEGORY_LABELS[category];
}
