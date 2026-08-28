"use client";

/**
 * Page controls for the rack and the organizer grid.
 *
 * Presentational and controlled — the page number lives in the parent, because
 * the parent is what slices the list. Rendering this at all is the caller's
 * decision: both grids show it only once there is more than one page.
 *
 * Styled from `.pill`, like the category filters, so the two rows of controls
 * on a rack read as one system rather than two borrowed widgets.
 */
export function Pager({
  page,
  pageCount,
  onPage,
  label = "Pages",
}: {
  /** Zero-based, matching the array slice it drives. */
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  /** Names the control for screen readers — "Pages" is ambiguous on a page
      carrying both an event grid and an organizer grid. */
  label?: string;
}) {
  if (pageCount <= 1) return null;

  const pages = Array.from({ length: pageCount }, (_, i) => i);

  return (
    <nav className="pager" aria-label={label}>
      <button
        type="button"
        className="pill pill-sm pill-ghost"
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
      >
        &larr; Prev
      </button>

      <div className="pager-nums">
        {pages.map((n) => (
          <button
            key={n}
            type="button"
            className={`pill pill-sm ${n === page ? "pill-solid" : "pill-ghost"}`}
            // `aria-current`, not `aria-pressed`: these are positions in a
            // sequence, not independent toggles like the filter pills.
            aria-current={n === page ? "page" : undefined}
            onClick={() => onPage(n)}
          >
            {n + 1}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="pill pill-sm pill-ghost"
        onClick={() => onPage(page + 1)}
        disabled={page === pageCount - 1}
      >
        Next &rarr;
      </button>
    </nav>
  );
}
