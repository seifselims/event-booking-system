"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fromCairoInputValue, toCairoInputValue } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";
import type { RouterOutputs } from "@/lib/trpc/types";

import { PosterField } from "./poster-field";

type Event = RouterOutputs["events"]["getMyEvent"];

/** The editable half of an event, as strings — what the inputs actually hold. */
type Draft = {
  title: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  posterUrl: string;
  description: string;
};

function toDraft(event: Event): Draft {
  return {
    title: event.title,
    venue: event.venue,
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

  const dirty = (Object.keys(draft) as (keyof Draft)[]).some(
    (key) => draft[key].trim() !== saved[key].trim(),
  );

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

  function set<K extends keyof Draft>(key: K, value: string) {
    setJustSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function onSubmit(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!dirty || update.isPending) return;

    const startsAt = fromCairoInputValue(draft.startsAt);
    if (!startsAt) return;

    const endsAt = fromCairoInputValue(draft.endsAt);

    update.mutate({
      id: event.id,
      title: draft.title.trim(),
      venue: draft.venue.trim(),
      startsAt,
      // `.partial()` means omitted keys are left alone; a cleared optional field
      // has to be sent as undefined rather than dropped silently.
      ...(endsAt ? { endsAt } : {}),
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
            disabled={pending}
          />
          <span className="fld-hint">Optional · Cairo time</span>
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
          disabled={!dirty || pending}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
