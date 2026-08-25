import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Suspense } from "react";

import { SignInForm } from "../../_components/sign-in-form";

import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Platform admin — Gate",
  description: "Cross-organizer console.",
  // Unlisted by design: reachable by URL, never linked, never indexed.
  robots: { index: false, follow: false },
};

/**
 * The admin door (spec §8) — reached by URL only. Nothing in the public nav
 * links here, which is why `robots` is set to noindex above.
 *
 * The role check lives on `/admin` itself, not here: this page authenticates,
 * and the destination authorises. An organizer who finds this URL signs in
 * successfully and is bounced to their own dashboard rather than being told
 * whether an admin account exists.
 */
export default async function AdminSignInPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect(session.user.role === "admin" ? "/admin" : "/dashboard");
  }

  return (
    <section
      className="side gate-door gate-door-admin"
      style={
        {
          "--ground": "#1b0e0a",
          "--ink": "var(--color-beige)",
        } as React.CSSProperties
      }
    >
      <div className="side-mark" aria-hidden="true">
        <b>Side C</b> &middot; The back office
      </div>

      <div className="shell gate-door-in">
        <div className="gate-copy">
          <Link className="logo gate-logo" href="/">
            GATE
            <i aria-hidden="true" />
          </Link>

          <p className="gate-eyebrow">Platform admin</p>

          <h1 className="gate-title">
            The whole
            <br />
            <em>building.</em>
          </h1>

          <p className="gate-lead">
            Every organizer, every event, every ticket sold on the platform —
            in one console.
          </p>

          <ul className="gate-list">
            <li>
              <b>01</b> <span>Totals across all organizers</span>
            </li>
            <li>
              <b>02</b> <span>Open and close any event</span>
            </li>
            <li>
              <b>03</b> <span>Provision organizer accounts</span>
            </li>
          </ul>

          <p className="gate-note">
            Organizer, not an admin?{" "}
            <Link className="gate-link" href="/sign-in">
              Sign in at the door
            </Link>
            .
          </p>
        </div>

        <div className="stub-stage">
          <div className="stub stub-admin">
            <div className="stub-head">
              <span>Platform admin</span>
              <b className="num">ALL ACCESS</b>
            </div>

            <Suspense fallback={<div className="gate-form" aria-hidden="true" />}>
              <SignInForm fallback="/admin" submitLabel="Enter console →" />
            </Suspense>

            <p className="stub-foot">
              Admin accounts are provisioned directly. This portal is not linked
              from anywhere on the site.
            </p>

            <div className="stub-tear" aria-hidden="true">
              <span className="num">GATE · SIDE C</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
