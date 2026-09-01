"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { formatEGP } from "@/lib/format";
import { MAX_TICKETS_PER_EVENT } from "@/lib/orders";
import { useTRPC } from "@/lib/trpc/react";
import type { EventPageTier } from "@/lib/trpc/types";

import { writeOrderToken } from "./checkout-countdown";

/**
 * Why a tier can't be bought right now, or `null` when it can.
 *
 * Order matters: a sold-out tier whose sales window has also closed reads as
 * sold out, which is the more useful thing to tell someone.
 */
type TierBlock = "sold-out" | "not-yet" | "closed";

function blockReason(tier: EventPageTier, now: Date): TierBlock | null {
  if (tier.available <= 0) return "sold-out";
  if (tier.salesStartAt && tier.salesStartAt > now) return "not-yet";
  if (tier.salesEndAt && tier.salesEndAt < now) return "closed";
  return null;
}

/**
 * The most of one tier a single order may hold.
 *
 * Three caps bind here: `MAX_TICKETS_PER_EVENT` is the platform's, `maxPerOrder`
 * is the organizer's, and `available` is what physically remains.
 * `takenByOthers` is the quantity already picked from *other* tiers, which eats
 * into the same allowance — so the platform cap tightens as the basket fills.
 *
 * `allowance` is what the platform cap leaves this buyer for the event, which
 * the email gate resolves before any stepper is live. So the ceiling is the
 * buyer's real remaining number, and a quantity this component offers is never
 * one `createOrder` would have to refuse.
 */
function ceilingFor(
  tier: EventPageTier,
  takenByOthers: number,
  allowance: number,
) {
  return Math.max(
    0,
    Math.min(tier.maxPerOrder, tier.available, allowance - takenByOthers),
  );
}

/** A plausible address, enough to bother asking the server about. */
function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Below this many seats left, the tier shows how few remain. */
const SCARCE_THRESHOLD = 20;

/**
 * The buyer's ticket picker on `/e/[slug]` (spec §7.1, step 1).
 *
 * Tiers are the sleeve's numbered track listing (`.trk`, DESIGN.md § Components)
 * with a quantity stepper on each row. Checking out calls `orders.createOrder`,
 * which takes the seats under a row lock (§6.1), then hands the order to
 * `/checkout/[orderId]` for payment.
 *
 * `available` comes from the page's query and is a *display* number. It is what
 * the stepper clamps against so the UI stays honest, but the purchase mutation
 * must recompute it under a lock; two buyers can be on this screen at once.
 *
 * **The email is collected first, before any stepper is live.** The per-event
 * cap counts what an address already holds, so without it the steppers would
 * have to clamp to the full four and walk a returning buyer into a refusal on
 * submit. It is asked once, and confirming it is what opens the tiers.
 */
