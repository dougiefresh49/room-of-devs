/**
 * Persistent badge when queue items landed in failed/ (lost synthesis).
 * Pure presentation — count in, nothing out, UNLESS a caller passes
 * `onClear`: mobile wires that to acknowledge (clear_failed), which renders
 * the exact same look as a button with a small clear affordance. Panel call
 * sites pass nothing and render identically to before.
 */
export function FailedCountBadge({ count, onClear }: { count: number; onClear?: () => void }) {
  if (count <= 0) return null;
  const label = count === 1 ? "1 failed" : `${count} failed`;
  const title = `${count} message${count === 1 ? "" : "s"} failed to synthesize`;
  if (onClear) {
    return (
      <button
        type="button"
        className="failed-badge"
        title={`${title} — tap to clear`}
        aria-label={`${count} failed synthesis, tap to clear`}
        onClick={onClear}
      >
        <span className="dot" />
        <span className="label">{label}</span>
        <span className="failed-badge-clear" aria-hidden="true">
          ×
        </span>
      </button>
    );
  }
  return (
    <div className="failed-badge" title={title} aria-label={`${count} failed synthesis`}>
      <span className="dot" />
      <span className="label">{label}</span>
    </div>
  );
}
