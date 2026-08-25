/**
 * Placeholder event data for the public landing page.
 *
 * WHY THIS EXISTS: the `events` and `ticket_types` tables have never been
 * migrated — `drizzle/0000` and `0001` create the Better Auth tables only — so
 * `events.listEvents` has nothing to read. Generating and applying that
 * migration is the user's call (AGENTS.md), so the landing page renders this
 * instead.
 *
 * SWAPPING TO REAL DATA is a three-line change, and no component moves:
 *
 *   // app/page.tsx
 *   - const events = MOCK_EVENTS;
 *   + prefetch(trpc.events.listEvents.queryOptions());
 *   + return <HydrateClient><Rack … /></HydrateClient>   // per docs/prefetching
 *
 * `Rack` and `RackCard` take their data as props, so they are unaffected —
 * only the component that *fetches* becomes a client component calling
 * `useSuspenseQuery`.
 *
 * The type is inferred from the router, not from the Drizzle schema, so if
 * `listEvents` ever changes shape (drops `with: { ticketTypes: true }`, adds a
 * column) this file stops compiling. That is the point.
 */
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/lib/trpc/routers/_app";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/** One row of the public event listing, with its ticket tiers. */
export type EventListItem = RouterOutputs["events"]["listEvents"][number];

const ORGANIZER_ID = "mock-organizer-omar";

/** Timestamps only matter relative to each other here. */
const CREATED = new Date("2026-08-01T09:00:00.000Z");

