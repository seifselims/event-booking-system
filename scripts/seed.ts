/**
 * Development seed for Gate.
 *
 * Run with:  npm run db:seed
 *
 * WHY IT LOOKS LIKE THIS
 *
 * 1. Users are created through Better Auth, not Drizzle. `account.password`
 *    holds a Better Auth scrypt hash; a row inserted directly with a plaintext
 *    or bcrypt value produces a user who exists but can never sign in. So every
 *    user here goes through `auth.api.signUpEmail`.
 *
 * 2. `role` is declared `input: false` in `lib/auth.ts`, which means Better Auth
 *    deliberately ignores it on signup — that flag exists so nobody can register
 *    themselves an admin over HTTP. The admin is therefore created as an
 *    ordinary signup and then promoted with an explicit UPDATE.
 *
 * 3. Orders are real inventory, not decoration. Availability is derived (spec
 *    §5.3): a `paid` order, or a `pending` one whose hold has not expired,
 *    consumes tickets. The orders below are chosen to exercise every branch of
 *    that query — paid, live hold, expired hold, refunded — so the public site
 *    and the dashboard have something non-trivial to render, and so a sold-out
 *    event is genuinely sold out rather than merely labelled that way.
 *
 * 4. Money is integer piastres everywhere (250.00 EGP === 25000).
 *
 * Re-running is safe: seeded domain rows are deleted first, and users are
 * reused if they already exist.
 */
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';

import { auth } from '../lib/auth';
import type { EventCategory } from '../lib/categories';
import { db } from '../lib/db';
import {
  events,
  orderItems,
  orders,
  ticketTypes,
  tickets,
  user,
} from '../lib/db/schema';

/** Shared password for every seeded account. Development only. */
const PASSWORD = 'password12345';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const now = Date.now();

/** Cairo is UTC+3 (no DST since 2015 was reinstated in 2023 — see lib/format.ts). */
function cairo(daysFromNow: number, cairoHour: number) {
  const d = new Date(now + daysFromNow * DAY);
  d.setUTCHours(cairoHour - 3, 0, 0, 0);
  return d;
}

/**
 * Create a user via Better Auth, or return the existing one. Better Auth owns
 * the password hash, so this is the only correct way to make a signin-capable
 * account.
 */
async function upsertUser(input: {
  name: string;
  email: string;
  role: 'organizer' | 'admin';
}) {
  const existing = await db.query.user.findFirst({
    where: eq(user.email, input.email),
  });

  let id: string;

  if (existing) {
    id = existing.id;
  } else {
    const created = await auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: PASSWORD },
    });
    id = created.user.id;
  }

  // `role` is `input: false`, so signup always yields `organizer`. Promote here.
  if (input.role === 'admin') {
    await db.update(user).set({ role: 'admin' }).where(eq(user.id, id));
  }

  return { ...input, id };
}

type TicketTypeSpec = {
  key: string;
  name: string;
  pricePiastres: number;
  quantity: number;
  maxPerOrder: number;
};

type OrderSpec = {
  buyerName: string;
  buyerEmail: string;
  /** `paid` issues ticket rows; `pending` holds; `expired`/`refunded` free inventory. */
  status: 'pending' | 'paid' | 'expired' | 'refunded';
  /** Minutes until the hold lapses. Negative means it already has. */
  holdInMinutes: number;
  items: { typeKey: string; quantity: number }[];
  /** Mark this many of the order's issued tickets as already scanned in. */
  checkedIn?: number;
};

type EventSpec = {
  slug: string;
  title: string;
  description: string;
  venue: string;
  startsAt: Date;
  endsAt: Date | null;
  status: 'draft' | 'active' | 'cancelled' | 'archived' | 'sold_out';
  category: EventCategory;
  organizer: string;
  ticketTypes: TicketTypeSpec[];
  orders: OrderSpec[];
};

