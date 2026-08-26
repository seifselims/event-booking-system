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
 * The organizer's events, newest date first.
 *
 * Reads the listing prefetched by `app/dashboard/page.tsx` via
 * `useSuspenseQuery`, so it renders from the hydrated cache with no loading
 * state (docs/prefetching/). `isAdmin` stays a prop — it comes from the
 * session, not from a query.
 *
 * `ticketsSold / capacity` is a sold-to-capacity ratio, NOT live availability
 * — availability is derived under a row lock at purchase time (spec §5.3) and
 * that layer isn't built. It is honest as a past-tense figure, which is what a
 * dashboard wants; do not reuse it to decide whether a seat can be sold.
 */
export function EventsTable({ isAdmin }: { isAdmin: boolean }) {
  const trpc = useTRPC();
  const { data: events } = useSuspenseQuery(
    trpc.events.getMyEventsWithStats.queryOptions(),
  );

  if (events.length === 0) {
    return (
      <div className="empty">
        <h2>No events yet</h2>
        <p>
          {isAdmin
            ? "No organizer has published an event on the platform."
            : "Your first event will show up here once you create it."}
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{isAdmin ? "Every event" : "Your events"}</h2>
        <span className="panel-count num">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Event</th>
              <th>Date</th>
              <th>Status</th>
              <th className="ta-r">Sold</th>
              <th className="ta-r">Orders</th>
              <th className="ta-r">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const pct =
                event.capacity > 0
                  ? Math.min(
                      100,
                      Math.round((event.ticketsSold / event.capacity) * 100),
                    )
                  : 0;

              return (
                <tr key={event.id}>
                  <td>
                    <Link
                      className="tbl-title"
                      href={`/dashboard/events/${event.id}`}
                    >
                      {event.title}
                    </Link>
                    <span className="tbl-sub">{event.venue}</span>
                  </td>

                  <td className="num tbl-date">
                    {formatEventDate(event.startsAt)}
                  </td>

                  <td>
                    <span className={`tag tag-${event.status}`}>
                      {STATUS_LABEL[event.status]}
                    </span>
                  </td>

                  <td className="ta-r">
                    {event.capacity > 0 ? (
                      <>
                        <span className="num tbl-strong">
                          {event.ticketsSold}
                          <span className="tbl-of">/{event.capacity}</span>
                        </span>
                        <span
                          className="meter"
                          role="img"
                          aria-label={`${pct}% of capacity sold`}
                        >
                          <span className="meter-fill" style={{ width: `${pct}%` }} />
                        </span>
                      </>
                    ) : (
                      <span className="tbl-none">no tiers</span>
                    )}
                  </td>

                  <td className="ta-r num">{event.paidOrders}</td>

                  <td className="ta-r num tbl-strong">
                    {formatEGP(event.grossPiastres)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
