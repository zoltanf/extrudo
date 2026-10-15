import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The About dialog's logo, which designs itself when clicked: the four corner
 * points of a sketch pop in, the lines join them, the profile fills, and it
 * extrudes back and up into the mark (docs/05-brand.md §2) with the Extrude
 * tool's distance handle counting the millimetres. A small hidden treat; at
 * rest, and with reduced motion, it is the plain mark.
 */

type Pt = readonly [number, number];
const CORNERS: readonly Pt[] = [
  [10, 24],
  [38, 24],
  [38, 52],
  [10, 52],
];
/** The extrusion: back and up, as the mark's top and side faces go. */
const DIR: Pt = [14, -14];
const DISTANCE_MM = 20;

/** Phase times in ms from the click. */
const T = {
  out: [0, 180],
  points: 220,
  pointStep: 110,
  pointDur: 240,
  lines: [420, 1000],
  fill: [1000, 1200],
  extrude: [1260, 2060],
  handleOut: [2060, 2300],
  end: 2300,
} as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const span = (t: number, [a, b]: readonly [number, number]) => clamp01((t - a) / (b - a));
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const easeOutBack = (x: number) => {
  const c = 1.6;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};
const add = (p: Pt, k: number): Pt => [p[0] + DIR[0] * k, p[1] + DIR[1] * k];
const poly = (pts: readonly Pt[]) => `M${pts.map((p) => p.join(' ')).join('L')}Z`;

export function LogoReplay({ size = 120 }: { size?: number }) {
  // Milliseconds into the replay; null at rest (the finished mark).
  const [t, setT] = useState<number | null>(null);
  const frame = useRef(0);

  const play = useCallback(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    cancelAnimationFrame(frame.current);
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= T.end) {
        setT(null);
        return;
      }
      setT(elapsed);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const fadingOut = t !== null && t < T.out[1];
  const time = t === null || fadingOut ? T.end : t;
  const e = easeOutBack(span(time, T.extrude));
  const lines = easeInOut(span(time, T.lines));
  const fill = span(time, T.fill);
  const extruding = time >= T.extrude[0] && time < T.handleOut[1];
  const handle = extruding ? 1 - span(time, T.handleOut) : 0;
  const [p1, p2, p3] = CORNERS as [Pt, Pt, Pt, Pt];
  const centre: Pt = [24, 38];
  const tip = add(centre, Math.max(e, 0) * 0.9);

  return (
    <button
      type="button"
      onClick={play}
      aria-label="Extrudo logo"
      className="group relative grid cursor-pointer place-items-center rounded-card outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="overflow-visible transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-95"
        style={
          fadingOut
            ? { opacity: 1 - span(t, T.out), transform: `scale(${1 - 0.1 * span(t, T.out)})` }
            : undefined
        }
      >
        <defs>
          <marker
            id="about-arrow"
            viewBox="0 0 6 6"
            refX="3"
            refY="3"
            markerWidth="4"
            markerHeight="4"
            orient="auto"
          >
            <path d="M0 0 6 3 0 6Z" fill="var(--x-accent)" />
          </marker>
        </defs>

        {/* The extruded faces grow from the profile's top and right edges. */}
        {e > 0 && (
          <>
            <path d={poly([p1, p2, add(p2, e), add(p1, e)])} fill="var(--x-logo-top)" />
            <path d={poly([p2, add(p2, e), add(p3, e), p3])} fill="var(--x-logo-side)" />
          </>
        )}
        {/* The far copy of the profile, leading the extrusion. */}
        {extruding && (
          <path
            d={poly(CORNERS.map((p) => add(p, e)))}
            fill="none"
            stroke="var(--x-logo-sketch)"
            strokeWidth="0.8"
            strokeDasharray="1.6 1.4"
            opacity={0.7 * (1 - span(time, T.extrude))}
          />
        )}

        {/* The profile: solid lines while drawn, the mark's dashed outline once closed. */}
        <rect
          x="10"
          y="24"
          width="28"
          height="28"
          rx="1"
          fill="var(--x-logo-sketch-fill)"
          stroke="var(--x-logo-sketch)"
          strokeWidth="2"
          strokeDasharray="3.2 2.6"
          opacity={fill}
        />
        {lines > 0 && fill < 1 && (
          <path
            d={poly(CORNERS)}
            pathLength={1}
            fill="none"
            stroke="var(--x-logo-sketch)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeDasharray="1 1"
            strokeDashoffset={1 - lines}
            opacity={1 - fill}
          />
        )}
        {CORNERS.map(([cx, cy], i) => {
          const s = easeOutBack(
            span(time, [T.points + i * T.pointStep, T.points + i * T.pointStep + T.pointDur]),
          );
          return (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r={2.2 * Math.max(s, 0)}
              fill="var(--x-logo-sketch)"
            />
          );
        })}

        {/* The Extrude tool's distance handle. */}
        {handle > 0 && (
          <g opacity={handle}>
            <line
              x1={centre[0]}
              y1={centre[1]}
              x2={tip[0]}
              y2={tip[1]}
              stroke="var(--x-accent)"
              strokeWidth="1.2"
              strokeLinecap="round"
              markerEnd="url(#about-arrow)"
            />
            <text
              x={tip[0] + 3}
              y={tip[1] - 2}
              fontSize="5.5"
              fontWeight="600"
              fill="var(--x-ink)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {Math.round(clamp01(e) * DISTANCE_MM)} mm
            </text>
          </g>
        )}
      </svg>
    </button>
  );
}
