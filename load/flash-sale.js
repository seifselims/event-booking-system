import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

import { buyerEmail, classifyOrder, trpcMutation } from './lib.js';

/**
 * Scenario 2 — the flash sale. **This is the experiment behind the resume
 * line.**
 *
 * 500 VUs all buying the same tier inside a 10-second window, contending for a
 * deliberately small inventory. Spec §6.1 says the purchase transaction takes a
 * sorted `FOR UPDATE` on the tier rows and recomputes availability inside the
 * lock; this is the test that says whether that is true under real parallelism
 * rather than true by construction.
 *
 * **k6 alone cannot prove the guarantee.** It sees responses, not rows — a
 * server that happily issued 60 tickets for a 50-seat tier looks perfect from
 * here. `npm run reconcile` is the other half, and its "No ticket type
 * oversold" check is the actual assertion. Always run both.
 *
 * Required env:
 *   EVENT_ID  the event to buy from
 *   TIER_ID   the ticket type to contend over — make its quantity small (50)
 */

const EVENT_ID = __ENV.EVENT_ID;
const TIER_ID = __ENV.TIER_ID;

const succeeded = new Counter('orders_succeeded');
const soldOut = new Counter('orders_sold_out');
const capped = new Counter('orders_capped');
const rateLimited = new Counter('orders_rate_limited');
const serverErrors = new Counter('orders_server_errors');
const unexpected = new Rate('orders_unexpected');

export const options = {
  scenarios: {
    flash: {
      executor: 'per-vu-iterations',
      vus: 500,
      iterations: 1,
      // Everyone arrives inside the same short window — that is what makes the
      // lock contend rather than queue politely.
      maxDuration: '30s',
    },
  },
  thresholds: {
    // Spec §9: p95 < 800ms under the flash sale.
    'http_req_duration{name:orders.createOrder}': ['p(95)<800'],
    // A 5xx means the lock threw or the transaction deadlocked — spec §6.1's
    // sorted acquisition exists to make that structurally impossible.
    orders_server_errors: ['count==0'],
    // Refusals are expected and correct; crashes and rate-limit noise are not.
    orders_unexpected: ['rate<0.01'],
  },
};

export function setup() {
  if (!EVENT_ID || !TIER_ID) {
    throw new Error(
      'flash-sale.js needs --env EVENT_ID=<id> --env TIER_ID=<id>. See load/README.md.',
    );
  }
  return {};
}

export default function () {
  const res = trpcMutation(
    'orders.createOrder',
    {
      eventId: EVENT_ID,
      buyerName: `Load Tester ${__VU}`,
      // Unique per VU: the per-email caps stay in force on purpose, and a
      // shared address would measure those instead of the lock.
      buyerEmail: buyerEmail('flash'),
      items: [{ ticketTypeId: TIER_ID, quantity: 1 }],
    },
    'orders.createOrder',
  );

  const kind = classifyOrder(res);

  switch (kind) {
    case 'ok':
      succeeded.add(1);
      break;
    case 'sold-out':
      soldOut.add(1);
      break;
    case 'capped':
      capped.add(1);
      break;
    case 'rate-limited':
      rateLimited.add(1);
      break;
    case 'server-error':
      serverErrors.add(1);
      break;
    default:
      break;
  }

  // "Unexpected" means neither a sale nor an honest refusal.
  unexpected.add(
    kind !== 'ok' && kind !== 'sold-out' && kind !== 'capped' ? 1 : 0,
  );

  check(res, {
    'no server error': () => kind !== 'server-error',
    'answered in time': (r) => r.timings.duration < 5000,
  });
}

export function teardown() {
  console.log(
    '\nk6 saw the responses. It did NOT verify the database.\n' +
      'Run `npm run reconcile` now — its "No ticket type oversold" check is\n' +
      'the real assertion behind zero oversells.\n',
  );
}
