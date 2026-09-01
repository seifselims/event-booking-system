import { randomBytes, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { orderItems, tickets } from '@/lib/db/schema';
import type { Conn } from '@/lib/trpc/routers/tickets';

/**
 * How many random bytes back each ticket's secret (spec §6.6).
 *
 * 32 bytes is 256 bits. `randomUUID` would be tempting and is wrong here: 122
 * bits of entropy in a recognisable dashed shape, where this value is the only
 * thing between a photographed QR code and a free entry.
 */
const SECRET_BYTES = 32;

/**
 * Write one row per ticket for a paid order.
 *
 * **One row per ticket, not a quantity column** (AGENTS.md): a ticket is
 * individually scannable and individually voidable, so three General tickets are
 * one `order_item` with quantity 3 and three `tickets` rows.
 *
 * **Must be called inside the fulfilment transaction**, so the tickets and the
 * order's `status = 'paid'` become true together. A paid order with no tickets,
 * or tickets against an unpaid order, are both states nobody should ever have to
 * reconcile by hand.
 *
 * `tickets_secret_uidx` is the backstop: a secret collision — astronomically
 * improbable — aborts the transaction rather than silently issuing two tickets
 * that scan as one.
 */
export async function issueTickets(conn: Conn, orderId: string) {
  const items = await conn
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const rows = items.flatMap((item) =>
    Array.from({ length: item.quantity }, () => ({
      id: randomUUID(),
      orderId,
      ticketTypeId: item.ticketTypeId,
      secret: randomBytes(SECRET_BYTES).toString('base64url'),
    })),
  );

  if (rows.length === 0) return [];

  return conn.insert(tickets).values(rows).returning();
}
