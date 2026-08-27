import type { Metadata } from "next";
import Link from "next/link";

import { EventCreateForm } from "../../../_components/event-create-form";

export const metadata: Metadata = {
  title: "New event — Gate",
  robots: { index: false, follow: false },
};

/**
 * Create an event (spec §8).
 *
 * No prefetch and no `HydrateClient`: this page reads nothing. The prefetch
 * pattern is for queries, and there is no query here — only a mutation, which
 * `EventCreateForm` owns.
 *
 * The `/dashboard` layout runs `requireUser()`; the real permission is
 * `createEvent`'s `protectedProcedure`, which stamps `organizerId` from the
 * session rather than trusting anything the form sends.
 */
export default function NewEventPage() {
  return (
    <div className="shell console-shell">
      <div className="console-head">
        <div>
          <Link className="ed-back" href="/dashboard">
            ← All events
          </Link>

          <p className="gate-eyebrow">New event</p>

          <h1 className="console-title">Put something on.</h1>
        </div>
      </div>

      <EventCreateForm />
    </div>
  );
}