const ORGANIZERS = {
  omar: {
    name: 'Omar Fahmy',
    email: 'omar@gate.test',
    role: 'organizer' as const,
  },
  nadia: {
    name: 'Nadia Shawki',
    email: 'nadia@gate.test',
    role: 'organizer' as const,
  },
  youssef: {
    name: 'Youssef Adel',
    email: 'youssef@gate.test',
    role: 'organizer' as const,
  },
};

const ADMIN = {
  name: 'Gate Admin',
  email: 'admin@gate.test',
  role: 'admin' as const,
};

const EVENT_SPECS: EventSpec[] = [
  {
    slug: 'nile-delta-nights',
    category: 'music',
    title: 'Nile Delta Nights',
    description:
      'Six hours across two stages on the edge of the desert. An orchestral takeover of the main room at sundown, then the basement opens until dawn.',
    venue: 'Al Manara · New Cairo',
    startsAt: cairo(18, 20),
    endsAt: cairo(19, 4),
    status: 'active',
    organizer: 'omar',
    ticketTypes: [
      { key: 'ga', name: 'General Admission', pricePiastres: 45_000, quantity: 400, maxPerOrder: 6 },
      { key: 'pit', name: 'Front Pit', pricePiastres: 95_000, quantity: 200, maxPerOrder: 4 },
      { key: 'table', name: 'Table for Four', pricePiastres: 480_000, quantity: 30, maxPerOrder: 1 },
    ],
    orders: [
      // Healthy sales across tiers, with a couple already scanned in.
      { buyerName: 'Mariam Hassan', buyerEmail: 'mariam@example.com', status: 'paid', holdInMinutes: -2 * 24 * 60, items: [{ typeKey: 'ga', quantity: 4 }], checkedIn: 2 },
      { buyerName: 'Karim Zaki', buyerEmail: 'karim@example.com', status: 'paid', holdInMinutes: -30 * 60, items: [{ typeKey: 'pit', quantity: 2 }, { typeKey: 'ga', quantity: 1 }] },
      { buyerName: 'Laila Mounir', buyerEmail: 'laila@example.com', status: 'paid', holdInMinutes: -6 * 60, items: [{ typeKey: 'table', quantity: 1 }] },
      // A live hold: counts against availability right now, frees itself in 6 min.
      { buyerName: 'Tarek Sami', buyerEmail: 'tarek@example.com', status: 'pending', holdInMinutes: 6, items: [{ typeKey: 'pit', quantity: 3 }] },
      // An abandoned checkout: still `pending` but lapsed, so §5.3 ignores it.
      { buyerName: 'Hana Reda', buyerEmail: 'hana@example.com', status: 'pending', holdInMinutes: -12, items: [{ typeKey: 'ga', quantity: 2 }] },
      // Refunded: inventory returned automatically (spec §7.2).
      { buyerName: 'Sherif Nabil', buyerEmail: 'sherif@example.com', status: 'refunded', holdInMinutes: -3 * 24 * 60, items: [{ typeKey: 'ga', quantity: 2 }] },
    ],
  },
  {
    slug: 'cairo-design-summit',
    category: 'conference',
    title: 'Cairo Design Summit',
    description:
      'Two days of talks and workshops on product design, typography, and the craft of shipping.',
    venue: 'Greek Campus · Downtown',
    startsAt: cairo(23, 9),
    endsAt: cairo(24, 18),
    status: 'active',
    organizer: 'nadia',
    ticketTypes: [
      { key: 'standard', name: 'Standard', pricePiastres: 120_000, quantity: 300, maxPerOrder: 5 },
      { key: 'student', name: 'Student', pricePiastres: 60_000, quantity: 120, maxPerOrder: 2 },
    ],
    orders: [
      { buyerName: 'Dina Farouk', buyerEmail: 'dina@example.com', status: 'paid', holdInMinutes: -5 * 24 * 60, items: [{ typeKey: 'standard', quantity: 2 }] },
      { buyerName: 'Amr Selim', buyerEmail: 'amr@example.com', status: 'paid', holdInMinutes: -4 * 24 * 60, items: [{ typeKey: 'student', quantity: 2 }] },
      { buyerName: 'Nour Adly', buyerEmail: 'nour@example.com', status: 'expired', holdInMinutes: -2 * 24 * 60, items: [{ typeKey: 'standard', quantity: 1 }] },
    ],
  },
  {
    slug: 'tarab-reimagined',
    category: 'music',
    title: 'Tarab Reimagined',
    description:
      'A forty-piece orchestra rereads the standards, with arrangements written for this room.',
    venue: 'Cairo Opera House',
    startsAt: cairo(24, 21),
    endsAt: null,
    // Genuinely sold out: the orders below consume every seat in both tiers, so
    // this status survives the next `syncSoldOut` rather than being overwritten.
    status: 'sold_out',
    organizer: 'nadia',
    ticketTypes: [
      { key: 'stalls', name: 'Stalls', pricePiastres: 80_000, quantity: 120, maxPerOrder: 4 },
      { key: 'balcony', name: 'Balcony', pricePiastres: 55_000, quantity: 80, maxPerOrder: 4 },
    ],
    orders: [
      { buyerName: 'Opera Subscribers', buyerEmail: 'subs@example.com', status: 'paid', holdInMinutes: -10 * 24 * 60, items: [{ typeKey: 'stalls', quantity: 120 }], checkedIn: 0 },
      { buyerName: 'Balcony Block', buyerEmail: 'balcony@example.com', status: 'paid', holdInMinutes: -9 * 24 * 60, items: [{ typeKey: 'balcony', quantity: 80 }] },
    ],
  },
  {
    slug: 'standup-at-the-vault',
    category: 'comedy',
    title: 'Standup at the Vault',
    description: 'Five comics, one basement, no phones. Strictly 18+.',
    venue: 'The Vault · Zamalek',
    startsAt: cairo(25, 22),
    endsAt: null,
    status: 'active',
    organizer: 'youssef',
    ticketTypes: [
      { key: 'door', name: 'Door', pricePiastres: 30_000, quantity: 90, maxPerOrder: 4 },
    ],
    orders: [
      // Nearly gone: 86 of 90 taken, so the last few seats are a realistic
      // target for testing the §6.1 locked purchase path.
      { buyerName: 'Group Booking', buyerEmail: 'group@example.com', status: 'paid', holdInMinutes: -24 * 60, items: [{ typeKey: 'door', quantity: 84 }] },
      { buyerName: 'Rana Ehab', buyerEmail: 'rana@example.com', status: 'pending', holdInMinutes: 8, items: [{ typeKey: 'door', quantity: 2 }] },
    ],
  },
  {
    slug: 'sahel-closing-set',
    category: 'nightlife',
    title: 'Sahel Closing Set',
    description:
      'The last night of the season on the North Coast. Doors at eleven, sunrise finish.',
    venue: 'Marassi Beach · North Coast',
    startsAt: cairo(32, 23),
    endsAt: cairo(33, 6),
    status: 'active',
    organizer: 'omar',
    ticketTypes: [
      { key: 'ga', name: 'General Admission', pricePiastres: 175_000, quantity: 1200, maxPerOrder: 6 },
      { key: 'cabana', name: 'Cabana', pricePiastres: 900_000, quantity: 40, maxPerOrder: 1 },
    ],
    orders: [
      { buyerName: 'Farida Wahba', buyerEmail: 'farida@example.com', status: 'paid', holdInMinutes: -7 * 24 * 60, items: [{ typeKey: 'ga', quantity: 6 }] },
      { buyerName: 'Ziad Kamal', buyerEmail: 'ziad@example.com', status: 'paid', holdInMinutes: -2 * 24 * 60, items: [{ typeKey: 'cabana', quantity: 1 }] },
    ],
  },
  {
    slug: 'kickoff-derby',
    category: 'sport',
    title: 'Kickoff Derby',
    description: 'The season opener. Gates open two hours before kickoff.',
    venue: 'Cairo International Stadium',
    startsAt: cairo(33, 19),
    endsAt: null,
    status: 'active',
    organizer: 'youssef',
    ticketTypes: [
      { key: 'terrace', name: 'Terrace', pricePiastres: 25_000, quantity: 3200, maxPerOrder: 6 },
      { key: 'stand', name: 'Main Stand', pricePiastres: 70_000, quantity: 800, maxPerOrder: 4 },
    ],
    orders: [
      { buyerName: 'Ultras Block', buyerEmail: 'ultras@example.com', status: 'paid', holdInMinutes: -12 * 24 * 60, items: [{ typeKey: 'terrace', quantity: 40 }], checkedIn: 5 },
      { buyerName: 'Hossam Gad', buyerEmail: 'hossam@example.com', status: 'paid', holdInMinutes: -60, items: [{ typeKey: 'stand', quantity: 3 }] },
    ],
  },
  {
    // Unpublished: must never appear in `listEvents`, but must show in the
    // organizer's own dashboard via `getMyEvents`.
    slug: 'winter-jazz-sessions',
    category: 'music',
    title: 'Winter Jazz Sessions',
    description: 'Still being planned. Lineup to be announced.',
    venue: 'Room 9 · Garden City',
    startsAt: cairo(70, 20),
    endsAt: null,
    status: 'draft',
    organizer: 'omar',
    ticketTypes: [
      { key: 'early', name: 'Early Bird', pricePiastres: 40_000, quantity: 150, maxPerOrder: 4 },
    ],
    orders: [],
  },
  {
    // Cancelled: also hidden from the public listing.
    slug: 'desert-marathon-2026',
    category: 'sport',
    title: 'Desert Marathon 2026',
    description: 'Cancelled by the organizer. Kept for reporting and refunds.',
    venue: 'Fayoum',
    startsAt: cairo(45, 6),
    endsAt: null,
    status: 'cancelled',
    organizer: 'youssef',
    ticketTypes: [
      { key: 'entry', name: 'Race Entry', pricePiastres: 150_000, quantity: 500, maxPerOrder: 2 },
    ],
    orders: [
      { buyerName: 'Refunded Runner', buyerEmail: 'runner@example.com', status: 'refunded', holdInMinutes: -20 * 24 * 60, items: [{ typeKey: 'entry', quantity: 1 }] },
    ],
  },
];

