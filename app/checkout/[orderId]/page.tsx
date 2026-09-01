import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CheckoutCountdown } from "../../_components/checkout-countdown";

import { caller, HydrateClient, prefetch, trpc } from "@/lib/trpc/server";

/**
 * The countdown between choosing tickets and paying (spec §8, §7.1 step 4).
 *
 * DESIGN.md gives checkout the brown ground — the one screen that is neither
 * the public field nor the console, because it is a held breath: a clock
 * running against seats that are not yet the buyer's.
 *
 * `force-dynamic`: everything here is per-request. `holdExpiresAt` is a live
 * countdown and the order's status changes underneath the page.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout — Gate",
  // A pending order is nobody's business but the buyer's, and the URL carries
  // an order id. Keep it out of search results entirely.
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({
  params,
  searchParams,
}: PageProps<"/checkout/[orderId]">) {
  const { orderId } = await params;

  // Stripe's `cancel_url` lands here with `?back=1`. It is a *display* flag and
  // nothing else — arriving from Stripe is not evidence the buyer failed to
  // pay (they may have paid and pressed Back), so this page never mutates on
  // load. Releasing the hold takes a deliberate click; see `releaseHold`.
  const cameBack = (await searchParams).back === "1";

  // Prefetch first, fire-and-forget, so it overlaps the existence check rather
  // than queueing behind it — the ordering `app/e/[slug]/page.tsx` establishes.
  prefetch(trpc.checkout.orderStatus.queryOptions({ orderId }));

  try {
    await (await caller()).checkout.orderStatus({ orderId });
  } catch {
    notFound();
  }

  return (
    <section
      className="side side-full"
      style={
        {
          "--ground": "var(--color-brown)",
          "--ink": "var(--color-beige)",
        } as React.CSSProperties
      }
    >
      <div className="side-mark" aria-hidden="true">
        <b>Side E</b> &middot; Checkout
      </div>

      <HydrateClient>
        <CheckoutCountdown orderId={orderId} cameBack={cameBack} />
      </HydrateClient>
    </section>
  );
}
