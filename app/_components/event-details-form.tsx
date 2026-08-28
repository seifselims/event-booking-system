"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  EVENT_CATEGORIES,
  categoryLabel,
  type EventCategory,
} from "@/lib/categories";
import { fromCairoInputValue, toCairoInputValue } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";
import type { RouterOutputs } from "@/lib/trpc/types";

import { PosterField } from "./poster-field";

type Event = RouterOutputs["events"]["getMyEvent"];

/**
 * The editable half of an event, as strings — what the inputs actually hold.
 *
 * `category` is one of a closed set rather than free text, so it is typed as
 * the union: a `<select>` can only ever hold a valid value, and typing it as
 * `string` would push the cast down to the mutation call instead.
 */
type Draft = {
  title: string;
  venue: string;
  category: EventCategory;
  startsAt: string;
  endsAt: string;
  posterUrl: string;
  description: string;
};

function toDraft(event: Event): Draft {
  return {
    title: event.title,
    venue: event.venue,
    category: event.category,
    startsAt: toCairoInputValue(event.startsAt),
    endsAt: event.endsAt ? toCairoInputValue(event.endsAt) : "",
    posterUrl: event.posterUrl ?? "",
    description: event.description ?? "",
  };
}

/**
 * The event's details, editable.
 *
 * Datetimes are handled in Cairo throughout (`lib/format.ts`): the venue's clock
 * is the one the organizer means, and formatting through UTC would silently
 * shift every event by the offset on each save.
 *
 * Only changed fields are sent — `updateEventInput` is `.partial()`, so an
 * untouched field is simply absent rather than being rewritten with its own
 * value.
 */
export function EventDetailsForm({ event }: { event: Event }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // The saved state, as strings, to diff against. Re-seeded on a successful
  // save so the form goes clean again without a refetch round-trip.
  const [saved, setSaved] = useState<Draft>(() => toDraft(event));
  const [draft, setDraft] = useState<Draft>(() => toDraft(event));
  const [justSaved, setJustSaved] = useState(false);

  // Trimmed, so trailing whitespace alone never arms Save. `category` carries
  // no whitespace either way, so the same comparison serves it.
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some(
    (key) => draft[key].trim() !== saved[key].trim(),
  );

  // Live, so the field is marked as soon as the pair stops making sense. The
  // server refuses the same thing independently — validating one date against
  // the other requires reading the stored row, since either may be absent from
  // a partial update.
  const datesInvalid = (() => {
    const startsAt = fromCairoInputValue(draft.startsAt);
    const endsAt = fromCairoInputValue(draft.endsAt);
    return Boolean(startsAt && endsAt && endsAt <= startsAt);
  })();

  const update = useMutation(
    trpc.events.updateEvent.mutationOptions({
      onSuccess: (updated) => {
        const next = toDraft(updated as Event);
        setSaved(next);
        setDraft(next);
        setJustSaved(true);

        // This screen, and the dashboard listing behind it.
        void queryClient.invalidateQueries({
          queryKey: trpc.events.getMyEvent.queryKey({ id: event.id }),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.events.getMyEventsWithStats.queryKey(),
        });
      },
    }),
  );

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setJustSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function onSubmit(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!dirty || update.isPending) return;

    const startsAt = fromCairoInputValue(draft.startsAt);
    if (!startsAt) return;

    if (datesInvalid) return;

    const endsAt = fromCairoInputValue(draft.endsAt);

    update.mutate({
      id: event.id,
      title: draft.title.trim(),
      venue: draft.venue.trim(),
      category: draft.category,
      startsAt,
      // Sent as null when cleared, not omitted — an absent key means "leave it
      // alone", which would make clearing the end time appear to work and then
      // silently keep the old one.
      endsAt: endsAt ?? null,
      // A cleared poster is sent as null rather than omitted — omitting means
      // "leave it alone", which would make Remove appear to work and then
      // silently keep the old image.
      posterUrl: draft.posterUrl.trim() || null,
      ...(draft.description.trim()
        ? { description: draft.description.trim() }
        : {}),
    });
  }

  const pending = update.isPending;

  return (
    <form className="ed-body" onSubmit={onSubmit} noValidate>
      {update.error ? (
        <p className="gate-error" role="alert">
          {update.error.data?.code === "NOT_FOUND"
            ? "That event no longer exists, or it isn't yours to edit."
            : update.error.data?.code === "BAD_REQUEST"
              ? // Says what was actually wrong — the server validates dates
                // against the stored row, so it can refuse things the form
                // could not see.
                update.error.message
              : "Couldn't save those changes. Try again in a moment."}
        </p>
      ) : null}

      <div className="ed-grid">
        <label className="fld fld-wide">
          <span>Title</span>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={200}
            required
            disabled={pending}
          />
        </label>

        <label className="fld fld-wide">
          <span>Venue</span>
          <input
            type="text"
            value={draft.venue}
            onChange={(e) => set("venue", e.target.value)}
            maxLength={200}
            required
            disabled={pending}
          />
        </label>

        <label className="fld fld-wide">
          <span>Category</span>
          <select
            value={draft.category}
            onChange={(e) => set("category", e.target.value as EventCategory)}
            disabled={pending}
          >
            {EVENT_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {categoryLabel(option)}
              </option>
            ))}
          </select>
          <span className="fld-hint">Which shelf this sits on in the rack</span>
        </label>

        <label className="fld">
          <span>Doors open</span>
          <input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
            required
            disabled={pending}
          />
          <span className="fld-hint">Cairo time</span>
        </label>

        <label className="fld">
          <span>Ends</span>
          <input
            type="datetime-local"
            value={draft.endsAt}
            onChange={(e) => set("endsAt", e.target.value)}
            min={draft.startsAt || undefined}
            aria-invalid={datesInvalid}
            disabled={pending}
          />
          {datesInvalid ? (
            <span className="fld-bad" role="alert">
              The end time must be after the start time.
            </span>
          ) : (
            <span className="fld-hint">Optional · Cairo time</span>
          )}
        </label>

        <PosterField
          value={draft.posterUrl}
          onChange={(url) => set("posterUrl", url)}
          disabled={pending}
        />

        <label className="fld fld-wide">
          <span>About</span>
          <textarea
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            maxLength={5000}
            placeholder="What should someone know before they buy?"
            disabled={pending}
          />
        </label>
      </div>

      <div className="ed-foot">
        {justSaved && !dirty ? (
          <span className="ed-saved" role="status">
            Saved ✓
          </span>
        ) : null}

        <button
          className="pill pill-turq"
          type="submit"
          disabled={!dirty || pending || datesInvalid}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
