import { Box, Grid3x3, Hand, Maximize, Orbit, Video, ZoomIn } from 'lucide-react';
import { IconButton } from '../design-system';

const VIEWPORT_HINT = 'Arrives with the viewport (P0-05).';

/**
 * The viewport area: the glowing background and fading grid from
 * docs/05-brand.md, a ViewCube placeholder and the floating nav bar. The
 * three.js viewport replaces the middle in P0-05.
 */
export function ViewportPlaceholder() {
  return (
    <section
      aria-label="Viewport"
      className="relative isolate min-w-0 flex-1 overflow-hidden"
      style={{ background: 'var(--x-viewport-glow)' }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            'linear-gradient(var(--x-grid) 1px, transparent 1px), linear-gradient(90deg, var(--x-grid) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 45% 58%, #000 10%, transparent 75%)',
        }}
      />
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="max-w-80 text-muted">
          The 3D view arrives with <span className="font-semibold text-ink">P0-05</span>. Until
          then, the timeline and the Parameters dialog already work on this document.
        </p>
      </div>

      <svg
        viewBox="0 0 40 40"
        className="absolute top-3 right-4 size-14"
        role="img"
        aria-label="View cube (placeholder)"
        style={{ stroke: 'var(--x-muted)', strokeWidth: 1, strokeLinejoin: 'round' }}
      >
        <path d="M20 4 36 12 20 20 4 12Z" fill="var(--x-raised)" />
        <path d="M4 12 20 20V36L4 28Z" fill="var(--x-panel)" />
        <path d="M20 20 36 12V28L20 36Z" fill="var(--x-line)" />
        <text
          x="20"
          y="14"
          textAnchor="middle"
          style={{ font: '600 5px var(--x-font-ui)', fill: 'var(--x-muted)', stroke: 'none' }}
        >
          TOP
        </text>
      </svg>

      <nav
        aria-label="View navigation"
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line px-2 py-1 backdrop-blur-[6px]"
        style={{ background: 'color-mix(in srgb, var(--x-raised) 85%, transparent)' }}
      >
        {[
          ['Orbit', <Orbit key="o" size={16} />],
          ['Pan', <Hand key="p" size={16} />],
          ['Zoom', <ZoomIn key="z" size={16} />],
          ['Fit', <Maximize key="f" size={16} />],
        ].map(([label, icon]) => (
          <IconButton key={label as string} label={label as string} hint={VIEWPORT_HINT} disabled>
            {icon}
          </IconButton>
        ))}
        <div className="mx-1 h-4 w-px bg-line" />
        <IconButton label="Visual style" hint={VIEWPORT_HINT} disabled>
          <Box size={16} />
        </IconButton>
        <IconButton label="Grid" hint={VIEWPORT_HINT} disabled>
          <Grid3x3 size={16} />
        </IconButton>
        <IconButton label="Named views" hint={VIEWPORT_HINT} disabled>
          <Video size={16} />
        </IconButton>
      </nav>
    </section>
  );
}
