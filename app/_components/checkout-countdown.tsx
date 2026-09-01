"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";

import { formatEGP } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";

/**
 * Where the buyer's token lives between pages.
 *
 * The token is not in this page's URL — putting it there would leak it into
 * browser history, the Referer header on the way to Stripe, and any analytics
 * that logs paths. `sessionStorage` keeps it to this tab for this visit.
 *
 * If it is missing (a shared link, a new tab, a reopened browser) the page
 * still renders and still polls — `orderStatus` needs no token. Only the two
 * *mutations* need it, so those controls hide rather than the page breaking.
 */
function tokenKey(orderId: string) {
  return `gate.order-token.${orderId}`;
}

export function readOrderToken(orderId: string) {
  try {
    return window.sessionStorage.getItem(tokenKey(orderId));
  } catch {
    // Private mode, blocked storage — treated as "no token", not an error.
    return null;
  }
}

export function writeOrderToken(orderId: string, token: string) {
  try {
    window.sessionStorage.setItem(tokenKey(orderId), token);
  } catch {
    // Non-fatal: the buyer loses the in-tab controls, not their tickets.
  }
}

/** `"6:07"` — minutes and seconds left on the hold. */
function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function CheckoutCountdown({
  orderId,
  cameBack,
}: {
  orderId: string;
  cameBack: boolean;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The token is read inside the click handlers, not into state.
  //
  // `sessionStorage` does not exist during SSR, so reading it at render time
  // would make the server and client trees disagree; reading it in an effect
  // would mean a second render just to reveal a button. Both controls that need
  // it are click-driven, and by the time a click happens the browser is
  // unquestionably there — so the read belongs at the moment of use.
  function requireToken() {
    const token = readOrderToken(orderId);

    if (!token) {
      setError(
        "This checkout was started in another tab. Open it there to finish paying.",
      );
      return null;
    }

    return token;
  }

  const { data: order } = useSuspenseQuery({
    ...trpc.checkout.orderStatus.queryOptions({ orderId }),
    // The poll that makes spec §7.1 step 7 work: the redirect back from Stripe
    // issues nothing, so this page watches for the *webhook* to land. Stops the
    // moment the order reaches a terminal state — a finished order never
    // changes again, and polling it forever is pure waste.
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? 2000 : false,
  });

  const holdMs = order.holdExpiresAt.getTime() - now;
  const expired = holdMs <= 0;

  // One interval for the whole component. Runs only while the hold is live, so
  // a finished page is not ticking in a background tab.
  useEffect(() => {
    if (order.status !== "pending") return;

    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [order.status]);

  // Paid — the webhook landed. Send them to their tickets.
  useEffect(() => {
    if (order.status === "paid" && order.ticketUrl) {
      router.replace(order.ticketUrl);
    }
  }, [order.status, order.ticketUrl, router]);

  const checkout = useMutation(
    trpc.checkout.createCheckoutSession.mutationOptions({
      onSuccess: (result) => {
        // A full navigation, not `router.push` — Stripe is another origin, so
        // the App Router cannot handle it. `assign` rather than setting `href`,
        // which lint reads as mutating a value it considers read-only.
        window.location.assign(result.url);
      },
      onError: (mutationError) => setError(mutationError.message),
    }),
  );

  const release = useMutation(
    trpc.checkout.releaseHold.mutationOptions({
      onSuccess: (result) => {
        // `released: false` with a settled status is the paid-then-Back race:
        // they did pay, so this is good news, not a failure. Let the poll pick
        // up the redirect rather than showing an error.
        if (!result.released && result.status === "paid") return;

        router.replace("/");
      },
      onError: (mutationError) => setError(mutationError.message),
    }),
  );

  const busy = checkout.isPending || release.isPending;

  const heading = useMemo(() => {
    if (order.status === "paid") return "Paid — fetching your tickets";
    if (order.status === "expired") return "This hold has ended";
    if (order.status === "refunded") return "This order was refunded";
    if (expired) return "Your hold expired";
    if (cameBack) return "You came back without paying";
    return "Your seats are held";
  }, [order.status, expired, cameBack]);

  const settled = order.status !== "pending";

  return (
    <div className="shell cx">
      <div className="cx-panel">
        <div className="cx-head">
          <span>Checkout</span>
          <span className="num">{formatEGP(order.totalPiastres)}</span>
        </div>

        <h1 className="cx-title">{heading}</h1>

        {/* The clock. Only meaningful while something is actually being held. */}
        {!settled && !expired && (
          <div className="cx-clock">
            <b className="num">{formatRemaining(holdMs)}</b>
            <span>left to pay</span>
          </div>
        )}

        {/* A declined card. The order is still live and still payable — this is
            the one payment failure that is not the end of the road. */}
        {!settled && order.lastPaymentError && (
          <p className="cx-note cx-note-warn">
            {order.lastPaymentError} Your seats are still held — try again.
          </p>
        )}

        {!settled && !expired && (
          <p className="cx-note">
            {cameBack
              ? "Nothing has been charged. Your seats are yours until the clock runs out."
              : "Seats are released automatically when the clock runs out."}
          </p>
        )}

        {expired && !settled && (
          <p className="cx-note">
            Your ten minutes ran out and the seats went back on sale. Nothing was
            charged.
          </p>
        )}

        {order.status === "expired" && (
          <p className="cx-note">
            These seats are back on sale. If you were charged, the payment has
            been refunded in full.
          </p>
        )}

        {error && <p className="cx-note cx-note-warn">{error}</p>}

        <div className="cx-actions">
          {!settled && !expired && (
            <>
              <button
                type="button"
                className="pill pill-turq"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  const token = requireToken();
                  if (token) checkout.mutate({ orderId, token });
                }}
              >
                {checkout.isPending
                  ? "Opening Stripe…"
                  : cameBack
                    ? "Return to payment"
                    : "Pay now"}
              </button>

              {/* The ONLY thing that releases a hold, and it takes a click.
                  Arriving at this page never does — a buyer can pay and then
                  press Back, and prefetchers issue GETs nobody asked for. */}
              <button
                type="button"
                className="pill pill-ghost"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  const token = requireToken();
                  if (token) release.mutate({ orderId, token });
                }}
              >
                {release.isPending ? "Releasing…" : "Release my seats"}
              </button>
            </>
          )}

          {(expired || order.status === "expired") && (
            <Link className="pill pill-turq" href="/">
              Find another event
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
