/**
 * Mobile-local stroke glyphs (24×24) the header/picker need but that the
 * shared @room/ui icon set doesn't carry (laptop, smartphone, plus, kebab,
 * chevron, folder). Sized/stroked by CSS on the button.
 */
import type { JSX } from "react";

function glyph(paths: JSX.Element): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

export const IconLaptop = () =>
  glyph(
    <>
      <rect x="3" y="5" width="18" height="11" rx="1.5" />
      <path d="M2 20h20" />
    </>,
  );

export const IconSmartphone = () =>
  glyph(
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </>,
  );

export const IconPlus = () => glyph(<path d="M12 5v14M5 12h14" />);

export const IconMore = () =>
  glyph(
    <>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </>,
  );

export const IconChevron = () => glyph(<path d="m6 9 6 6 6-6" />);

export const IconFolder = () => glyph(<path d="M4 5h5l2 2h9v11H4z" />);

export const IconArrowLeft = () => glyph(<path d="M19 12H5m0 0 6 6m-6-6 6-6" />);

/**
 * Transport play/pause — SELF-CONTAINED fills (not the `glyph` stroke helper).
 * The shared @room/ui IconPause/IconPlay rely on external `.icon-btn svg` CSS
 * the mobile app never supplies, so its pause (two zero-width stroke-less
 * lines) rendered invisible on-device. These carry `fill="currentColor"` so
 * the glyph is always visible; both are filled to match (owner liked the
 * filled play triangle).
 */
export const IconPlay = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5l11 7-11 7z" />
  </svg>
);

export const IconPause = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6.5" y="5" width="3.6" height="14" rx="1.1" />
    <rect x="13.9" y="5" width="3.6" height="14" rx="1.1" />
  </svg>
);

/** Upward paper-plane send glyph (composer + call "send a text"). */
export const IconSend = () => glyph(<path d="M12 20V5m0 0-6 6m6-6 6 6" />);

/** Speech bubble (call dock "send a text"). */
export const IconMessage = () => glyph(<path d="M4 5h16v11H8l-4 4z" />);

/** Speaker on (live narration unmuted). */
export const IconSpeaker = () =>
  glyph(
    <>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18 6a8.5 8.5 0 0 1 0 12" />
    </>,
  );

/** Speaker off (live narration muted). */
export const IconSpeakerOff = () =>
  glyph(
    <>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="m22 9-6 6" />
      <path d="m16 9 6 6" />
    </>,
  );

/** Hang-up / end-live glyph (tilted handset with a strike). */
export const IconPhoneOff = () =>
  glyph(
    <>
      <path d="M4.5 9.5a13 13 0 0 1 15 0c.8.6.9 1.7.3 2.4l-1.6 1.6a1.6 1.6 0 0 1-1.9.3l-2-1a1.6 1.6 0 0 1-.8-1.6l.2-1.5a11 11 0 0 0-3 0l.2 1.5a1.6 1.6 0 0 1-.8 1.6l-2 1a1.6 1.6 0 0 1-1.9-.3L4.2 11.9a1.7 1.7 0 0 1 .3-2.4Z" />
      <path d="M3 3l18 18" />
    </>,
  );
