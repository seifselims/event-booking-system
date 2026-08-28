import Link from "next/link";

/**
 * Public header. Lives under the landing route for now; promote it to a
 * top-level `components/` when the second public screen needs it.
 *
 * `current` marks the active link. It is passed by the page rather than read
 * from `usePathname`, so this stays a Server Component.
 */
export function SiteNav({
  current = "rack",
}: {
  current?: "rack" | "tonight" | "organizers";
}) {
  return (
    <nav className="nav">
      <Link className="logo" href="/">
        GATE
        <i aria-hidden="true" />
      </Link>

      <div className="nav-mid">
        <Link
          className={current === "rack" ? "on" : undefined}
          href="/"
          aria-current={current === "rack" ? "page" : undefined}
        >
          Rack
        </Link>
        <Link
          className={current === "tonight" ? "on" : undefined}
          href="/tonight"
          aria-current={current === "tonight" ? "page" : undefined}
        >
          Tonight
        </Link>
        <Link
          className={current === "organizers" ? "on" : undefined}
          href="/organizers"
          aria-current={current === "organizers" ? "page" : undefined}
        >
          Organizers
        </Link>
        <Link href="/tickets">My tickets</Link>
      </div>

      <div className="nav-right">
        <Link className="pill pill-sm pill-ghost" href="/tickets">
          Find tickets
        </Link>
        <Link className="pill pill-sm pill-solid" href="/sign-in">
          Organizer
        </Link>
      </div>
    </nav>
  );
}
