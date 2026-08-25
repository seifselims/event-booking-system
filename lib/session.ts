import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./auth";

/**
 * Server-side session guards for the authenticated routes.
 *
 * These are the *page* half of authorisation. The tRPC procedures enforce the
 * same rules independently (`protectedProcedure` / `adminProcedure`), because a
 * procedure is reachable without ever rendering the page that calls it — a page
 * guard alone would be a redirect, not a permission.
 */

/** Any signed-in user. Sends anonymous visitors to the organizer door. */
export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/sign-in");
  }

  return session.user;
}

/**
 * Platform admins only.
 *
 * A signed-in organizer is sent to their own dashboard rather than shown a
 * 403: they are legitimately signed in, just not here.
 */
export async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/admin/sign-in");
  }

  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  return session.user;
}
