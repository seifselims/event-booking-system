/**
 * Wipe Gate back to a single admin.
 *
 * Run with:  ALLOW_DB_RESET=1 npm run db:reset
 *
 * WHY THIS EXISTS
 *
 * Neither of the two obvious routes can do this:
 *
 * - `npm run db:seed` only clears events belonging to the three organizers it
 *   knows about, then re-inserts the whole fixture set. It adds data; it cannot
 *   leave you with none.
 * - `admin.deleteOrganizer` refuses any organizer holding a paid order
 *   (lib/trpc/routers/admin.ts), which every seeded organizer does. That refusal
 *   is correct for the product — it protects financial records reconciliation
 *   depends on — but it makes the tRPC route useless for a deliberate wipe.
 *
 * So the clean slate is a script, and it is deliberately destructive: it removes
 * paid orders and issued tickets, which the application layer will not do.
 *
 * WHAT SURVIVES
 *
 * Exactly one `user` row, role `admin`. Everything else — organizers, events,
 * ticket types, orders, tickets — is gone.
 */
import { eq, ne } from 'drizzle-orm';

import { auth } from '../lib/auth';
import { deleteOwnBlob } from '../lib/blob';
import { db } from '../lib/db';
import {
  events,
  orderItems,
  orders,
  ticketTypes,
  tickets,
  user,
} from '../lib/db/schema';

/** The account left standing. Matches docs/SEED-CREDENTIALS.md. */
const ADMIN = {
  name: 'Gate Admin',
  email: 'admin@gate.test',
  password: 'password12345',
};

/**
 * This drops paid orders and issued tickets, and there is no undo. An
 * accidental `npm run db:reset` against a database holding real sales would be
 * unrecoverable, so the destructive path is opt-in per invocation rather than
 * something a stray shell-history entry can trigger.
 */
function assertAllowed() {
  if (process.env.ALLOW_DB_RESET === '1' || process.argv.includes('--yes')) {
    return;
  }

  console.error(
    'Refusing to reset.\n\n' +
      'This deletes every event, order, ticket, and organizer — including paid\n' +
      'orders — and cannot be undone. If that is what you want:\n\n' +
      '  ALLOW_DB_RESET=1 npm run db:reset\n',
  );
  process.exit(1);
}

async function main() {
  assertAllowed();

  // Read the posters BEFORE the rows go. Blobs are only ever released through
  // `updateEvent`/`deleteEvent` (lib/trpc/routers/events.ts) — nothing sweeps
  // the store on its own, so deleting rows in bulk would orphan every uploaded
  // file with no way left to find its URL.
  const posters = await db
    .select({ posterUrl: events.posterUrl })
    .from(events);

  // Deleting `events` alone would cascade to all four of these. They are listed
  // explicitly, child-first, so the intent is legible at the call site and the
  // wipe does not silently depend on the FK cascade config staying as it is.
  await db.delete(tickets);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(ticketTypes);
  const removedEvents = await db.delete(events).returning({ id: events.id });

  // Cascades to each organizer's `session` and `account` rows. Their events are
  // already gone above, so nothing is left dangling.
  const removedUsers = await db
    .delete(user)
    .where(ne(user.role, 'admin'))
    .returning({ email: user.email });

  // Now that no row references them, release the uploaded posters. Pasted URLs
  // on foreign hosts are skipped by `deleteOwnBlob`, and a failure there only
  // logs — a leaked file is cheaper than a half-finished reset.
  let releasedPosters = 0;
  for (const { posterUrl } of posters) {
    if (!posterUrl) continue;
    await deleteOwnBlob(posterUrl);
    releasedPosters += 1;
  }

  // The admin goes through Better Auth for the usual reason: `account.password`
  // holds a scrypt hash, and a hand-written `user` row looks complete but can
  // never sign in. `role` is `input: false`, so signup always yields
  // `organizer` — promote with an explicit UPDATE afterwards.
  const existing = await db.query.user.findFirst({
    where: eq(user.email, ADMIN.email),
  });

  let adminId: string;

  if (existing) {
    adminId = existing.id;
  } else {
    const created = await auth.api.signUpEmail({
      body: {
        name: ADMIN.name,
        email: ADMIN.email,
        password: ADMIN.password,
      },
    });
    adminId = created.user.id;
  }

  await db.update(user).set({ role: 'admin' }).where(eq(user.id, adminId));

  console.log('Reset complete.\n');
  console.log(`  events removed      ${removedEvents.length}`);
  console.log(`  users removed       ${removedUsers.length}`);
  console.log(`  posters released    ${releasedPosters}`);
  console.log(`\n  admin               ${ADMIN.email} / ${ADMIN.password}`);
  console.log('\nSign in at /admin/sign-in.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
