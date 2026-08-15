/**
 * Room icon set — the panel's hand-drawn 24×24 stroke glyphs as React
 * components. Ported verbatim from panel/src/main.ts's `icons` map so the
 * island migration is pixel-identical; sized/stroked by the consumer's CSS
 * (`.icon-btn svg { … }`). Lucide is reserved for vendored primitives.
 */
import type { JSX } from "react";

function glyph(paths: JSX.Element): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths}
    </svg>
  );
}

export const IconSparkle = () =>
  glyph(<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z" />);
export const IconPause = () => glyph(<path d="M8 5v14M16 5v14" />);
export const IconPlay = () => glyph(<path d="M8 5l11 7-11 7z" />);
export const IconStop = () => glyph(<path d="M7 7h10v10H7z" />);
export const IconReplay = () =>
  glyph(
    <>
      <path d="M7 7h8a4 4 0 1 1-3.2 6.4" />
      <path d="M7 7v5H2" />
    </>,
  );

/** Replay glyph + 0.8× badge — reads as "again, slower". */
export const IconReplaySlower = () => (
  <span className="replay-slower-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      <path d="M7 7h8a4 4 0 1 1-3.2 6.4" />
      <path d="M7 7v5H2" />
    </svg>
    <span className="replay-slower-label">0.8×</span>
  </span>
);

export const IconHold = () =>
  glyph(
    <>
      <path d="M5 14c2.8.7 5.2.5 7-.6" />
      <path d="M14 5a6 6 0 1 0 5 9.3 5 5 0 0 1-5-9.3z" />
      <path d="M8 9v3" />
      <path d="M11 8v3" />
      <path d="M14 9v2.5" />
    </>,
  );
export const IconSwap = () =>
  glyph(
    <>
      <path d="M8 5c2 1.5 6 1.5 8 0" />
      <path d="M5 7.5c1.7 6 12.3 6 14 0" />
      <path d="M7 8v4a5 5 0 0 0 10 0V8" />
      <path d="M9 13h.01M15 13h.01" />
      <path d="m8 19-3-3 3-3" />
      <path d="M5 16h6" />
    </>,
  );
export const IconTerminal = () =>
  glyph(
    <>
      <path d="m7 8 3 3-3 3" />
      <path d="M12 16h5" />
      <rect x="3" y="4" width="18" height="16" rx="2" />
    </>,
  );
export const IconPower = () =>
  glyph(
    <>
      <path d="M12 3v8" />
      <path d="M7.05 7.05a7 7 0 1 0 9.9 0" />
    </>,
  );
export const IconInfo = () =>
  glyph(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>,
  );
