"use client";

import Link from "next/link";
import { useSuspenseQuery } from "@tanstack/react-query";

import { categoryLabel } from "@/lib/categories";
import { formatEventDate } from "@/lib/format";
import { eventArtVariant } from "@/lib/palette";
import { useTRPC } from "@/lib/trpc/react";

import { EventArt } from "./event-art";
import { TicketSelector } from "./ticket-selector";

/** `"21:00"` in Cairo — the door time, beside the date. */
function formatEventTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Cairo",
  }).format(date);
}

/**
 * The public event page's data half (spec §8, `/e/[slug]`).
 *
 * The input must match the page's `prefetch` exactly — `{ slug }` on both sides
 * — or the key misses and this refetches on the client (docs/prefetching/).
 *
 * Layout is the sleeve grammar turned to a two-column release: the art panel on
 * the left, the billing and the ticket listing on the right. Unlike a rack card
 * it does not carry `.rk`, so it is outside the cross-fade's `nth-child`
 * contract — the same reasoning that keeps `.og` separate.
 */
export function EventSection({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const { data: event } = useSuspenseQuery(
    trpc.events.getEventBySlug.queryOptions({ slug }),
  );

  const soldOut = event.status === "sold_out";

  return (
    <div className="shell ev">
      <div className="ev-art">
        {event.posterUrl ? (
          /* posterUrl is a free-form URL column, so next/image would need
             images.remotePatterns configured first. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.posterUrl} alt="" />
        ) : (
          /* Same key as the card's art, so a poster-less event shows the same
             picture on both rather than two unrelated ones. */
          <EventArt variant={eventArtVariant(event.slug)} title={event.title} />
        )}
      </div>

      <div className="ev-body">
        <div className="ev-meta">
          <span className="ev-cat">{categoryLabel(event.category)}</span>
          {soldOut && <span className="ev-soldout">Sold out</span>}
        </div>

        <h1 className="ev-title">{event.title}</h1>

        <div className="ev-facts">
          <div className="ev-fact">
            <span>When</span>
            <b>
              <time dateTime={event.startsAt.toISOString()}>
                {formatEventDate(event.startsAt)} &middot;{" "}
                {formatEventTime(event.startsAt)}
              </time>
            </b>
          </div>

          <div className="ev-fact">
            <span>Where</span>
            <b>{event.venue}</b>
          </div>

          <div className="ev-fact">
            <span>Who</span>
            <b>
              <Link className="ev-org" href={`/organizers/${event.organizer.id}`}>
                {event.organizer.name}
              </Link>
            </b>
          </div>
        </div>

        {event.description && (
          <p className="ev-desc">{event.description}</p>
        )}

        <TicketSelector tiers={event.ticketTypes} />
      </div>
    </div>
  );
}
