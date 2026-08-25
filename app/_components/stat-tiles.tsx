"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { formatEGP } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";

/**
 * The four headline numbers. Each tile carries a quiet second line giving the
 * figure context, so no number sits on the screen without its denominator.
 *
 * Reads the totals prefetched by `app/dashboard/page.tsx` — `useSuspenseQuery`
 * resolves from the hydrated cache on first paint, so there is no loading state
 * here by design (docs/prefetching/).
 */
export function StatTiles() {
  const trpc = useTRPC();
  const { data: totals } = useSuspenseQuery(
    trpc.events.getMyTotals.queryOptions(),
  );

  const doorRate =
    totals.ticketsIssued > 0
      ? Math.round((totals.ticketsCheckedIn / totals.ticketsIssued) * 100)
      : 0;

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
      label: "Checked in",
      value: totals.ticketsCheckedIn.toLocaleString("en-EG"),
      note: `${doorRate}% through the door`,
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
