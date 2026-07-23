/**
 * Minimal transient toast for AudioController notices ("Mac is speaking…",
 * "No replays yet", "Ready — tap to play"). Auto-hides ~2.4s after each new
 * notice (keyed on the notice timestamp so repeats re-arm the timer). This is
 * the only user-feedback surface the controller needs in chunk D.
 */
import { useEffect, useState } from "react";
import { useNotice } from "../audio/react.js";

export function Toast() {
  const notice = useNotice();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!notice) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 2400);
    return () => clearTimeout(id);
  }, [notice?.at]);

  if (!notice) return null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-xs rounded-full border border-line-strong bg-bg-elevated/95 px-4 py-2 text-sm text-fg shadow-lg backdrop-blur">
        {notice.text}
      </div>
    </div>
  );
}
