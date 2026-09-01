import { sql } from 'drizzle-orm';

import { db } from '../lib/db';

/**
 * Reconciliation (spec §9) — `npm run reconcile`.
 *
 * Exits zero only if every invariant below holds across the whole dataset.
 * This is the file that separates "it worked when I clicked it" from "it is
 * correct": the checkout path can look healthy in the browser while quietly
 * having issued two tickets for one payment, or none for another.
 *
 * Every check is one SQL statement returning the offending rows. They are
 * written as raw SQL rather than Drizzle expressions because each is a
 * whole-table assertion with correlated aggregates — the shape reads better as
 * SQL, and this file is meant to be read by someone auditing the guarantees.
 *
 * Run it in CI against the seeded dataset, and after any load test.
 */

type Check = {
  readonly name: string;
  /** What a row in the result means — printed above the offenders. */
  readonly failure: string;
  readonly query: ReturnType<typeof sql.raw>;
};

const CHECKS: readonly Check[] = [
  {
    name: 'Paid orders have exactly the tickets they bought',
    failure: 'these paid orders have a ticket count != sum of item quantities',
    // Both sides aggregated in independent subqueries, never in one join:
    // joining order_items and tickets to orders in a single pass multiplies
    // their rows and inflates both sums (the same trap documented for
    // getMyEventsWithStats in AGENTS.md).
    query: sql.raw(`
      SELECT o.id,
             COALESCE(i.want, 0) AS expected_tickets,
             COALESCE(t.got, 0)  AS actual_tickets
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(quantity)::int AS want
        FROM order_items GROUP BY order_id
      ) i ON i.order_id = o.id
      LEFT JOIN (
        SELECT order_id, COUNT(*)::int AS got
        FROM tickets WHERE voided_at IS NULL GROUP BY order_id
      ) t ON t.order_id = o.id
      WHERE o.status = 'paid'
        AND COALESCE(i.want, 0) <> COALESCE(t.got, 0)
    `),
  },
  {
    name: 'No orphan tickets',
    failure: 'these tickets belong to an order that is not paid',
    // A ticket against a pending or expired order is a live QR for money we
    // never took — the worst state the system can reach.
    query: sql.raw(`
      SELECT t.id AS ticket_id, t.order_id, o.status
      FROM tickets t
      JOIN orders o ON o.id = t.order_id
      WHERE o.status <> 'paid' AND t.voided_at IS NULL
    `),
  },
  {
    name: 'No ticket type oversold',
    failure: 'these tiers have more live tickets than their quantity — an OVERSELL',
    // The §6.1 guarantee, stated as data rather than as reasoning about locks.
    // This is the check the load test exists to try to break.
    query: sql.raw(`
      SELECT tt.id, tt.name, tt.quantity, COUNT(t.id)::int AS issued
      FROM ticket_types tt
      JOIN tickets t
        ON t.ticket_type_id = tt.id AND t.voided_at IS NULL
      GROUP BY tt.id, tt.name, tt.quantity
      HAVING COUNT(t.id) > tt.quantity
    `),
  },
  {
    name: 'Paid order totals match their line items',
    failure: 'these paid orders have total_piastres != sum(quantity * unit_price)',
    // Integer piastres throughout, so this is an exact comparison. One float
    // anywhere in the money path and this fails by fractions (spec §13).
    query: sql.raw(`
      SELECT o.id, o.total_piastres, COALESCE(i.computed, 0) AS computed_piastres
      FROM orders o
      LEFT JOIN (
        SELECT order_id,
               SUM(quantity * unit_price_piastres)::int AS computed
        FROM order_items GROUP BY order_id
      ) i ON i.order_id = o.id
      WHERE o.status = 'paid'
        AND o.total_piastres <> COALESCE(i.computed, 0)
    `),
  },
  {
    name: 'Refunded orders have no live tickets',
    failure: 'these refunded orders still have non-voided tickets',
    // Organizer-initiated refunds are out of scope, so nothing in the app
    // reaches this state — only db:seed writes refunded rows. The check stays
    // because the invariant is what makes a refund safe: a live QR against
    // money we gave back means someone walks in for free.
    query: sql.raw(`
      SELECT o.id, COUNT(t.id)::int AS live_tickets
      FROM orders o
      JOIN tickets t ON t.order_id = o.id AND t.voided_at IS NULL
      WHERE o.status = 'refunded'
      GROUP BY o.id
    `),
  },
  {
    name: 'Auto-refunded orders issued nothing',
    failure: 'these §6.3 auto-refunds have live tickets — we refunded a real seat',
    // The §6.3 branch marks `expired` + `refunded_at` rather than `refunded`,
    // precisely so it can be told apart from an organizer refund. Its
    // invariant is stronger: it fires only when seats were gone, so it must
    // never have issued any.
    query: sql.raw(`
      SELECT o.id, COUNT(t.id)::int AS live_tickets
      FROM orders o
      JOIN tickets t ON t.order_id = o.id AND t.voided_at IS NULL
      WHERE o.status = 'expired' AND o.refunded_at IS NOT NULL
      GROUP BY o.id
    `),
  },
  {
    name: 'Every ticket secret is unique',
    failure: 'these secrets appear on more than one ticket',
    // Enforced by tickets_secret_uidx, so a failure here means the index is
    // missing — which is exactly the kind of drift `db:push` can cause.
    query: sql.raw(`
      SELECT secret, COUNT(*)::int AS copies
      FROM tickets GROUP BY secret HAVING COUNT(*) > 1
    `),
  },
] as const;

async function main() {
  console.log('\nReconciling…\n');

  let failures = 0;

  for (const check of CHECKS) {
    const { rows } = await db.execute(check.query);

    if (rows.length === 0) {
      console.log(`  PASS  ${check.name}`);
      continue;
    }

    failures += 1;
    console.log(`  FAIL  ${check.name}`);
    console.log(`        ${rows.length} row(s) — ${check.failure}`);
    for (const row of rows.slice(0, 10)) {
      console.log(`          ${JSON.stringify(row)}`);
    }
    if (rows.length > 10) {
      console.log(`          … and ${rows.length - 10} more`);
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} of ${CHECKS.length} checks FAILED.\n`);
    process.exit(1);
  }

  console.log(`\nAll ${CHECKS.length} checks passed.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nReconcile could not run:', error);
    process.exit(1);
  });
