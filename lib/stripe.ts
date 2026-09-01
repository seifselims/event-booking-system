import Stripe from 'stripe';

/**
 * The Stripe client, and the money conversion that crosses into it.
 *
 * Server-only. `STRIPE_SECRET_KEY` is a secret — importing this from a Client
 * Component would bundle it for the browser. Nothing here is safe to reach from
 * `"use client"` code; the buyer's side of checkout is a redirect to a Stripe
 * URL, not a Stripe SDK call.
 */

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  throw new Error(
    'STRIPE_SECRET_KEY is not set. Add it to .env — a test-mode key (sk_test_… or rk_test_…) for local work.',
  );
}

/**
 * Fail loudly if a live key is ever used outside production.
 *
 * The §6.3 refund branch and the §6.1 oversell race both have to be exercised by
 * actually running them, which in live mode means moving real money through code
 * under development. The prefix is the mode marker, so this is checkable.
 */
if (
  process.env.NODE_ENV !== 'production' &&
  /^(sk|rk)_live_/.test(secretKey)
) {
  throw new Error(
    'A live Stripe key is set outside production. Use a test key (sk_test_… or rk_test_…) for local work.',
  );
}

/**
 * One client for the process.
 *
 * `apiVersion` is deliberately not pinned: this SDK is built and typed against
 * one version (`Stripe.ApiVersion`, currently `2026-08-26.dahlia`), and naming a
 * different string there would let the wire format drift from the types without
 * a compile error. Upgrading the version means upgrading the package.
 */
export const stripe = new Stripe(secretKey);

/**
 * Is this client talking to test mode?
 *
 * Read from the key prefix rather than `NODE_ENV`, so it reflects what Stripe
 * will actually do rather than what the deployment thinks it is.
 */
export const isTestMode = /^(sk|rk)_test_/.test(secretKey);

/**
 * The currency every charge is made in.
 *
 * Egypt's minor unit is 1/100, the same as `price_piastres` (AGENTS.md: money is
 * integer piastres), so amounts cross into Stripe unchanged — see
 * `toStripeAmount`. Changing this currency breaks that identity and every stored
 * amount would need converting.
 */
export const CURRENCY = 'egp';

/**
 * Piastres → the `unit_amount` Stripe expects.
 *
 * Identity, because both sides count in 1/100 of the same currency. It exists as
 * a named function anyway: it is the one place the two units meet, so if
 * `CURRENCY` ever changes this is the single thing that has to change with it —
 * rather than a bare `pricePiastres` scattered across the checkout code reading
 * as though no conversion were ever needed.
 */
export function toStripeAmount(piastres: number) {
  return piastres;
}
