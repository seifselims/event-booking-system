import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

import { BASE, buyerEmail, classifyOrder, fakeIp, trpcMutation } from './lib.js';

/**
 * Scenario 3 — mixed, sustained. 70% browse / 30% purchase for 10 minutes.
 *
 * The steady-state test. The flash sale asks "does the lock hold under a
 * spike"; this asks "does anything degrade when reads and writes share the
 * database for a while" — connection exhaustion, holds accumulating faster than
 * they lapse, an aggregate that slows as `order_items` grows.
 *
 * Because it runs long enough for the 10-minute hold to lapse, it is also the
 * scenario worth pairing with `npm run holds:sweep` to watch expiry keep up.
 *
 * Required env: SLUG, EVENT_ID, TIER_ID.
 */

const SLUG = __ENV.SLUG;
const EVENT_ID = __ENV.EVENT_ID;
const TIER_ID = __ENV.TIER_ID;

const purchases = new Counter('mixed_purchases');
const refusals = new Counter('mixed_refusals');
const serverErrors = new Counter('mixed_server_errors');

export const options = {
  scenarios: {
    mixed: {
      executor: 'constant-vus',
      vus: 100,
      duration: '10m',
    },
  },
  thresholds: {
    'http_req_duration{kind:browse}': ['p(95)<300'],
    'http_req_duration{kind:purchase}': ['p(95)<800'],
    mixed_server_errors: ['count==0'],
    http_req_failed: ['rate<0.02'],
  },
};

export function setup() {
  if (!SLUG || !EVENT_ID || !TIER_ID) {
    throw new Error(
      'mixed.js needs --env SLUG, EVENT_ID and TIER_ID. See load/README.md.',
    );
  }
  return {};
}

export default function () {
  // 70/30 split, decided per iteration.
  if (Math.random() < 0.7) {
    const res = http.get(`${BASE}/e/${SLUG}`, {
      headers: { 'X-Forwarded-For': fakeIp() },
      tags: { name: 'event', kind: 'browse' },
    });
    check(res, { 'browse 200': (r) => r.status === 200 });
  } else {
    const res = trpcMutation(
      'orders.createOrder',
      {
        eventId: EVENT_ID,
        buyerName: `Mixed Tester ${__VU}`,
        buyerEmail: buyerEmail('mixed'),
        items: [{ ticketTypeId: TIER_ID, quantity: 1 }],
      },
      'purchase',
    );
    // Retag so the two thresholds can be read apart.
    res.request.tags = { kind: 'purchase' };

    const kind = classifyOrder(res);
    if (kind === 'ok') purchases.add(1);
    else if (kind === 'server-error') serverErrors.add(1);
    else refusals.add(1);

    check(res, { 'no server error': () => kind !== 'server-error' });
  }

  sleep(1);
}

export function teardown() {
  console.log('\nRun `npm run reconcile` to check the database.\n');
}
