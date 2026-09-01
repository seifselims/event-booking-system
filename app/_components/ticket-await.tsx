"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/lib/trpc/react";

/**
 * The wait between paying and holding a ticket.
 *
 * The buyer lands here from Stripe's redirect, which deliberately issues
 * nothing (spec §7.1: "Never issue tickets on the redirect back from Stripe").
 * The webhook does that, and it usually arrives within a second or two — but
 * "usually" is not "before this page rendered", so without this the buyer sits
 * on a page promising it will update itself and it never does.
 *
 * A **client island inside a Server Component page**: this polls and then calls
 * `router.refresh()`, which re-runs the server render. The QR codes stay
 * server-generated — no ticket secret ever reaches the browser as data, only as
 * an already-rasterised image.
 *
 * `useQuery`, not `useSuspenseQuery`: nothing here is prefetched, and suspending
 * would blank the surrounding page rather than showing the waiting copy.
 */
export function TicketAwait({ orderId }: { orderId: string }) {
  const trpc = useTRPC();
  const router = useRouter();

  const { data } = useQuery({
    ...trpc.checkout.orderStatus.queryOptions({ orderId }),
    // Stops the moment the order settles. A finished order never changes again,
    // and a page left open in a background tab must not poll forever.
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? 1500 : false,
  });

  useEffect(() => {
    // `refresh()` rather than a client-side render of the tickets: the server
    // route holds the token check and the QR generation, so re-running it is
    // what turns this into the real ticket page.
    if (data && data.status !== "pending") {
      router.refresh();
    }
  }, [data, router]);

  return null;
}
