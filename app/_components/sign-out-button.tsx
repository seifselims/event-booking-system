"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { signOut } from "@/lib/auth-client";

/**
 * Ends the session and returns to the public rack. `router.refresh()` clears
 * the cached RSC payload so no signed-in markup survives the navigation.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className="pill pill-sm pill-ghost"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await signOut();
        router.refresh();
        router.push("/");
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