async function main() {
  console.log('Seeding Gate…\n');

  // --- Users ------------------------------------------------------------
  const admin = await upsertUser(ADMIN);
  console.log(`admin      ${admin.email}`);

  const organizerIds: Record<string, string> = {};
  for (const [key, spec] of Object.entries(ORGANIZERS)) {
    const created = await upsertUser(spec);
    organizerIds[key] = created.id;
    console.log(`organizer  ${created.email}`);
  }

  // --- Reset domain rows ------------------------------------------------
  // Only events owned by the seeded organizers are removed, so any events you
  // created by hand under another account survive a re-seed. `tickets`,
  // `order_items`, `orders`, and `ticket_types` all cascade from `events`.
  const owned = await db
    .select({ id: events.id })
    .from(events)
    .where(inArray(events.organizerId, Object.values(organizerIds)));

  if (owned.length > 0) {
    await db.delete(events).where(
      inArray(
        events.id,
        owned.map((e) => e.id),
      ),
    );
    console.log(`\ncleared    ${owned.length} previously seeded event(s)`);
  }

  // --- Events, ticket types, orders, tickets ----------------------------
  console.log('');
  let ticketCount = 0;

  for (const spec of EVENT_SPECS) {
    const eventId = randomUUID();

    await db.insert(events).values({
      id: eventId,
      organizerId: organizerIds[spec.organizer],
      slug: spec.slug,
      title: spec.title,
      description: spec.description,
      venue: spec.venue,
      category: spec.category,
      startsAt: spec.startsAt,
      endsAt: spec.endsAt,
      status: spec.status,
    });

    // Ticket-type ids, keyed by the spec's short key so orders can reference them.
    const typeIds: Record<string, string> = {};
    const typePrices: Record<string, number> = {};

    for (const tt of spec.ticketTypes) {
      const id = randomUUID();
      typeIds[tt.key] = id;
      typePrices[tt.key] = tt.pricePiastres;

      await db.insert(ticketTypes).values({
        id,
        eventId,
        name: tt.name,
        pricePiastres: tt.pricePiastres,
        quantity: tt.quantity,
        maxPerOrder: tt.maxPerOrder,
      });
    }

    for (const order of spec.orders) {
      const orderId = randomUUID();
      const holdExpiresAt = new Date(now + order.holdInMinutes * MINUTE);

      // The total is derived from the tier prices, never typed by hand — a
      // mismatch here would make `make reconcile` (spec §9) fail for real.
      const totalPiastres = order.items.reduce(
        (sum, item) => sum + typePrices[item.typeKey] * item.quantity,
        0,
      );

      const paidAt =
        order.status === 'paid' || order.status === 'refunded'
          ? holdExpiresAt
          : null;

      await db.insert(orders).values({
        id: orderId,
        eventId,
        buyerEmail: order.buyerEmail,
        buyerName: order.buyerName,
        status: order.status,
        totalPiastres,
        holdExpiresAt,
        paidAt,
        refundedAt:
          order.status === 'refunded' ? new Date(now - 12 * HOUR) : null,
        // Left NULL: these orders never went through Stripe. The unique index
        // on `stripe_session_id` permits many NULLs.
        stripeSessionId: null,
      });

      for (const item of order.items) {
        await db.insert(orderItems).values({
          id: randomUUID(),
          orderId,
          ticketTypeId: typeIds[item.typeKey],
          quantity: item.quantity,
          unitPricePiastres: typePrices[item.typeKey],
        });
      }

      // One row per ticket, never a quantity column. Tickets exist only once
      // payment has landed — a pending hold has reserved inventory but has not
      // been issued anything yet.
      if (order.status === 'paid' || order.status === 'refunded') {
        let issued = 0;
        const toCheckIn = order.checkedIn ?? 0;

        for (const item of order.items) {
          for (let i = 0; i < item.quantity; i++) {
            const checkedIn = issued < toCheckIn;

            await db.insert(tickets).values({
              id: randomUUID(),
              orderId,
              ticketTypeId: typeIds[item.typeKey],
              // Stand-in for the signed QR payload of spec §6.6. Unique, and
              // opaque enough that nothing downstream can guess the format.
              secret: randomUUID().replace(/-/g, ''),
              checkedInAt: checkedIn ? new Date(now - 2 * HOUR) : null,
              checkedInBy: checkedIn ? admin.id : null,
              // A refund voids the tickets it issued (spec §7.2).
              voidedAt:
                order.status === 'refunded' ? new Date(now - 12 * HOUR) : null,
            });

            issued++;
            ticketCount++;
          }
        }
      }
    }

    const orderCount = spec.orders.length;
    console.log(
      `event      ${spec.slug.padEnd(24)} ${spec.status.padEnd(9)} ` +
        `${spec.ticketTypes.length} tier(s), ${orderCount} order(s)`,
    );
  }

  console.log(`\nIssued ${ticketCount} ticket rows.`);
  console.log(`\nSign in with any of these — password: ${PASSWORD}`);
  console.log(`  ${ADMIN.email} (admin)`);
  for (const spec of Object.values(ORGANIZERS)) console.log(`  ${spec.email}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nSeed failed:\n', error);
    process.exit(1);
  });
