# Gate

An event ticketing platform. Organizers publish events; buyers purchase tickets
as guests with no account and receive QR tickets by email and in the browser.
Door scanning is outside the current scope.

The interesting part is not the CRUD. It is that **selling a limited thing to
concurrent strangers is a correctness problem**, and most of this repository is
about the four places it can go wrong: overselling under contention, holds that
never expire, a payment that lands after its reservation lapsed, and a webhook
delivered twice.

> **Repository name.** The directory is `court-booking-system` for historical
> reasons. The product is Gate.

---

## Stack

| Piece | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Database | Neon Postgres, `@neondatabase/serverless` |
| ORM | Drizzle |
| API | tRPC v11 + TanStack Query, superjson |
| Auth | Better Auth — organizers and admins only |
| Payments | Stripe Checkout, EGP |
| Validation | Zod v4 |
| Styling | Tailwind v4, CSS-first `@theme` (no config file) |
| Mail / QR | Nodemailer, `qrcode` |

Buyers never authenticate. An order is reached by a **signed magic link**
(`/orders/[id]/[token]`, HMAC over the order id), which is why no buyer account
exists anywhere in the schema.

---

## Running it

Requires Node 20.9+, a Neon database, and a Stripe test account. Email delivery
needs an SMTP server; poster and organizer-picture uploads use Vercel Blob.

```bash
npm install
cp .env.example .env          # replace placeholders using the table below
npm run db:push               # local setup; read "Migrations" below before deploying
npm run db:seed               # demo organizers, events, tiers, orders
npm run dev
```

The seed prints the demo accounts and password. Use `/sign-in` for organizers
and `/admin/sign-in` for admins. Re-seeding replaces events and their associated
orders and tickets for the seeded organizers; use a development database.

### Environment variables

`.env.example` contains placeholders. Replace them in `.env`:

| Variable | Value / purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `BETTER_AUTH_SECRET` | Random signing secret; also signs buyer ticket links. Rotating it invalidates existing ticket links. |
| `BETTER_AUTH_URL` | App origin, `http://localhost:3000` locally |
| `NEXT_PUBLIC_APP_URL` | App origin used for checkout redirects and ticket links; `http://localhost:3000` locally |
| `STRIPE_SECRET_KEY` | Test API key (`sk_test_…` or `rk_test_…`). Restricted keys need Checkout Sessions and Charges/Refunds write access, plus PaymentIntents and Events read access. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret printed by the local listener, or the deployed endpoint's secret from Stripe |
| `SMTP_HOST` / `SMTP_PORT` | SMTP server and port; port 465 uses implicit TLS |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials; leave both empty for an unauthenticated local relay |
| `MAIL_FROM` | Sender accepted by your SMTP provider, such as `Gate <tickets@example.com>` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for poster and organizer-picture uploads |

### Local payments

Install the Stripe CLI and authenticate with `stripe login`. Buying a ticket
locally needs its webhook tunnel running **in a second terminal**:

```bash
npm run stripe:listen         # prints a whsec_… → put it in STRIPE_WEBHOOK_SECRET
```

Restart the app after setting the secret. A deployed endpoint has its own signing
secret; the local listener's secret cannot be reused for it.

Test card `4242 4242 4242 4242`, any future expiry, any CVC.

### The single most common local failure

`stripe listen` is a foreground process that dies silently with its terminal,
and the only symptom is that **orders quietly never fulfil** — the buyer pays,
Stripe is happy, and no tickets exist. One command diagnoses it:

```bash
npm run stripe:check          # validates env, pings Stripe, lists paid-but-pending orders
npm run stripe:sweep          # fulfils anything found stuck
```

Production uses a configured HTTPS webhook endpoint instead of the local tunnel.
Delivery failures can still occur; keep the endpoint's signing secret configured
and use `stripe:check` to investigate stuck orders.

### Migrations

Tracked migrations now include the domain tables in
[`drizzle/0002_charming_bloodstrike.sql`](drizzle/0002_charming_bloodstrike.sql),
alongside the earlier auth migrations. `lib/db/schema.ts` defines the current
schema.

Existing databases originally created with `db:push` may have tables that their
`drizzle.__drizzle_migrations` journal does not record. Before deploying, compare
the target database's schema and journal with the committed migrations and
reconcile any mismatch. Running `db:migrate` blindly against a pushed database
can attempt to create objects that already exist.

For a fresh deployment database, use `npm run db:migrate`; validate the migration
chain on an empty scratch database first. The presence of migration files alone
does not verify either that chain or an existing database's applied history.

---

## Architecture

```
Browser
  │
  ├── RSC page ── prefetch(trpc.x.queryOptions()) ─┐
  │                                                ├── tRPC router ── Drizzle ── Neon
  └── Client Component ── useSuspenseQuery ────────┘        │
                                                            │
Stripe ── webhook (raw body, signature verified) ───────────┘
                                                    │
                                          fulfilOrder() — the §6.3 machine
                                                    │
                                    ┌───────────────┼───────────────┐
                                 tickets          email          order
                                (one row       (QR as cid:      marked
                                per seat)       attachment)      paid
```

### Data fetching

Every page that renders tRPC data uses **server prefetch + client
`useSuspenseQuery`**, so there is no loading spinner on first paint. The server
component calls `prefetch()` without awaiting it (multiple prefetches then run
in parallel) and wraps the tree in `<HydrateClient>`; the client component reads
the identical query key and finds it already in cache.

### Money

