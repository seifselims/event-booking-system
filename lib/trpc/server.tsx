import 'server-only';

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { headers } from 'next/headers';
import { cache } from 'react';

import { createCallerFactory, createTRPCContext } from './init';
import { makeQueryClient } from './query-client';
import { appRouter } from './routers/_app';

/**
 * Build the tRPC context from the incoming request's headers so server
 * callers see the same session the HTTP route would.
 */
const createContext = cache(async () => {
  return createTRPCContext({ headers: await headers() });
});

/** One QueryClient per request — `cache` scopes it to the render pass. */
export const getQueryClient = cache(makeQueryClient);

/**
 * Server-side callable proxy. Calls procedures directly (no HTTP hop).
 * Use it as `trpc.court.list.queryOptions()` inside Server Components.
 */
export const trpc = createTRPCOptionsProxy({
  ctx: createContext,
  router: appRouter,
  queryClient: getQueryClient,
});

/**
 * Direct caller for Server Components that render data themselves rather than
 * handing it to a Client Component.
 *
 * Use this when the result never needs to reach the browser as a query — the
 * dashboard's tiles and tables, for instance. `trpc` + `prefetch` +
 * `HydrateClient` is still the right path when a Client Component will read
 * the same data through `useSuspenseQuery` (docs/prefetching/).
 */
export const caller = cache(async () => createCallerFactory(appRouter)(await createContext()));

/**
 * Prefetch a query into the request's QueryClient. Fire-and-forget —
 * do NOT await it; multiple calls run in parallel.
 */
export function prefetch<T extends { queryKey: readonly unknown[] }>(
  queryOptions: T,
) {
  const queryClient = getQueryClient();
  const [, meta] = queryOptions.queryKey;

  if (
    meta &&
    typeof meta === 'object' &&
    'type' in meta &&
    meta.type === 'infinite'
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void queryClient.prefetchInfiniteQuery(queryOptions as any);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void queryClient.prefetchQuery(queryOptions as any);
  }
}

/**
 * Wrap any subtree whose Client Components read prefetched data.
 * Without this, `useSuspenseQuery` refetches on the client.
 */
export function HydrateClient(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {props.children}
    </HydrationBoundary>
  );
}
