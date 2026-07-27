/**
 * Persistent badge when queue items landed in failed/ (lost synthesis).
 * Pure presentation — count in, nothing out.
 */
export function FailedCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count === 1 ? "1 failed" : `${count} failed`;
  return (
    <div
      className="failed-badge"
      title={`${count} message${count === 1 ? "" : "s"} failed to synthesize`}
      aria-label={`${count} failed synthesis`}
    >
      <span className="dot" />
      <span className="label">{label}</span>
    </div>
  );
}
