/**
 * Suspense boundary for one organizer's page.
 *
 * The prefetch normally means this never shows; it exists for the cache-miss
 * case — a hard reload, a slow database. Unlike `/organizers`, this page's
 * section is not wrapped in its own `<Suspense>`, because the organizer's name
 * and their rack come from one query and should arrive together rather than
 * the header popping in above an empty grid.
 */
export default function Loading() {
  return (
    <section
      className="side"
      style={
        {
          "--ground": "var(--color-tangerine)",
          "--ink": "#fff",
        } as React.CSSProperties
      }
    >
      <div className="shell rack" aria-hidden="true" />
    </section>
  );
}
