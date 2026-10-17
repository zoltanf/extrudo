import type { ReactNode } from 'react';

/**
 * The app menu rail's glyphs (ADR-0090 §1) that lucide doesn't have: a mouse
 * per preset (the orbit button filled, pan arrows, a modifier key), a pad with
 * two finger dots, and the radial right-click menu's ring.
 */
function Glyph({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A mouse with its left half, middle button or right half filled. */
function Mouse({ orbit }: { orbit: 'left' | 'middle' | 'right' }) {
  return (
    <Glyph>
      <rect x="6" y="3" width="12" height="18" rx="6" />
      <path d="M6 10h12M12 3v7" />
      {orbit === 'middle' && (
        <rect x="11" y="5.5" width="2" height="3.5" rx="1" fill="currentColor" stroke="none" />
      )}
      {orbit === 'right' && (
        <path d="M12 3a6 6 0 0 1 6 6v1h-6z" fill="currentColor" stroke="none" />
      )}
      {orbit === 'left' && <path d="M12 3a6 6 0 0 0-6 6v1h6z" fill="currentColor" stroke="none" />}
    </Glyph>
  );
}

/** A small mouse on the left, its wheel filled, beside a second sign. */
function SmallMouse({ children }: { children: ReactNode }) {
  return (
    <Glyph>
      <rect x="2.5" y="3" width="10" height="18" rx="5" />
      <path d="M2.5 10h10" />
      <rect x="6.75" y="5.5" width="1.5" height="3.5" rx=".75" fill="currentColor" stroke="none" />
      {children}
    </Glyph>
  );
}

export const CrankIcon = () => <Mouse orbit="right" />;
export const SpindleIcon = () => <Mouse orbit="middle" />;
export const SlicerIcon = () => <Mouse orbit="left" />;

export const GlideIcon = () => (
  <SmallMouse>
    <path d="M18.5 12.5v8M14.5 16.5h8M17 14l1.5-1.5L20 14M17 19l1.5 1.5L20 19M16 15l-1.5 1.5L16 18M21 15l1.5 1.5L21 18" />
  </SmallMouse>
);

export const BlenderIcon = () => (
  <SmallMouse>
    <rect x="14" y="13" width="8.5" height="7.5" rx="1.5" />
    <path d="m16.25 17.75 2-2 2 2" />
  </SmallMouse>
);

export const TrackpadIcon = () => (
  <Glyph>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 15h18M12 15v4" />
    <circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="14" cy="10" r="1.1" fill="currentColor" stroke="none" />
  </Glyph>
);

export const RingIcon = () => (
  <Glyph size={16}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="5" />
    <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
  </Glyph>
);
