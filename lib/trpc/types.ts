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
