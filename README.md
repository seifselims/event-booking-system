# Gate

An event ticketing platform. Organizers publish events; buyers purchase tickets
as guests with no account; a QR code arrives by email and is scanned at the door.

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

Requires Node 20+, a Neon database, and a Stripe test account.

```bash
npm install
cp .env.example .env          # then fill it in — every variable is documented there
npm run db:push               # see "Migrations" below before deploying
npm run db:seed               # demo organizers, events, tiers, orders
npm run dev
```

Buying a ticket locally needs the Stripe webhook tunnel running **in a second
terminal**:

```bash
npm run stripe:listen         # prints a whsec_… → put it in STRIPE_WEBHOOK_SECRET
```

Test card `4242 4242 4242 4242`, any future expiry, any CVC.

### The single most common local failure

`stripe listen` is a foreground process that dies silently with its terminal,
and the only symptom is that **orders quietly never fulfil** — the buyer pays,
Stripe is happy, and no tickets exist. One command diagnoses it:

```bash
npm run stripe:check          # validates env, pings Stripe, lists paid-but-pending orders
npm run stripe:sweep          # fulfils anything found stuck
```

None of this exists in production, where Stripe posts to a real URL and retries
for three days.

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

Sorting is what makes deadlock structurally impossible: order A wanting tiers
[X, Y] and order B wanting [Y, X] will otherwise hold one and wait on the other
forever. Every transaction acquiring locks in the same sequence cannot deadlock.

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

This is the difference between "it worked when I clicked it" and "it is correct".

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
| `npm run reconcile` | the seven invariants above |
| `npm run holds:sweep` | mark lapsed holds `expired`, return seats |
| `npm run stripe:listen` | local webhook tunnel |
| `npm run stripe:check` | preflight — env, connectivity, stuck orders (read-only) |
| `npm run stripe:sweep` | fulfil orders paid at Stripe but not here |
| `npm run db:push` / `generate` / `migrate` / `studio` | Drizzle |
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

- **Migrations are out of sync with the schema.** The domain tables were applied
  with `db:push`, so `drizzle/` covers only the auth tables and `db:migrate`
  against a fresh database will not reproduce the schema. Treat `lib/db/schema.ts`
  as the source of truth; this must be reconciled before a real deploy.
- **The concurrency guarantees are argued, not yet measured.** The locking is
  written and reasoned through, the k6 suite and reconcile command exist — but
  the flash sale has not been run at scale, so no oversell number here is backed
  by a run. `docs/load-test-report.md` is not yet written.
- No automated test suite or CI yet.
