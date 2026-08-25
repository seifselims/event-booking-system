import Link from "next/link";

/**
 * Public header. Lives under the landing route for now; promote it to a
 * top-level `components/` when the second public screen needs it.
 */
export function SiteNav() {
  return (
    <nav className="nav">
      <Link className="logo" href="/">
        GATE
        <i aria-hidden="true" />
      </Link>

      <div className="nav-mid">
        <Link className="on" href="/">
          Rack
        </Link>
        <Link href="/#rack">Tonight</Link>
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
