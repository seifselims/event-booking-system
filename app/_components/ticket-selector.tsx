"use client";

import { useMemo, useState } from "react";

import { formatEGP } from "@/lib/format";
import type { EventPageTier } from "@/lib/trpc/types";

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
 * `maxPerOrder` is the organizer's cap; `available` is what physically remains.
 * The stepper stops at whichever binds first, so it can never offer a quantity
 * the purchase mutation would have to refuse.
 */
function ceilingFor(tier: EventPageTier) {
  return Math.max(0, Math.min(tier.maxPerOrder, tier.available));
}

/** Below this many seats left, the tier shows how few remain. */
const SCARCE_THRESHOLD = 20;

/**
 * The buyer's ticket picker on `/e/[slug]` (spec §7.1, step 1).
 *
 * Tiers are the sleeve's numbered track listing (`.trk`, DESIGN.md § Components)
 * with a quantity stepper on each row. Quantities live here as component state
 * and go nowhere yet: this is selection only — creating the pending order under
 * a row lock (§6.1) and the redirect to Stripe are the next stage.
 *
 * `available` comes from the page's query and is a *display* number. It is what
 * the stepper clamps against so the UI stays honest, but the purchase mutation
 * must recompute it under a lock; two buyers can be on this screen at once.
 */
export function TicketSelector({ tiers }: { tiers: EventPageTier[] }) {
  // Read once per render rather than per row, so every tier in one paint is
  // judged against the same instant. Sales windows are minute-scale, so this
  // does not need to tick — the page is server-rendered per request, and the
  // purchase mutation re-checks the window regardless.
  const now = useMemo(() => new Date(), []);

  const [quantities, setQuantities] = useState<Record<string, number>>({});

  function setQuantity(tier: EventPageTier, next: number) {
    const clamped = Math.max(0, Math.min(next, ceilingFor(tier)));

    setQuantities((current) => ({ ...current, [tier.id]: clamped }));
  }

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

  return (
    <div className="pick">
      <div className="pick-h">
        <span>Tickets</span>
        <span>Select</span>
      </div>

      {tiers.map((tier, i) => {
        const block = blockReason(tier, now);
        const ceiling = ceilingFor(tier);
        const quantity = quantities[tier.id] ?? 0;
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

        {/* Selection is as far as this stage goes: the pending order (§6.1) and
            the Stripe redirect are not built, so the control states that plainly
            rather than pretending to be a checkout that silently does nothing. */}
        <button
          type="button"
          className="pill pill-turq pick-go"
          disabled
          title="Checkout isn't wired up yet"
        >
          Checkout &mdash; coming soon
        </button>
      </div>

      {/* Availability here is derived for display; the seat is only truly held
          once an order exists. Saying so keeps the promise honest. */}
      <p className="pick-fine">
        Seats are held once you start checkout, not while you browse.
      </p>
    </div>
  );
}