export const MOCK_EVENTS: EventListItem[] = [
  {
    id: "evt-nile-delta-nights",
    organizerId: ORGANIZER_ID,
    slug: "nile-delta-nights",
    title: "Nile Delta Nights",
    description:
      "Six hours across two stages on the edge of the desert. An orchestral takeover of the main room at sundown, then the basement opens until dawn.",
    venue: "Al Manara · New Cairo",
    posterUrl: null,
    startsAt: new Date("2026-09-12T17:00:00.000Z"), // 20:00 Cairo
    endsAt: new Date("2026-09-13T01:00:00.000Z"),
    status: "active",
    createdAt: CREATED,
    updatedAt: CREATED,
    ticketTypes: [
      {
        id: "tt-ndn-ga",
        eventId: "evt-nile-delta-nights",
        name: "General Admission",
        pricePiastres: 45_000, // EGP 450.00
        quantity: 400,
        maxPerOrder: 6,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
      {
        id: "tt-ndn-pit",
        eventId: "evt-nile-delta-nights",
        name: "Front Pit",
        pricePiastres: 95_000, // EGP 950.00
        quantity: 200,
        maxPerOrder: 4,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
      {
        id: "tt-ndn-table",
        eventId: "evt-nile-delta-nights",
        name: "Table for Four",
        pricePiastres: 480_000, // EGP 4,800.00
        quantity: 30,
        maxPerOrder: 1,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
    ],
  },
  {
    id: "evt-cairo-design-summit",
    organizerId: ORGANIZER_ID,
    slug: "cairo-design-summit",
    title: "Cairo Design Summit",
    description:
      "Two days of talks and workshops on product design, typography, and the craft of shipping.",
    venue: "Greek Campus · Downtown",
    posterUrl: null,
    startsAt: new Date("2026-09-17T06:30:00.000Z"), // 09:30 Cairo
    endsAt: new Date("2026-09-18T15:00:00.000Z"),
    status: "active",
    createdAt: CREATED,
    updatedAt: CREATED,
    ticketTypes: [
      {
        id: "tt-cds-standard",
        eventId: "evt-cairo-design-summit",
        name: "Standard",
        pricePiastres: 120_000, // EGP 1,200.00
        quantity: 300,
        maxPerOrder: 5,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
      {
        id: "tt-cds-student",
        eventId: "evt-cairo-design-summit",
        name: "Student",
        pricePiastres: 60_000, // EGP 600.00
        quantity: 120,
        maxPerOrder: 2,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
    ],
  },
  {
    id: "evt-tarab-reimagined",
    organizerId: ORGANIZER_ID,
    slug: "tarab-reimagined",
    title: "Tarab Reimagined",
    description:
      "A forty-piece orchestra rereads the standards, with arrangements written for this room.",
    venue: "Cairo Opera House",
    posterUrl: null,
    startsAt: new Date("2026-09-18T18:00:00.000Z"), // 21:00 Cairo
    endsAt: null,
    status: "sold_out",
    createdAt: CREATED,
    updatedAt: CREATED,
    ticketTypes: [
      {
        id: "tt-tr-stalls",
        eventId: "evt-tarab-reimagined",
        name: "Stalls",
        pricePiastres: 80_000, // EGP 800.00
        quantity: 420,
        maxPerOrder: 4,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
      {
        id: "tt-tr-balcony",
        eventId: "evt-tarab-reimagined",
        name: "Balcony",
        pricePiastres: 55_000, // EGP 550.00
        quantity: 180,
        maxPerOrder: 4,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
    ],
  },
  {
    id: "evt-standup-at-the-vault",
    organizerId: ORGANIZER_ID,
    slug: "standup-at-the-vault",
    title: "Standup at the Vault",
    description: "Five comics, one basement, no phones. Strictly 18+.",
    venue: "The Vault · Zamalek",
    posterUrl: null,
    startsAt: new Date("2026-09-19T19:00:00.000Z"), // 22:00 Cairo
    endsAt: null,
    status: "active",
    createdAt: CREATED,
    updatedAt: CREATED,
    ticketTypes: [
      {
        id: "tt-sv-door",
        eventId: "evt-standup-at-the-vault",
        name: "Door",
        pricePiastres: 30_000, // EGP 300.00
        quantity: 90,
        maxPerOrder: 4,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
    ],
  },
  {
    id: "evt-sahel-closing-set",
    organizerId: ORGANIZER_ID,
    slug: "sahel-closing-set",
    title: "Sahel Closing Set",
    description:
      "The last night of the season on the North Coast. Doors at eleven, sunrise finish.",
    venue: "Marassi Beach · North Coast",
    posterUrl: null,
    startsAt: new Date("2026-09-26T20:00:00.000Z"), // 23:00 Cairo
    endsAt: new Date("2026-09-27T03:00:00.000Z"),
    status: "active",
    createdAt: CREATED,
    updatedAt: CREATED,
    ticketTypes: [
      {
        id: "tt-scs-ga",
        eventId: "evt-sahel-closing-set",
        name: "General Admission",
        pricePiastres: 175_000, // EGP 1,750.00
        quantity: 1200,
        maxPerOrder: 6,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
      {
        id: "tt-scs-cabana",
        eventId: "evt-sahel-closing-set",
        name: "Cabana",
        pricePiastres: 900_000, // EGP 9,000.00
        quantity: 40,
        maxPerOrder: 1,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
    ],
  },
  {
    id: "evt-kickoff-derby",
    organizerId: ORGANIZER_ID,
    slug: "kickoff-derby",
    title: "Kickoff Derby",
    description: "The season opener. Gates open two hours before kickoff.",
    venue: "Cairo International Stadium",
    posterUrl: null,
    startsAt: new Date("2026-09-27T16:00:00.000Z"), // 19:00 Cairo
    endsAt: null,
    status: "active",
    createdAt: CREATED,
    updatedAt: CREATED,
    ticketTypes: [
      {
        id: "tt-kd-terrace",
        eventId: "evt-kickoff-derby",
        name: "Terrace",
        pricePiastres: 25_000, // EGP 250.00
        quantity: 3200,
        maxPerOrder: 6,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
      {
        id: "tt-kd-stand",
        eventId: "evt-kickoff-derby",
        name: "Main Stand",
        pricePiastres: 70_000, // EGP 700.00
        quantity: 800,
        maxPerOrder: 4,
        salesStartAt: null,
        salesEndAt: null,
        createdAt: CREATED,
      },
    ],
  },
];
