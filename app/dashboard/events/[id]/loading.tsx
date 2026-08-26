/**
 * Suspense boundary for the event editor.
 *
 * The prefetch normally means this never shows. It exists for the cache-miss
 * case — a hard reload, a slow database — because without a boundary here the
 * editor's `useSuspenseQuery` would suspend up to the console layout and blank
 * the whole shell, chrome included.
 */
export default function Loading() {
  return (
    <div className="shell console-shell">
      <div className="console-head">
        <div>
          <p className="gate-eyebrow">Loading</p>
          <h1 className="console-title">One moment…</h1>
        </div>
      </div>
    </div>
  );
}
