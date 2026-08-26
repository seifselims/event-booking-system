"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/lib/trpc/react";
import type { RouterOutputs } from "@/lib/trpc/types";

type Event = RouterOutputs["events"]["getMyEvent"];
type Status = Event["status"];

/** What each status means to the organizer looking at it. */
const NOTE: Record<Status, string> = {
  draft:
    "This event is only visible to you. Publishing puts it on the public site and opens sales.",
  active: "Live on the public site and selling.",
  sold_out:
    "Live, but every tier is exhausted. Add capacity to a tier to put it back on sale.",
  cancelled:
    "Cancelled and hidden from the public site. Existing orders are unaffected — refunds are handled per order.",
  archived: "Archived and hidden from the public site.",
};

/**
 * Move an event through its lifecycle.
 *
 * Only transitions an organizer actually decides are offered. `sold_out` is
 * deliberately absent: it is derived from availability by `syncSoldOut`
 * (`lib/trpc/routers/tickets.ts`), not a state anyone picks by hand.
 */
export function EventStatusControls({ event }: { event: Event }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const setStatus = useMutation(
    trpc.events.setEventStatus.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.events.getMyEvent.queryKey({ id: event.id }),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.events.getMyEventsWithStats.queryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.events.getMyTotals.queryKey(),
        });
      },
    }),
  );

  const pending = setStatus.isPending;

  function move(status: Status, confirmWith?: string) {
    if (confirmWith && !confirm(confirmWith)) return;
    setStatus.mutate({ id: event.id, status });
  }

  const live = event.status === "active" || event.status === "sold_out";
  const hasTiers = event.ticketTypes.length > 0;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Status</h2>
        <span className={`tag tag-${event.status}`}>
          {event.status.replace("_", " ")}
        </span>
      </div>

      {setStatus.error ? (
        <p className="gate-error" role="alert" style={{ margin: "18px 22px 0" }}>
          Couldn&apos;t change the status. Try again in a moment.
        </p>
      ) : null}

      <div className="status-body">
        <p className="status-note">
          {NOTE[event.status]}
          {event.status === "draft" && !hasTiers ? (
            <> Add a ticket tier before publishing, or there is nothing to sell.</>
          ) : null}
        </p>

        <div className="status-acts">
          {event.status === "draft" ? (
            <button
              className="pill pill-sm pill-turq"
              type="button"
              onClick={() => move("active")}
              disabled={pending || !hasTiers}
            >
              {pending ? "Working…" : "Publish"}
            </button>
          ) : null}

          {(event.status === "cancelled" || event.status === "archived") ? (
            <button
              className="pill pill-sm btn-console"
              type="button"
              onClick={() => move("draft")}
              disabled={pending}
            >
              Back to draft
            </button>
          ) : null}

          {live ? (
            <button
              className="pill pill-sm btn-danger"
              type="button"
              onClick={() =>
                move(
                  "cancelled",
                  "Cancel this event? It comes off the public site immediately.",
                )
              }
              disabled={pending}
            >
              Cancel event
            </button>
          ) : null}

          {event.status !== "archived" && !live ? (
            <button
              className="pill pill-sm btn-console"
              type="button"
              onClick={() =>
                move("archived", "Archive this event and hide it from view?")
              }
              disabled={pending}
            >
              Archive
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
