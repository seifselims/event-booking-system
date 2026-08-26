import Link from "next/link";

import { SignOutButton } from "./sign-out-button";

/**
 * The console chrome — the bar, nav, and identity block wrapping every
 * signed-in working screen.
 *
 * Shared by `/dashboard/*` and `/admin` rather than living in either layout,
 * because the two are sibling route segments: a layout under one cannot wrap
 * the other. It takes the user's display fields as props instead of calling a
 * session helper itself, so each layout keeps its own guard — `requireUser()`
 * for the dashboard, `requireAdmin()` for the platform console.
 *
 * `current` marks the active link. It is passed by the layout rather than read
 * from `usePathname()`, which would force this into a Client Component for the
 * sake of one string (the same trade `SiteNav` makes).
 */
export function ConsoleShell({
  role,
  name,
  current,
  children,
}: {
  // Nullable because Better Auth declares `role` as `required: false`
  // (lib/auth.ts), so the inferred session type admits null even though the
  // column defaults to `organizer`. Anything but an explicit `admin` is
  // treated as an organizer — the lesser privilege, and the column default.
  role: "organizer" | "admin" | null | undefined;
  name: string;
  current?: "events" | "platform";
  children: React.ReactNode;
}) {
  const isAdmin = role === "admin";

  return (
    <div className="console">
      <header className="console-bar">
        <div className="console-bar-in">
          <Link className="logo console-logo" href="/">
            GATE
            <i aria-hidden="true" />
          </Link>

          <span className="console-tag">
            {isAdmin ? "Admin" : "Organizer"}
          </span>

          <nav className="console-nav">
            <Link
              href="/dashboard"
              className={current === "events" ? "on" : undefined}
              aria-current={current === "events" ? "page" : undefined}
            >
              Events
            </Link>
            {isAdmin ? (
              <Link
                href="/admin"
                className={current === "platform" ? "on" : undefined}
                aria-current={current === "platform" ? "page" : undefined}
              >
                Platform
              </Link>
            ) : null}
          </nav>

          <div className="console-who">
            <span className="console-name">{name}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="console-main">{children}</main>
    </div>
  );
}