Integer piastres everywhere — `price_piastres`, `total_piastres`,
`unit_price_piastres`. Never a float, never a decimal in JS. EGP's minor unit is
1/100, the same as Stripe's, so the conversion is the identity function and
exists in exactly one place in case that ever stops being true.

### Availability is derived, never stored

There is no `remaining` column. A seat is free unless a `paid` order holds it or
a `pending` order's hold has not yet lapsed:

```sql
status = 'paid' OR (status = 'pending' AND hold_expires_at > now())
```

Read that way, an abandoned checkout releases its inventory **the instant its
timestamp passes**, with no sweeper involved. Displayed availability is only ever
a number on a screen: no read from it may decide whether a seat can be sold.

---

## The four hard problems

### 1. Never oversell

The purchase transaction takes `SELECT … FOR UPDATE` on the tier rows **sorted
by id**, recomputes availability inside the lock, and only then writes the hold.

Sorting prevents transactions from acquiring the same tier rows in opposite
orders: order A locking [X, Y] and order B locking [Y, X] could otherwise each
wait for the other's lock. This addresses that tier-lock cycle; it does not prove
that every transaction in the application is free of deadlocks.

### 2. Holds expire

A pending order holds inventory for 10 minutes. Availability already ignores
lapsed holds, so this is correct on read — but `npm run holds:sweep` marks the
rows `expired` so stored state agrees with how it is being counted.

### 3. The expiry/payment race

The interesting one. A buyer's hold lapses **while their payment is in flight**.
The money arrives for a reservation that no longer exists.

`lib/fulfilment.ts` recounts availability under the lock and branches:

- **Seats still free** → issue the tickets, mark paid. The lapse was harmless.
- **Seats gone** → refund automatically (idempotency key `refund:<orderId>`),
  mark the order `expired` with `refunded_at` set, and email an apology.

The refund is taken *inside* the transaction. The alternative — commit
`expired`, then refund — loses the refund entirely if the process dies between
them, leaving money taken with no record that it is owed.

`expired` + `refunded_at` rather than `refunded` is deliberate: reporting has to
tell "we took money we could not honour" apart from a genuine refund of a seat
that was really delivered.

### 4. Webhooks arrive more than once

Stripe retries. `webhook_events` has the Stripe event id as its primary key, so a
replay collides and is dropped before any ticket is issued. Fulfilment is
independently idempotent — an already-paid order returns `already-paid` and
issues nothing — so correctness never rests on the dedupe table alone.

**Tickets are never issued on the redirect back from Stripe.** The redirect can
be lost, blocked, or forged; the webhook is the source of truth, and the return
page only polls order status.

### Tickets reach the buyer three ways

Because any one path can fail: a modal on the event page, the email (QR codes
attached as `cid:` inline images — Gmail strips `data:` URIs in `<img src>`),
and the permanent magic link. QR images are always rendered server-side; a raw
ticket `secret` never crosses to the browser.

---

## Verifying it

```bash
npm run reconcile
```

Seven whole-database invariants (`scripts/reconcile.ts`). Exits zero only if all
hold:

- every paid order has exactly as many live tickets as its items' quantities
- no ticket belongs to an unpaid order
- **no ticket type has more live tickets than its quantity** — the oversell check
- every paid order's total equals the sum of its line items
- refunded orders have no live tickets
- auto-refunded (§6.3) orders issued nothing
- every ticket secret is unique

These checks detect violations in the current database state. A passing run
does not prove correctness under every possible race; run them after concurrency
tests to check the resulting data.

### Load tests

`load/` holds three k6 scenarios — browse (200 VUs), flash sale (500 VUs at one
tier), and a 10-minute mixed run. See [load/README.md](load/README.md) for how
to run them and why they spoof `X-Forwarded-For`.

**k6 checks responses; reconcile checks rows.** A server that issued 60 tickets
for 50 seats looks perfect to k6. Always run both.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | ESLint |
| `npm run reconcile` | the seven invariants above |
| `npm run holds:sweep` | mark lapsed holds `expired`; availability already excludes them |
| `npm run stripe:listen` | local webhook tunnel |
| `npm run stripe:check` | preflight — env, connectivity, stuck orders (read-only) |
| `npm run stripe:sweep` | fulfil orders paid at Stripe but not here |
| `npm run db:push` / `db:generate` / `db:migrate` / `db:studio` | Drizzle schema sync, migration generation/application, and database browser |
| `npm run db:seed` | demo data |
| `ALLOW_DB_RESET=1 npm run db:reset` | wipe to a single admin — destructive |

---

## Deliberately out of scope

Cut to keep the project focused on the concurrency and payment problems:

- **Organizer-initiated refunds** and the **door scanner**. Note the *automatic*
  §6.3 refund above is built and load-bearing — it is a different mechanism.
- **A buyer-facing ticket lookup page.** Buyers use the three paths above.
- Seat maps, waitlists, multi-currency, discount codes.

## Known gaps

- **Migration history needs verification before deployment.** Domain migrations
  are committed, but existing databases created through `db:push` need their
  applied history checked; see [Migrations](#migrations).
- **No job runner or scheduled hold sweeper.** Email is attempted inline and
  recorded in `jobs`, but no worker retries failed attempts. `holds:sweep` is a
  manual command with no scheduler. Lapsed holds stop consuming inventory on
  time because availability is derived, even before the script runs.
- **The concurrency guarantees are argued, not yet measured.** The locking is
  written and reasoned through, the k6 suite and reconcile command exist — but
  the flash sale has not been run at scale, so no oversell number here is backed
  by a run. `docs/load-test-report.md` is not yet written.
- No automated test suite or CI yet.
