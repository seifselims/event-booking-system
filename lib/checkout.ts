import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The buyer's magic link to their tickets (spec §8, `/orders/[id]/[token]`).
 *
 * Server-only: it reads the signing secret. Buyers are guests with no account
 * (spec §2), so this token *is* the authorisation — there is no session to
 * check.
 *
 * **Derived, not stored.** The token is an HMAC of the order id rather than a
 * column, which means there is nothing to migrate, nothing to leak from a table
 * dump, and the link is stable forever. The cost is that it **cannot be revoked**
 * without rotating the secret, which would invalidate every buyer's link at
 * once. Acceptable here — the link shows tickets its holder already owns, and a
 * leaked link is a leaked ticket either way. If per-order revocation is ever
 * needed, the answer is a real column, not a cleverer HMAC.
 */

/**
 * Namespaces this signature so it can never be replayed against anything else
 * signed with the same key. Without the label, a token minted here would verify
 * anywhere else that HMACs a bare id with `BETTER_AUTH_SECRET`.
 */
const TOKEN_LABEL = 'gate.order-token.v1';

/**
 * 32 base64url characters ≈ 192 bits of the digest.
 *
 * Truncation is safe for HMAC (unlike for a raw hash used as an id), and short
 * enough that the whole link survives being pasted into WhatsApp without
 * wrapping — which is where these actually get sent.
 */
const TOKEN_LENGTH = 32;

function signingKey() {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET is not set — order tokens cannot be signed.',
    );
  }

  return secret;
}

export function deriveOrderToken(orderId: string) {
  return createHmac('sha256', signingKey())
    .update(`${TOKEN_LABEL}:${orderId}`)
    .digest('base64url')
    .slice(0, TOKEN_LENGTH);
}

/**
 * Constant-time comparison of a supplied token against the expected one.
 *
 * Two details that are easy to get wrong and silent when wrong:
 *
 * - **The length check comes first.** `timingSafeEqual` *throws* on a length
 *   mismatch rather than returning false, so a short token from a URL would
 *   crash the route instead of 404ing.
 * - **`timingSafeEqual`, never `===`.** String comparison returns at the first
 *   differing byte, so response latency leaks the correct prefix one character
 *   at a time to anyone measuring it.
 */
export function verifyOrderToken(orderId: string, token: string) {
  const expected = Buffer.from(deriveOrderToken(orderId));
  const supplied = Buffer.from(token);

  if (expected.length !== supplied.length) return false;

  return timingSafeEqual(expected, supplied);
}

/**
 * Absolute origin for URLs handed to Stripe.
 *
 * Stripe's `success_url` / `cancel_url` must be absolute, so this cannot fall
 * back to a relative path. `VERCEL_PROJECT_PRODUCTION_URL` is the stable
 * production host (`VERCEL_URL` is the per-deployment one, which would send a
 * buyer back to a preview build they never started on).
 */
export function appUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;

  return 'http://localhost:3000';
}

/** The buyer's ticket link, absolute — the one Stripe redirects to on success. */
export function orderTicketUrl(orderId: string) {
  return `${appUrl()}/orders/${orderId}/${deriveOrderToken(orderId)}`;
}
