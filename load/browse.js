import { check, sleep } from 'k6';

import { BASE, fakeIp } from './lib.js';
import http from 'k6/http';

/**
 * Scenario 1 — browse. 200 VUs over the public pages.
 *
 * Every route here is `force-dynamic` and each render builds a tRPC context and
 * runs at least one aggregate query, so this measures the read path end to end:
 * Neon round trip, the `availabilityByEvent` grouped query, and RSC render.
 *
 * Required env: SLUG — a published event slug to hit.
 */

const SLUG = __ENV.SLUG;

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '1m', target: 200 },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Spec §9: p95 < 300ms for browse.
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  if (!SLUG) {
    throw new Error('browse.js needs --env SLUG=<event-slug>. See load/README.md.');
  }
  return {};
}

export default function () {
  const headers = { 'X-Forwarded-For': fakeIp() };

  // The rack — one listing query plus the grouped availability read.
  const landing = http.get(`${BASE}/`, { headers, tags: { name: 'landing' } });
  check(landing, { 'landing 200': (r) => r.status === 200 });

  // Tonight — the same shape, narrowed by a SQL time window.
  const tonight = http.get(`${BASE}/tonight`, {
    headers,
    tags: { name: 'tonight' },
  });
  check(tonight, { 'tonight 200': (r) => r.status === 200 });

  // An event page — availability per tier, the heaviest public read.
  const event = http.get(`${BASE}/e/${SLUG}`, {
    headers,
    tags: { name: 'event' },
  });
  check(event, { 'event 200': (r) => r.status === 200 });

  sleep(1);
}
