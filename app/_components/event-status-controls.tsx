"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

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
    "Cancelled and hidden from the public site. Tickets already sold stay valid — cancelling an event does not refund them.",
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
  const router = useRouter();
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

  const remove = useMutation(
    trpc.events.deleteEvent.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.events.getMyEventsWithStats.queryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.events.getMyTotals.queryKey(),
        });
        // The admin listing is a different query over the same rows.
        void queryClient.invalidateQueries({
          queryKey: trpc.admin.listAllEvents.queryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.admin.platformTotals.queryKey(),
        });

        // The event this page reads no longer exists, so going back to it would
        // suspend on a NOT_FOUND.
        router.replace("/dashboard");
      },
    }),
  );

  const pending = setStatus.isPending || remove.isPending;

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

      {remove.error ? (
        <p className="gate-error" role="alert" style={{ margin: "18px 22px 0" }}>
          {/* PRECONDITION_FAILED names the number of paid orders, which is the
              whole reason the delete was refused — say it rather than hide it. */}
          {remove.error.data?.code === "PRECONDITION_FAILED"
            ? remove.error.message
            : "Couldn't delete this event. Try again in a moment."}
        </p>
      ) : null}

      <div className="status-body">
        <p className="status-note">
          {/* `isPast` is derived per read, not swept into `status` — a finished
              event is described as over wherever it is shown, but archiving it
              stays the organizer's call. See `IS_PAST` in routers/events.ts. */}
          {event.isPast && live
            ? "This event has already happened. It no longer appears on the public site — archive it to file it away."
            : NOTE[event.status]}
          {event.status === "draft" && !hasTiers ? (
            <> Add a ticket tier before publishing, or there is nothing to sell.</>
          ) : null}
        </p>

        <div className="status-acts">
          {/* A finished event can be archived directly, without cancelling it
              first — cancelling implies calling off something still to come. */}
          {event.isPast && event.status !== "archived" ? (
            <button
              className="pill pill-sm btn-console"
              type="button"
              onClick={() => move("archived")}
              disabled={pending}
            >
              Archive
            </button>
          ) : null}

          {event.status === "draft" ? (
            <button
              className="pill pill-sm pill-turq"
              type="button"
              onClick={() => move("active")}
              // Publishing a date that has already passed would put it on a
              // public site that filters it straight back out.
              disabled={pending || !hasTiers || event.isPast}
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

          {event.status !== "archived" && !live && !event.isPast ? (
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

        {/* Separated from the lifecycle buttons above: those are reversible,
            this is not. Refused server-side once the event holds paid orders. */}
        <div className="status-danger">
          <div>
            <strong>Delete this event</strong>
            <p>
              Removes the event and its ticket tiers for good. An event with paid
              orders can&apos;t be deleted — cancel or archive it instead.
            </p>
          </div>

          <button
            className="pill pill-sm btn-danger"
            type="button"
            onClick={() => {
              if (
                !confirm(
                  `Delete "${event.title}" permanently? This cannot be undone.`,
                )
              ) {
                return;
              }
              remove.mutate({ id: event.id });
            }}
            disabled={pending}
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
