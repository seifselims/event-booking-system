# Load tests (spec §9)

Three k6 scenarios. The flash sale is the one that matters — it is the
experiment behind the resume line's "zero oversells".

## Install k6

```bash
brew install k6          # macOS
# or see https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## Prepare a target

The purchase scenarios need a real event with a known, small tier. Seed, then
read an event and tier id out of the database:

```bash
npm run db:seed
npm run db:studio        # or psql — grab an event id + ticket_type id + slug
```

Run the app in **production** mode. `next dev` recompiles per route and its
numbers mean nothing:

```bash
npm run build && npm run start
```

## Run

```bash
# 1. Browse — 200 VUs over event pages
k6 run load/browse.js --env BASE=http://localhost:3000 --env SLUG=<event-slug>

# 2. Flash sale — 500 VUs at one tier in a 10s window
k6 run load/flash-sale.js \
  --env BASE=http://localhost:3000 \
  --env EVENT_ID=<event-id> \
  --env TIER_ID=<ticket-type-id>

# 3. Mixed — 70/30 browse/purchase, 10 minutes
k6 run load/mixed.js --env BASE=http://localhost:3000 \
  --env SLUG=<slug> --env EVENT_ID=<id> --env TIER_ID=<tier>
```

## The rate limiter, and why these tests spoof an IP

`createOrder` is `rateLimitedProcedure('createOrder', 10, 60_000)` — ten per
minute, keyed on `ctx.ip`, which comes from `x-forwarded-for`
(`lib/trpc/init.ts`). Run 500 VUs from one machine without doing anything about
that and you measure the rate limiter: ~10 orders through, ~490 refused, and the
row lock never contends at all.

So each VU sends its own `X-Forwarded-For`. That is legitimate here — the header
is documented in `init.ts` as "a key, not an identity", and the limit that
actually protects inventory is `livePendingHolds`, a database check these tests
deliberately leave in force.

**Two other durable limits still apply and shape what the test can prove:**

- `MAX_CONCURRENT_HOLDS = 3` per email, platform-wide.
- `MAX_TICKETS_PER_EVENT = 4` per email per event.

Both are keyed on the buyer's email, so every VU generates a unique address.
A test reusing one address measures the allowance check, not the lock.

## After every run

```bash
npm run reconcile
```

The scenario's own thresholds check *responses*; reconcile checks the
*database*. An oversell that k6 counts as a successful purchase still shows up
there as `issued > quantity`. A green k6 run with a red reconcile is the exact
failure this project exists to catch — always run both.

Then write up `docs/load-test-report.md`: the p95/p99 table, the hardware you
ran on, the breaking point, and the one bottleneck you found and fixed.
Numbers only from a run you actually did.
