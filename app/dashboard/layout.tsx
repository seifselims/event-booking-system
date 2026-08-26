import { ConsoleShell } from "../_components/console-shell";

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
    <ConsoleShell
      role={user.role}
      name={user.name || user.email}
      current="events"
    >
      {children}
    </ConsoleShell>
  );
}
