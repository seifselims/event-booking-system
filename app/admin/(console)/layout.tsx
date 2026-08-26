import { ConsoleShell } from "../../_components/console-shell";

import { requireAdmin } from "@/lib/session";

/**
 * The platform console shell.
 *
 * Lives in a `(console)` route group so it wraps `/admin` without touching
 * `/admin/sign-in`, which sits outside the group: the sign-in door is a
 * *drenched* surface (a saturated field carrying the form) and the console is
 * the inverted one (cream ground, brown ink). Wrapping the door in console
 * chrome would mix the two idioms on one screen.
 *
 * `requireAdmin()` redirects an anonymous visitor to the admin door and a
 * signed-in organizer to their own dashboard. Like every page guard here that
 * is a redirect, not the permission — `adminProcedure` is what actually
 * refuses the data.
 */
export default async function AdminConsoleLayout({
  children,
}: LayoutProps<"/admin">) {
  const user = await requireAdmin();

  return (
    <ConsoleShell
      role={user.role}
      name={user.name || user.email}
      current="platform"
    >
      {children}
    </ConsoleShell>
  );
}
