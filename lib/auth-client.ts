import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client. Same-origin, so no `baseURL` — it talks to
 * the handler at `app/api/auth/[...all]`, which owns the session cookie.
 *
 * Organizers and admins only (spec §3). Buyers never sign in.
 */
export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
