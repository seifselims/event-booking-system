"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PosterField } from "./poster-field";

import { fromCairoInputValue } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";

/** A tier being drafted, as strings — what the inputs actually hold. */
type TierDraft = {
  key: string;
  name: string;
  price: string;
  quantity: string;
};

function blankTier(): TierDraft {
  return { key: crypto.randomUUID(), name: "", price: "", quantity: "" };
}

/** Mirrors the message `createEvent` throws, so both paths read the same. */
const ENDS_BEFORE_STARTS = "The end time must be after the start time.";

/**
 * Create an event, with its first ticket tiers.
 *
 * Both halves go in one `createEvent` call, which writes them in a single
 * transaction — `ticket_types.event_id` is a foreign key, so a tier cannot
 * precede its event, and a half-written event with no tiers is worse than none.
 *
 * The event is created as `draft` (the column default), so this never publishes
 * anything. On success the organizer lands in the editor, where publishing and
 * the full tier options live.
 *
 * Prices are entered in EGP and converted to integer piastres here — money is
 * never a float in this codebase (`250.00 EGP` is `25000`).
 */
export function EventCreateForm() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [description, setDescription] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([blankTier()]);
  const [invalid, setInvalid] = useState<string | null>(null);

  // Live, so the field is marked the moment the pair stops making sense rather
  // than on submit. The server refuses the same thing independently.
  const datesInvalid = (() => {
    const starts = fromCairoInputValue(startsAt);
    const ends = fromCairoInputValue(endsAt);
    return Boolean(starts && ends && ends <= starts);
  })();

  const create = useMutation(
    trpc.events.createEvent.mutationOptions({
      onSuccess: () => {
        // The dashboard listing and its tiles are both stale now.
        void queryClient.invalidateQueries({
          queryKey: trpc.events.getMyEventsWithStats.queryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.events.getMyTotals.queryKey(),
        });

        router.push("/dashboard");
      },
    }),
  );

  function setTier(key: string, patch: Partial<TierDraft>) {
    setInvalid(null);
    setTiers((current) =>
      current.map((tier) => (tier.key === key ? { ...tier, ...patch } : tier)),
    );
  }

  function onSubmit(
    submitEvent: React.FormEvent<HTMLFormElement>,
    status: "draft" | "active",
  ) {
    submitEvent.preventDefault();
    if (create.isPending) return;

    const starts = fromCairoInputValue(startsAt);
    if (!starts) {
      setInvalid("Give the event a start date and time.");
      return;
    }

    if (datesInvalid) {
      setInvalid(ENDS_BEFORE_STARTS);
      return;
    }

    const ends = fromCairoInputValue(endsAt);

    // A tier counts as filled in once it has a name; a wholly blank row is the
    // organizer declining to price the event yet, which `draft` allows.
    const filled = tiers.filter((tier) => tier.name.trim());

    // The same two rules `createEvent` enforces — checked here for an immediate
    // message rather than a round-trip.
    if (status === "active") {
      if (!filled.length) {
        setInvalid("Add a ticket tier before publishing, or there is nothing to sell.");
        return;
      }

      if ((ends ?? starts) <= new Date()) {
        setInvalid("That date has already passed, so it can't be published.");
        return;
      }
    }

    for (const tier of filled) {
      const quantity = Number(tier.quantity);
      const price = Number(tier.price);

      if (!Number.isInteger(quantity) || quantity < 1) {
        setInvalid(`"${tier.name.trim()}" needs a quantity of at least 1.`);
        return;
      }

      if (!Number.isFinite(price) || price < 0) {
        setInvalid(`"${tier.name.trim()}" needs a price of 0 or more.`);
        return;
      }
    }

    setInvalid(null);

    create.mutate({
      status,
      title: title.trim(),
      venue: venue.trim(),
      startsAt: starts,
      ...(ends ? { endsAt: ends } : {}),
      ...(posterUrl.trim() ? { posterUrl: posterUrl.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(filled.length
        ? {
            tiers: filled.map((tier) => ({
              name: tier.name.trim(),
              // EGP -> piastres. Rounded because a price like 12.345 would
              // otherwise carry a fraction of a piastre into an integer column.
              pricePiastres: Math.round(Number(tier.price) * 100),
              quantity: Number(tier.quantity),
            })),
          }
        : {}),
    });
  }

  const pending = create.isPending;

  // Both buttons share this: the difference between them is the status, not
  // what the form needs filled in. Publishing's extra rules (tiers, a future
  // date) are reported on submit, so the reason is stated rather than left as
  // a dead button.
  const incomplete =
    pending || !title.trim() || !venue.trim() || !startsAt || datesInvalid;

  return (
    <form
      className="ed-stack"
      // `submitter` is the button that was actually pressed, so the status comes
      // straight from the click rather than from state that would lag it.
      // Enter in a text field has no submitter, which falls through to draft —
      // the conservative default.
      onSubmit={(e) =>
        onSubmit(
          e,
          (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
            "active"
            ? "active"
            : "draft",
        )
      }
      noValidate
    >
      <div className="panel">
        <div className="panel-head">
          <h2>Details</h2>
        </div>

        <div className="ed-body">
          {create.error ? (
            <p className="gate-error" role="alert">
              {create.error.data?.code === "BAD_REQUEST"
                ? create.error.message
                : "Couldn't create the event. Try again in a moment."}
            </p>
          ) : null}

          <div className="ed-grid">
            <label className="fld fld-wide">
              <span>Title</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                autoFocus
                disabled={pending}
              />
            </label>

            <label className="fld fld-wide">
              <span>Venue</span>
              <input
                type="text"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                maxLength={200}
                required
                disabled={pending}
              />
            </label>

            <label className="fld">
              <span>Doors open</span>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => {
                  setInvalid(null);
                  setStartsAt(e.target.value);
                }}
                required
                disabled={pending}
              />
              <span className="fld-hint">Cairo time</span>
            </label>

            <label className="fld">
              <span>Ends</span>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => {
                  setInvalid(null);
                  setEndsAt(e.target.value);
                }}
                // The start field is the minimum the browser will offer, which
                // heads most of these off before the message is ever needed.
                min={startsAt || undefined}
                aria-invalid={datesInvalid}
                disabled={pending}
              />
              {datesInvalid ? (
                <span className="fld-bad" role="alert">
                  {ENDS_BEFORE_STARTS}
                </span>
              ) : (
                <span className="fld-hint">Optional · Cairo time</span>
              )}
            </label>

            <PosterField
              value={posterUrl}
              onChange={setPosterUrl}
              disabled={pending}
            />

            <label className="fld fld-wide">
              <span>About</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                placeholder="What should someone know before they buy?"
                disabled={pending}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Ticket tiers</h2>
          <span className="panel-count num">optional</span>
        </div>

        <div className="ed-body">
          <p className="status-note" style={{ marginBottom: 18 }}>
            Add what people can buy. You can leave this empty and price the event
            later — it stays a draft until you publish it, and sales windows and
            per-order limits live in the editor.
          </p>

          {tiers.map((tier) => (
            <div className="tier-new" key={tier.key}>
              <label className="fld">
                <span>Name</span>
                <input
                  type="text"
                  value={tier.name}
                  onChange={(e) => setTier(tier.key, { name: e.target.value })}
                  placeholder="General admission"
                  maxLength={100}
                  disabled={pending}
                />
              </label>

              <label className="fld">
                <span>Price (EGP)</span>
                <input
                  type="number"
                  value={tier.price}
                  onChange={(e) => setTier(tier.key, { price: e.target.value })}
                  min={0}
                  step="0.01"
                  placeholder="250"
                  disabled={pending}
                />
              </label>

              <label className="fld">
                <span>Quantity</span>
                <input
                  type="number"
                  value={tier.quantity}
                  onChange={(e) =>
                    setTier(tier.key, { quantity: e.target.value })
                  }
                  min={1}
                  step={1}
                  placeholder="100"
                  disabled={pending}
                />
              </label>

              {tiers.length > 1 ? (
                <button
                  type="button"
                  className="pill pill-sm btn-danger tier-new-drop"
                  onClick={() =>
                    setTiers((current) =>
                      current.filter((t) => t.key !== tier.key),
                    )
                  }
                  disabled={pending}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}

          {tiers.length < 10 ? (
            <button
              type="button"
              className="pill pill-sm btn-console"
              onClick={() => setTiers((current) => [...current, blankTier()])}
              disabled={pending}
            >
              Add another tier
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="ed-body">
          {invalid ? (
            <p className="gate-error" role="alert">
              {invalid}
            </p>
          ) : null}

          <div className="ed-foot" style={{ marginTop: 0, borderTop: "none" }}>
            <span className="status-note" style={{ marginRight: "auto" }}>
              A draft stays private to you. Publishing puts it on the public site
              and opens sales — you can do it later from the editor.
            </span>

            <button
              className="pill btn-console"
              type="submit"
              value="draft"
              disabled={incomplete}
            >
              {pending ? "Working…" : "Save as draft"}
            </button>

            <button
              className="pill pill-turq"
              type="submit"
              value="active"
              disabled={incomplete}
            >
              {pending ? "Working…" : "Publish now"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
