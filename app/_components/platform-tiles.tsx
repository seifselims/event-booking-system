"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { formatEGP } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";

/**
 * The four headline numbers for the whole platform — the cross-organizer twin
 * of `StatTiles`, reading `admin.platformTotals` instead of the scoped totals.
 *
 * Reads the totals prefetched by `app/admin/(console)/page.tsx`, so
 * `useSuspenseQuery` resolves from the hydrated cache on first paint and there
 * is no loading state here by design (docs/prefetching/).
 */
export function PlatformTiles() {
  const trpc = useTRPC();
  const { data: totals } = useSuspenseQuery(
    trpc.admin.platformTotals.queryOptions(),
  );

  const tiles = [
    {
      label: "Net revenue",
      value: formatEGP(totals.netPiastres),
      note:
        totals.refundedPiastres > 0
          ? `${formatEGP(totals.grossPiastres)} gross · ${formatEGP(totals.refundedPiastres)} refunded`
          : `${formatEGP(totals.grossPiastres)} gross · nothing refunded`,
    },
    {
      label: "Paid orders",
      value: totals.paidOrders.toLocaleString("en-EG"),
      note: `across ${totals.events} ${totals.events === 1 ? "event" : "events"}`,
    },
    {
      label: "Tickets issued",
      value: totals.ticketsIssued.toLocaleString("en-EG"),
      note: "voided tickets excluded",
    },
    {
      label: "Organizers",
      value: totals.organizers.toLocaleString("en-EG"),
      // This counts organizers who have published something, while the roster
      // below lists every account. The two figures differ legitimately, so the
      // denominator is stated rather than left to read as a bug.
      note: "with at least one event",
    },
  ];

  return (
    <div className="tiles">
      {tiles.map((tile) => (
        <div className="tile" key={tile.label}>
          <p className="tile-label">{tile.label}</p>
          <p className="tile-value num">{tile.value}</p>
          <p className="tile-note">{tile.note}</p>
        </div>
      ))}
    </div>
  );
}
