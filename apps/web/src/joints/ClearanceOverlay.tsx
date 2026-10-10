import { type ExtrudoDocument, formatQuantity, LENGTH } from '@extrudo/core';
import type { Vec3 } from '@extrudo/kernel';
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { viewProject } from '../viewport/camera';
import type { ViewportStore } from '../viewport/store';

export interface ClearanceOverlayProps {
  /** The tightest gap's closest points, at the pose shown. */
  from: Vec3;
  to: Vec3;
  gap: number;
  viewport: ViewportStore;
  settings: ExtrudoDocument['settings'];
}

type Screen = readonly [number, number];

/** How far the label stands off the leader's middle, px. */
const OFFSET = 18;

/**
 * The tightest gap's leader over the view (P6-05 J3, ADR-0081 §4): a line between the two
 * closest points, a dot at each end and the gap beside it, drawn while the joint is shown at
 * the pose the gap was found at. Like the wall-thickness marker (`print/ThicknessOverlay`).
 *
 * Test hook: `data-clearance-leader` ("x1,y1 x2,y2", px in the view).
 */
export function ClearanceOverlay({ from, to, gap, viewport, settings }: ClearanceOverlayProps) {
  const view = useStore(viewport, (s) => s.view);
  const projection = useStore(viewport, (s) => s.projection);
  const layer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const toScreen = (p: Vec3): Screen | undefined => {
    if (width === 0 || height === 0) return undefined;
    const ndc = viewProject(view, projection, width / height, p);
    return ndc && [((ndc[0] + 1) / 2) * width, ((1 - ndc[1]) / 2) * height];
  };
  const a = toScreen(from);
  const b = toScreen(to);
  const shown = a && b;
  const label = formatQuantity(gap, LENGTH, { ...settings, precision: 2 });
  const mid = shown ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : undefined;

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[4] overflow-hidden"
      data-clearance-leader={
        shown
          ? `${a[0].toFixed(1)},${a[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`
          : undefined
      }
    >
      {shown && (
        <svg width={width} height={height} className="absolute inset-0" aria-hidden="true">
          <line
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke="var(--x-accent)"
            strokeWidth={1.5}
          />
          {[a, b].map((p) => (
            <circle
              key={`${p[0]},${p[1]}`}
              cx={p[0]}
              cy={p[1]}
              r={3}
              fill="var(--x-accent)"
              stroke="var(--x-bg)"
              strokeWidth={1.5}
            />
          ))}
        </svg>
      )}
      {mid && (
        <div
          className="absolute rounded-control border border-line px-1.5 py-0.5 font-mono text-xs whitespace-nowrap tabular-nums shadow-raised"
          style={{
            left: (mid[0] as number) + OFFSET,
            top: (mid[1] as number) - OFFSET - 10,
            background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
