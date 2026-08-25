import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Suspense } from "react";

import { SignInForm } from "../_components/sign-in-form";

import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Organizer sign-in — Gate",
  description: "Sign in to publish events, watch sales, and scan at the door.",
};

/**
 * Side B — the organizer door (spec §3, §8).
 *
 * The landing is a tangerine field holding sleeves; this is its flip side: the
 * brown ground that until now only showed up as the vinyl, holding one turquoise
 * stub. Everything but the form itself is a Server Component, and the only
 * interaction outside the form is CSS.
 */
export default async function SignInPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/dashboard");
  }

  return (
    <section
      className="side gate-door"
      style={
        {
          "--ground": "var(--color-brown)",
          "--ink": "var(--color-beige)",
        } as React.CSSProperties
      }
    >
      <div className="side-mark" aria-hidden="true">
        <b>Side B</b> &middot; The door
      </div>

      <div className="shell gate-door-in">
        <div className="gate-copy">
          <Link className="logo gate-logo" href="/">
            GATE
            <i aria-hidden="true" />
          </Link>

          <h1 className="gate-title">
            Doors open
            <br />
            <em>from here.</em>
          </h1>

          <p className="gate-lead">
            Sign in to publish events, watch the sales come in, and scan the
            queue at the door.
          </p>

          <ul className="gate-list">
            <li>
              <b>01</b> <span>Put an event on the rack</span>
            </li>
            <li>
              <b>02</b> <span>Watch every tier sell</span>
            </li>
            <li>
              <b>03</b> <span>Scan the queue in</span>
            </li>
          </ul>

          <p className="gate-note">
            Buying a ticket? You never need an account —{" "}
            <Link className="gate-link" href="/">
              back to the rack
            </Link>
            .
          </p>
        </div>

        {/* The stub: a ticket torn along a perforation, form on the wide half. */}
        <div className="stub-stage">
          <div className="stub">
            <div className="stub-head">
              <span>Organizer pass</span>
              <b className="num">ADMIT ONE</b>
            </div>

            <Suspense fallback={<div className="gate-form" aria-hidden="true" />}>
              <SignInForm />
            </Suspense>

            <p className="stub-foot">
              No organizer account yet? Ask your platform admin to open one.
            </p>

            <div className="stub-tear" aria-hidden="true">
              <span className="num">GATE · SIDE B</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
