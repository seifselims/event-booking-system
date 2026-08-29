import type { inferRouterOutputs } from '@trpc/server';

import type { AppRouter } from './routers/_app';

/** Every procedure's return type, keyed by router then procedure. */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * One row of the public event listing, with its ticket tiers.
 *
 * Inferred from `listEvents`, not from the Drizzle schema: if that procedure
 * changes shape — drops `with: { ticketTypes: true }`, adds a column — every
 * component that renders an event stops compiling. That is the point.
 */
export type EventListItem = RouterOutputs['events']['listEvents'][number];

/**
 * One row of the public organizer index, with its visible-event count.
 *
 * Inferred from `listOrganizers` for the same reason as `EventListItem` above:
 * that procedure selects three deliberately narrow columns (`user` also holds
 * `email` and `role`), and widening it should force every card that renders an
 * organizer to be re-checked.
 */
export type OrganizerListItem =
  RouterOutputs['events']['listOrganizers'][number];

/**
 * One public event page, with its organizer and its tiers.
 *
 * Inferred from `getEventBySlug` rather than from `EventListItem`: that
 * procedure merges live `available` counts into each tier (spec §5.3), which
 * the listing does not carry. Anything rendering the selector should type
 * against this so dropping that merge breaks the build.
 */
export type EventPageItem = RouterOutputs['events']['getEventBySlug'];

/** One purchasable tier on the event page, carrying its derived availability. */
export type EventPageTier = EventPageItem['ticketTypes'][number];
