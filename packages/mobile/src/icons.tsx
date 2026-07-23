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
