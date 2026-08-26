"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import Link from "next/link";

import { EventDetailsForm } from "./event-details-form";
import { EventStatusControls } from "./event-status-controls";
import { TicketTiers } from "./ticket-tiers";

import { formatEventDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";

/**
 * The organizer's view of one event (spec §8): details, tiers, and status.
 *
 * Reads the query prefetched by the page via `useSuspenseQuery`, so it renders
 * from the hydrated cache with no loading state (docs/prefetching/). The `{ id }`
 * input must match the page's `queryOptions({ id })` exactly or the cache misses.
 *
 * `getMyEvent` is the permission, not the page guard: it resolves through
 * `ownsEvent`, so another organizer's id throws NOT_FOUND, while an admin sees
 * it through the same procedure.
 */
export function EventEditor({ id }: { id: string }) {
  const trpc = useTRPC();
  const { data: event } = useSuspenseQuery(
    trpc.events.getMyEvent.queryOptions({ id }),
  );

  return (
    <>
      <div className="console-head">
        <div>
          <Link className="ed-back" href="/dashboard">
            ← All events
          </Link>

          <p className="gate-eyebrow">
            {event.venue} · {formatEventDate(event.startsAt)}
          </p>

          <div className="ed-title-row">
            <h1 className="console-title">{event.title}</h1>
            <span className={`tag tag-${event.status}`}>
              {event.status.replace("_", " ")}
            </span>
          </div>
        </div>
      </div>

      <div className="ed-stack">
        <div className="panel">
          <div className="panel-head">
            <h2>Details</h2>
          </div>
          <EventDetailsForm event={event} />
        </div>

        <TicketTiers event={event} />

        <EventStatusControls event={event} />
      </div>
    </>
  );
}
