/**
 * Mobile-local stroke glyphs (24×24) the header/picker need but that the
 * shared @room/ui icon set doesn't carry (laptop, smartphone, plus, kebab,
 * chevron, folder). Sized/stroked by CSS on the button.
 */
import type { JSX } from "react";

function glyph(paths: JSX.Element): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

export const IconFolder = () =>
  glyph(<path d="M4 5h5l2 2h9v11H4z" />);

export const IconArrowLeft = () => glyph(<path d="M19 12H5m0 0 6 6m-6-6 6-6" />);

/** Upward paper-plane send glyph (composer + call "send a text"). */
export const IconSend = () =>
  glyph(<path d="M12 20V5m0 0-6 6m6-6 6 6" />);

/** Speech bubble (call dock "send a text"). */
export const IconMessage = () =>
  glyph(<path d="M4 5h16v11H8l-4 4z" />);

/** Hang-up / end-live glyph (tilted handset with a strike). */
export const IconPhoneOff = () =>
  glyph(
    <>
      <path d="M4.5 9.5a13 13 0 0 1 15 0c.8.6.9 1.7.3 2.4l-1.6 1.6a1.6 1.6 0 0 1-1.9.3l-2-1a1.6 1.6 0 0 1-.8-1.6l.2-1.5a11 11 0 0 0-3 0l.2 1.5a1.6 1.6 0 0 1-.8 1.6l-2 1a1.6 1.6 0 0 1-1.9-.3L4.2 11.9a1.7 1.7 0 0 1 .3-2.4Z" />
      <path d="M3 3l18 18" />
    </>,
  );
