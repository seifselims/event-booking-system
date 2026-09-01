"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { formatEGP, formatEventDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";

import { readOrderToken } from "./checkout-countdown";

/**
 * The QR codes, shown over the event page the moment a payment clears.
 *
 * Opens when Stripe redirects back to `/e/[slug]?paid=<orderId>`. The buyer sees
 * their tickets immediately, without a page that has to be navigated away from —
 * and closing it leaves them where they started rather than on a dead end.
 *
 * **This is a convenience, not the tickets themselves.** The durable copy lives
 * at `/orders/[id]/[token]`, which the confirmation email links to, so a closed
 * modal never loses anything. That is why the modal can afford to be dismissible.
 *
 * A native `<dialog>` + `showModal()`, matching `organizers-panel.tsx`: focus
 * trapping, the inert background, Escape-to-close and the `::backdrop` all come
 * from the platform rather than being hand-rolled.
 */
export function TicketModal() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const orderId = searchParams.get("paid");

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dismissed, setDismissed] = useState(false);

  /**
   * Whether hydration has finished.
   *
   * The token lives in `sessionStorage`, which does not exist on the server — so
   * the server renders *no dialog* while the client would render one, and React
   * rejects the mismatch. (`<Suspense>` does not help here: it controls when a
   * subtree may suspend, not whether it renders server-side.)
   *
   * `useSyncExternalStore` is the sanctioned way to express "this value differs
   * between server and client": the third argument is the *server* snapshot, so
   * React knows the first pass is meant to disagree and reconciles it instead of
   * erroring. A `useState` + `useEffect` pair would do the same thing but React
   * cannot tell it apart from an accidental cascading render.
   */
  const hydrated = useSyncExternalStore(
    // Never re-subscribes: this flips once, at hydration, and never again.
    () => () => {},
    () => true,
    () => false,
  );

  // `?paid=` names the order but proves nothing — the token is what authorises,
  // and it lives in this tab's `sessionStorage` (never the URL, which would put
  // it in history and in the Referer sent to Stripe).
  const token = hydrated && orderId ? readOrderToken(orderId) : null;

  const { data } = useQuery({
    ...trpc.checkout.ticketsForModal.queryOptions({
      orderId: orderId ?? "",
      token: token ?? "",
    }),
    enabled: Boolean(orderId && token),
    // Tight at first, then backing off. The webhook normally lands within a
    // second of the redirect, so the early polls are the ones that matter; once
    // it is clearly late, hammering the server every 800ms helps nobody.
    //
    // Keyed on the fetch count rather than a clock: reading `Date.now()` inside
    // a render-phase callback is impure, and the count is a fine proxy — the
    // first dozen polls are roughly the first ten seconds.
    refetchInterval: (query) => {
      if (query.state.data?.ready) return false;

      return query.state.dataUpdateCount > 12 ? 3000 : 800;
    },
  });

  /**
   * How long we have been waiting, in milliseconds.
   *
   * Measured from a fixed start recorded inside the effect — **not** from the
   * query's `dataUpdatedAt`, which changes on every poll and so would restart
   * the clock each time, meaning the deadline never arrives. That bug made the
   * recovery path appear far later than intended.
   */
  const [elapsed, setElapsed] = useState(0);

  const reconcile = useMutation(
    trpc.checkout.reconcile.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.checkout.ticketsForModal.queryKey({
            orderId: orderId ?? "",
            token: token ?? "",
          }),
        });
      },
    }),
  );

  /**
   * Tick a wall clock while waiting, and **self-heal repeatedly**.
   *
   * The first attempt fires at three seconds — well past a healthy webhook
   * (~1s) but before a buyer starts to worry — and then every four seconds
   * after that, rather than once. A single attempt is not enough: it can land
   * before Stripe has finished marking the session paid, and then nothing ever
   * tries again. Retrying is what turns a dead webhook from "stranded buyer"
   * into "a few seconds late".
   *
   * `reconcile` is idempotent (an already-paid order returns `already-paid` and
   * issues nothing) and rate-limited to 6/min server-side, so a repeating call
   * is safe. `isPending` keeps us from stacking requests on a slow network.
   */
  // The live mutation, held in a ref so the effect below does not depend on it.
  //
  // **This is the bug that made the self-heal never fire.** TanStack returns a
  // fresh mutation object on every render, so listing `reconcile` as a
  // dependency tore the effect down and rebuilt it several times a second —
  // resetting `startedAt` and `lastAttempt` each time, so the three-second
  // threshold was never crossed and the buyer waited forever. A ref gives the
  // interval the current mutation without making the effect re-run.
  const reconcileRef = useRef(reconcile);

  // Synced in an effect, not during render: writing a ref while rendering is
  // a side effect React may run more than once per commit.
  useEffect(() => {
    reconcileRef.current = reconcile;
  }, [reconcile]);

  useEffect(() => {
    if (!orderId || !token || data?.ready) return;

    // Recorded here rather than during render: calling `Date.now()` while
    // rendering is impure, and React may render more than once per commit.
    const startedAt = Date.now();
    let lastAttempt = 0;

    const id = setInterval(() => {
      const waited = Date.now() - startedAt;
      setElapsed(waited);

      const due = lastAttempt === 0 ? waited > 3000 : waited - lastAttempt > 4000;

      if (due && !reconcileRef.current.isPending) {
        lastAttempt = waited;
        reconcileRef.current.mutate({ orderId, token });
      }
    }, 500);

    return () => clearInterval(id);
    // Deliberately NOT depending on `reconcile` — see `reconcileRef` above.
  }, [orderId, token, data?.ready]);

  // The manual button appears once the automatic attempts have also failed.
  const waitedTooLong = elapsed > 8000 && !data?.ready;

  // Opens on `?paid=` alone. The token gates what the dialog *shows* — tickets
  // versus a "check your email" note — not whether it appears: a buyer who has
  // just paid must never be met with silence.
  const open = Boolean(orderId && hydrated && !dismissed);

  // State drives the element, rather than click handlers reaching into the ref.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    setDismissed(true);

    // Strip `?paid=` so a refresh — or the back button — does not reopen a modal
    // the buyer has already dismissed.
    router.replace(window.location.pathname, { scroll: false });
  }

  // `showModal()` handles Escape itself, but it fires `cancel` rather than our
  // close handler — so without this the dialog would shut while `?paid=` stayed
  // in the URL and the modal reopened on the next render.
  function onCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    close();
  }

  // Nothing to show without an order, and nothing may render before hydration.
  if (!orderId || !hydrated) return null;

  // Paid, but this tab has no token — the buyer finished checkout somewhere else
  // (another tab, another browser, or storage they had blocked). Their tickets
  // exist and the email is already on its way, so say that rather than showing
  // an empty screen after a payment, which reads as money lost.
  if (!token) {
    return (
      <dialog ref={dialogRef} className="modal tkm" onCancel={onCancel}>
        <div className="modal-head">
          <h3>Payment received</h3>
        </div>

        <p className="modal-note">
          Your tickets are confirmed. We couldn&rsquo;t show them here because
          this checkout was started in a different tab or browser &mdash; but
          they&rsquo;re on their way to your inbox, with a link that opens them
          any time.
        </p>

        <div className="modal-foot tkm-foot">
          <button type="button" className="pill pill-ghost" onClick={close}>
            Close
          </button>
        </div>
      </dialog>
    );
  }

  return (
    <dialog ref={dialogRef} className="modal tkm" onCancel={onCancel}>
      <div className="modal-head">
        <h3>{data?.ready ? "You're in" : "Confirming your payment"}</h3>
      </div>

      {!data?.ready && (
        <p className="modal-note">
          This takes a couple of seconds. Your tickets will appear here — and
          we&rsquo;re emailing them to you as well.
        </p>
      )}

      {/* Fulfilment normally lands in about a second. If it has not, the
          confirmation from Stripe is not reaching us — so ask Stripe directly
          rather than leaving the buyer watching a spinner after paying. */}
      {!data?.ready && waitedTooLong && (
        <div className="tkm-stall">
          <p>
            This is taking longer than usual. Your payment went through — we
            just haven&rsquo;t had confirmation yet.
          </p>
          <button
            type="button"
            className="pill pill-turq"
            disabled={reconcile.isPending}
            onClick={() => {
              if (orderId && token) reconcile.mutate({ orderId, token });
            }}
          >
            {reconcile.isPending ? "Checking…" : "Check again"}
          </button>
        </div>
      )}

      {data?.ready && (
        <>
          <p className="modal-note">
            {data.stubs.length} ticket{data.stubs.length === 1 ? "" : "s"} for{" "}
            <b>{data.eventTitle}</b> &middot; {formatEventDate(data.startsAt)} at{" "}
            {data.venue}.
          </p>

          {/* The instruction the buyer needs before they close this. */}
          <p className="tkm-save">
            📸 <b>Screenshot these now if you like</b> — they&rsquo;re also in
            your inbox at <b>{data.buyerEmail}</b>, and always available from the
            link in that email.
          </p>

          <div className="modal-body tkm-grid">
            {data.stubs.map((stub, i) => (
              <div className="tkm-stub" key={stub.id}>
                <div className="tkm-tier">
                  <span>{stub.tierName}</span>
                  <b>
                    {String(i + 1).padStart(2, "0")}/
                    {String(data.stubs.length).padStart(2, "0")}
                  </b>
                </div>

                {/* Already a data URL; next/image would only add indirection. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={stub.qr} alt="" width={180} height={180} />

                <div className="tkm-holder">{data.buyerName}</div>
              </div>
            ))}
          </div>

          <p className="tkm-total num">Paid {formatEGP(data.totalPiastres)}</p>
        </>
      )}

      <div className="modal-foot tkm-foot">
        {data?.ready && (
          <a className="pill pill-turq" href={data.ticketUrl}>
            Open ticket page
          </a>
        )}

        <button type="button" className="pill pill-ghost" onClick={close}>
          {data?.ready ? "Done" : "Close"}
        </button>
      </div>
    </dialog>
  );
}
