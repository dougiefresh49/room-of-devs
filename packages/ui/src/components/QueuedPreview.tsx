/**
 * Waiting-message preview on a hand-raised card — the first ~120 chars of
 * the queued grant target. New to the desktop panel in Phase 3 (mobile has
 * always shown it); a deliberate, documented baseline addition.
 */
export function QueuedPreview({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <div className="queued-preview" title={trimmed}>
      “{trimmed}”
    </div>
  );
}
