/**
 * Purchase rules shared by the buyer's UI and the procedure that enforces them.
 *
 * This module imports nothing, so the ticket selector (a Client Component) and
 * `routers/orders.ts` (which pulls in `db`) can both read it. The selector uses
 * these to keep the stepper honest; the server treats them as the rule. Keep the
 * enforcement in the procedure — a clamp in the UI is a convenience, never the
 * permission.
 */

/**
 * The most tickets one buyer may hold for a single event, across every tier and
 * across every order they have placed for it.
 *
 * A platform ceiling, not an organizer setting: it wins even where a tier's
 * `max_per_order` is higher, so that column can only ever lower the cap further.
 * Enforced on the *sum* — four of one tier and four of another is eight tickets
 * and is refused, which a per-tier check alone would let through.
 *
 * "One buyer" means one email address. Buyers are guests with no account (spec
 * §2), so an email is the only identifier a purchase carries. That makes this a
 * deterrent against casual over-buying, **not** a defence against a determined
 * scalper — a second address resets the allowance. Anything stronger needs
 * either buyer accounts or payment-instrument checks, both out of scope.
 */
export const MAX_TICKETS_PER_EVENT = 4;
