import http from 'k6/http';

/**
 * Shared helpers for the k6 scenarios.
 *
 * The app speaks tRPC v11 over HTTP with a superjson transformer, so a mutation
 * body is `{"json": <input>}` and the reply is
 * `{"result":{"data":{"json": <output>}}}`. Getting that wrapper wrong produces
 * a parse error that looks like a server fault, so it lives in one place.
 */

export const BASE = __ENV.BASE || 'http://localhost:3000';

/**
 * A unique-per-VU-iteration IP for `X-Forwarded-For`.
 *
 * `createOrder` is rate limited to 10/min keyed on `ctx.ip`. Without this the
 * flash sale measures the limiter rather than the row lock — see load/README.md
 * for why spoofing it here is legitimate.
 */
export function fakeIp() {
  const a = (__VU % 250) + 1;
  const b = (__ITER % 250) + 1;
  return `10.${a}.${b}.${(__VU * 7 + __ITER * 13) % 250}`;
}

/** A unique buyer address: the per-email hold caps are deliberately left on. */
export function buyerEmail(tag) {
  return `load-${tag}-${__VU}-${__ITER}-${Date.now()}@loadtest.invalid`;
}

export function trpcMutation(path, input, tag) {
  return http.post(
    `${BASE}/api/trpc/${path}`,
    JSON.stringify({ json: input }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': fakeIp(),
      },
      tags: { name: tag || path },
    },
  );
}

export function trpcQuery(path, input, tag) {
  const qs = input
    ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    : '';

  return http.get(`${BASE}/api/trpc/${path}${qs}`, {
    headers: { 'X-Forwarded-For': fakeIp() },
    tags: { name: tag || path },
  });
}

/**
 * Classify a createOrder response.
 *
 * A refusal is not a failure — with 500 VUs at 50 seats, ~450 *must* be
 * refused, and a run where everyone succeeds is the bug. What matters is that
 * refusals are the honest kind (sold out, cap reached) rather than crashes or
 * rate-limit noise.
 */
export function classifyOrder(res) {
  if (res.status === 200) {
    const body = res.json();
    if (body && body.result) return 'ok';
    if (body && body.error) return errorKind(body.error);
    return 'unparsable';
  }

  // tRPC maps its error codes onto HTTP status.
  if (res.status === 429) return 'rate-limited';
  if (res.status >= 500) return 'server-error';

  const body = res.json();
  return body && body.error ? errorKind(body.error) : 'client-error';
}

function errorKind(error) {
  const message = (error.json && error.json.message) || error.message || '';

  if (/sold out|only \d+|no longer available|not enough/i.test(message)) {
    return 'sold-out';
  }
  if (/at most|already hold|too many tickets/i.test(message)) return 'capped';
  if (/Too many attempts/i.test(message)) return 'rate-limited';

  return 'other-error';
}