export function TicketSelector({
  eventId,
  slug,
  tiers,
}: {
  eventId: string;
  slug: string;
  tiers: EventPageTier[];
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Read once per render rather than per row, so every tier in one paint is
  // judged against the same instant. Sales windows are minute-scale, so this
  // does not need to tick — the page is server-rendered per request, and the
  // purchase mutation re-checks the window regardless.
  const now = useMemo(() => new Date(), []);

  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // What is typed, versus what has been submitted. Only the submitted address
  // is queried, so the allowance is not looked up on every keystroke.
  const [emailDraft, setEmailDraft] = useState("");
  const [buyerEmail, setBuyerEmail] = useState<string | null>(null);
  const [buyerName, setBuyerName] = useState("");

  /** The server's refusal, shown in place rather than as a vanishing toast. */
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  // `useQuery`, not `useSuspenseQuery`: this fires on a user action rather than
  // on initial paint, which is the one case docs/prefetching/ carves out.
  const allowanceQuery = useQuery({
    ...trpc.orders.remainingAllowance.queryOptions({
      eventId,
      buyerEmail: buyerEmail ?? "",
    }),
    enabled: buyerEmail !== null,
  });

  const allowance = allowanceQuery.data?.remaining ?? 0;

  /** How many tickets are picked from every tier except this one. */
  function takenByOthers(
    picked: Record<string, number>,
    exceptTierId: string,
  ) {
    return Object.entries(picked).reduce(
      (sum, [id, quantity]) => (id === exceptTierId ? sum : sum + quantity),
      0,
    );
  }

  function setQuantity(tier: EventPageTier, next: number) {
    setQuantities((current) => {
      const ceiling = ceilingFor(
        tier,
        takenByOthers(current, tier.id),
        allowance,
      );

      return { ...current, [tier.id]: Math.max(0, Math.min(next, ceiling)) };
    });
  }

  function confirmEmail() {
    if (!looksLikeEmail(emailDraft)) return;

    setBuyerEmail(emailDraft.trim());
    // A different address has a different allowance, so nothing already picked
    // can be carried across — it may exceed what the new one is entitled to.
    setQuantities({});
    setPurchaseError(null);
  }

  const createOrder = useMutation(
    trpc.orders.createOrder.mutationOptions({
      onSuccess: (order) => {
        // The token is handed over exactly once. Stashed per-tab rather than
        // put in the URL, which would leak it into history and the Referer
        // header on the way to Stripe.
        writeOrderToken(order.orderId, order.token);

        router.push(`/checkout/${order.orderId}`);
      },
      onError: (error) => {
        setPurchaseError(error.message);

        // A CONFLICT means inventory moved under us — someone else took the
        // seats between this page rendering and the click. Refetching repaints
        // the tiers with real numbers, so `blockReason` turns a sold-out tier's
        // stepper into the em-dash instead of leaving it enabled at a quantity
        // that can never be sold. Also clears any picks the new numbers cannot
        // support.
        if (error.data?.code === "CONFLICT") {
          setQuantities({});
          void queryClient.invalidateQueries({
            queryKey: trpc.events.getEventBySlug.queryKey({ slug }),
          });
        }

        // The allowance changed (another order landed under this address), so
        // the gate's number is stale too.
        if (error.data?.code === "PRECONDITION_FAILED" && buyerEmail) {
          void queryClient.invalidateQueries({
            queryKey: trpc.orders.remainingAllowance.queryKey({
              eventId,
              buyerEmail,
            }),
          });
        }
      },
    }),
  );

  const selected = tiers
    .map((tier) => ({ tier, quantity: quantities[tier.id] ?? 0 }))
    .filter((line) => line.quantity > 0);

  const totalPiastres = selected.reduce(
    (sum, line) => sum + line.tier.pricePiastres * line.quantity,
    0,
  );

  const totalTickets = selected.reduce((sum, line) => sum + line.quantity, 0);

  // An event with no tiers is unconfigured, not sold out — the organizer has
  // not priced it yet. Say so rather than rendering an empty listing.
  if (tiers.length === 0) {
    return (
      <div className="pick">
        <div className="pick-h">
          <span>Tickets</span>
        </div>
        <p className="pick-empty">
          Tickets for this event aren&rsquo;t on sale yet. Check back soon.
        </p>
      </div>
    );
  }

  const confirmed = buyerEmail !== null;
  const resolving = confirmed && allowanceQuery.isPending;
  const exhausted = confirmed && !resolving && allowance <= 0;

  return (
    <div className="pick">
      <div className="pick-h">
        <span>Tickets</span>
        <span>Select</span>
      </div>

      {/* The gate. Tiers and prices stay visible behind it — this asks who the
          buyer is, it does not hide what is on sale. */}
      <div className="pick-gate">
        {confirmed ? (
          <p className="pick-gate-set">
            <span>
              Buying as <b>{buyerEmail}</b>
            </span>
            <button
              type="button"
              className="pick-gate-change"
              onClick={() => {
                setBuyerEmail(null);
                setQuantities({});
                setPurchaseError(null);
              }}
            >
              Change
            </button>
          </p>
        ) : (
          <>
            <label className="pick-gate-label" htmlFor="buyer-email">
              Your email
            </label>
            <div className="pick-gate-row">
              <input
                id="buyer-email"
                type="email"
                className="pick-gate-input"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    confirmEmail();
                  }
                }}
                placeholder="you@example.com"
                autoComplete="email"
              />
              <button
                type="button"
                className="pill pill-turq"
                onClick={confirmEmail}
                disabled={!looksLikeEmail(emailDraft)}
              >
                Continue
              </button>
            </div>
            <p className="pick-gate-why">
              Tickets are sent here, and there&rsquo;s a limit of{" "}
              {MAX_TICKETS_PER_EVENT} per person for this event.
            </p>
          </>
        )}

        {resolving && (
          <p className="pick-gate-why">Checking your ticket limit&hellip;</p>
        )}

        {exhausted && (
          <p className="pick-gate-why">
            This address already has {MAX_TICKETS_PER_EVENT} tickets for this
            event, which is the maximum.
          </p>
        )}

        {confirmed &&
          !resolving &&
          allowance > 0 &&
          allowance < MAX_TICKETS_PER_EVENT && (
            <p className="pick-gate-why">
              You already have {MAX_TICKETS_PER_EVENT - allowance} for this
              event, so you can buy {allowance} more.
            </p>
          )}
      </div>

      {tiers.map((tier, i) => {
        const block = blockReason(tier, now);
        const quantity = quantities[tier.id] ?? 0;
        const ceiling = ceilingFor(tier, totalTickets - quantity, allowance);
        const scarce = !block && tier.available <= SCARCE_THRESHOLD;

        return (
          <div className={`trk pick-row${block ? " out" : ""}`} key={tier.id}>
            <b>{String(i + 1).padStart(2, "0")}</b>

            <span className="pick-name">
              {tier.name}

              {block === "sold-out" && <em className="pick-note">Sold out</em>}

              {block === "not-yet" && tier.salesStartAt && (
                <em className="pick-note">
                  On sale{" "}
                  <time dateTime={tier.salesStartAt.toISOString()}>
                    {tier.salesStartAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      timeZone: "Africa/Cairo",
                    })}
                  </time>
                </em>
              )}

              {block === "closed" && (
                <em className="pick-note">Sales closed</em>
              )}

              {scarce && (
                <em className="pick-note hot">
                  Only {tier.available} left
                </em>
              )}
            </span>

            <i className="num">
              {formatEGP(tier.pricePiastres).replace("EGP ", "")}
            </i>

            {block ? (
              /* The stepper is replaced, not disabled: there is no quantity to
                 pick, and a dimmed 0 invites clicking at it. */
              <span className="qty-none" aria-hidden="true">
                &mdash;
              </span>
            ) : (
              <span className="qty">
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => setQuantity(tier, quantity - 1)}
                  disabled={quantity === 0}
                  aria-label={`One fewer ${tier.name}`}
                >
                  &minus;
                </button>

                <output className="qty-n num" aria-label={`${tier.name} quantity`}>
                  {quantity}
                </output>

                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => setQuantity(tier, quantity + 1)}
                  disabled={quantity >= ceiling}
                  aria-label={`One more ${tier.name}`}
                >
                  +
                </button>
              </span>
            )}
          </div>
        );
      })}

      <div className="pick-foot">
        <div className="pick-total">
          <span>
            {totalTickets === 0
              ? "No tickets selected"
              : `${totalTickets} ticket${totalTickets === 1 ? "" : "s"}`}
          </span>
          <b className="num">{formatEGP(totalPiastres)}</b>
        </div>

        {/* The name is asked here rather than at the gate: the gate exists to
            resolve the allowance, which needs only the address. Asking for both
            up front would put two fields in front of the prices. */}
        {confirmed && totalTickets > 0 && (
          <div className="pick-name-fld">
            <label htmlFor="buyer-name">Name on the tickets</label>
            <input
              id="buyer-name"
              className="pick-gate-input"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="Full name"
              autoComplete="name"
            />
          </div>
        )}

        {purchaseError && <p className="pick-error">{purchaseError}</p>}

        <button
          type="button"
          className="pill pill-turq pick-go"
          disabled={
            !confirmed ||
            totalTickets === 0 ||
            buyerName.trim().length === 0 ||
            createOrder.isPending
          }
          onClick={() => {
            if (!buyerEmail) return;

            setPurchaseError(null);
            createOrder.mutate({
              eventId,
              buyerEmail,
              buyerName: buyerName.trim(),
              items: selected.map((line) => ({
                ticketTypeId: line.tier.id,
                quantity: line.quantity,
              })),
            });
          }}
        >
          {createOrder.isPending
            ? "Holding your seats…"
            : `Checkout — ${formatEGP(totalPiastres)}`}
        </button>
      </div>

      {/* Availability here is derived for display; the seat is only truly held
          once an order exists. Saying so keeps the promise honest. */}
      <p className="pick-fine">
        {!confirmed
          ? "Enter your email to choose quantities."
          : totalTickets >= allowance && allowance > 0
            ? `That's your full allowance of ${MAX_TICKETS_PER_EVENT} tickets for this event.`
            : "Seats are held for ten minutes once you start checkout, not while you browse."}
      </p>
    </div>
  );
}
