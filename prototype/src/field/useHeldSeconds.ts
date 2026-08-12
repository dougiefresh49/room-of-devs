import { useEffect, useState } from "react";

export function heldSecondsAt(heldSince: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - heldSince) / 1000));
}

/** A visible HELD clock backed by the question's real mock timestamp. */
export function useHeldSeconds(heldSince: number | null, fallback = 0): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (heldSince == null) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [heldSince]);

  return heldSince == null ? fallback : heldSecondsAt(heldSince, now);
}
