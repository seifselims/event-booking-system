import Link from "next/link";

import { SignOutButton } from "../_components/sign-out-button";

import { requireUser } from "@/lib/session";

/**
 * The console shell, shared by every `/dashboard/*` screen.
 *
 * Runs `requireUser()` so no dashboard route renders for an anonymous visitor
 * even if it forgets its own guard. This is a redirect, not the permission —
 * the data itself is protected by `protectedProcedure` in the routers.
 */
export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const user = await requireUser();

  return (
    <div className="console">
      <header className="console-bar">
        <div className="console-bar-in">
          <Link className="logo console-logo" href="/">
            GATE
            <i aria-hidden="true" />
          </Link>

          <span className="console-tag">
            {user.role === "admin" ? "Admin" : "Organizer"}
          </span>

          <nav className="console-nav">
            <Link href="/dashboard">Events</Link>
            {user.role === "admin" ? <Link href="/admin">Platform</Link> : null}
          </nav>

          <div className="console-who">
            <span className="console-name">{user.name || user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="console-main">{children}</main>
    </div>
  );
}
