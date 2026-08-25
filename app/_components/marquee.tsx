const CLAIMS = [
  "Never oversold",
  "QR by email",
  "No account",
  "Scan at the door",
];

/**
 * The turquoise band. The track is duplicated because the keyframe translates
 * by -50% — the second copy is what makes the loop seamless.
 */
export function Marquee() {
  return (
    <div className="mq" aria-hidden="true">
      <div className="mq-t">
        {[...CLAIMS, ...CLAIMS].map((claim, i) => (
          <span key={i} style={{ display: "contents" }}>
            <span>{claim}</span>
            <i>&#9673;</i>
          </span>
        ))}
      </div>
    </div>
  );
}
