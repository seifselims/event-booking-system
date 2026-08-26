"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import Link from "next/link";

import { formatEGP, formatEventDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";

type EventStatus = "draft" | "active" | "cancelled" | "archived" | "sold_out";

const STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Draft",
  active: "Live",
  sold_out: "Sold out",
  cancelled: "Cancelled",
  archived: "Archived",
};

/**
 * Every event on the platform, newest first.
 *
 * Reads the listing prefetched by `app/admin/(console)/page.tsx` via
 * `useSuspenseQuery`, so it renders from the hydrated cache with no loading
 * state (docs/prefetching/).
 *
 * Carries no sold/capacity meter: `listAllEvents` aggregates orders, not ticket
 * types, so there is no capacity to divide by. The organizer takes that column
 * instead — on a cross-organizer view it is the one that earns its width. Per-
 * event capacity lives in the editor each title links to.
 */
export function AllEventsTable() {
  const trpc = useTRPC();
  const { data: events } = useSuspenseQuery(
    trpc.admin.listAllEvents.queryOptions(),
  );

  if (events.length === 0) {
    return (
      <div className="empty">
        <h2>No events yet</h2>
        <p>No organizer has created an event on the platform.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Every event</h2>
        <span className="panel-count num">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Event</th>
              <th>Organizer</th>
              <th>Date</th>
              <th>Status</th>
              <th className="ta-r">Orders</th>
              <th className="ta-r">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>
                  {/* The organizer editor, not a parallel admin one: the same
                      procedure widens for admins (spec §2). */}
                  <Link
                    className="tbl-title"
                    href={`/dashboard/events/${event.id}`}
                  >
                    {event.title}
                  </Link>
                </td>

                <td>
                  <span className="tbl-title">{event.organizerName}</span>
                  <span className="tbl-sub">{event.organizerEmail}</span>
                </td>

                <td className="num tbl-date">
                  {formatEventDate(event.startsAt)}
                </td>

                <td>
                  <span className={`tag tag-${event.status}`}>
                    {STATUS_LABEL[event.status]}
                  </span>
                </td>

                <td className="ta-r num">{event.paidOrders}</td>

                <td className="ta-r num tbl-strong">
                  {formatEGP(event.grossPiastres)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
