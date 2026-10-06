import { type ExtrudoDocument, formatQuantity, LENGTH } from '@extrudo/core';
import type { Vec3 } from '@extrudo/kernel';
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { isClipped, type SectionClip } from '../section/clip';
import { viewProject } from '../viewport/camera';
import type { ViewportStore } from '../viewport/store';
import type { ThinSpot } from './thickness';

export interface ThicknessOverlayProps {
  spot: ThinSpot;
  viewport: ViewportStore;
  settings: ExtrudoDocument['settings'];
  /** The analysis' section clip, if any: a clipped-away spot is not marked. */
  clip?: SectionClip;
}

type Screen = readonly [number, number];

/** How far the label stands from the spot, px (the leader is that long). */
const LEADER = 26;

/**
 * The thinnest wall's marker over the view (P5-06, ADR-0072 §3): a dot at the triangle's
 * centroid and the thickness on a short leader. Hidden where the section clips the spot away
 * or where it projects behind the camera.
 *
 * Test hook: `data-thickness-spot` ("x,y", px in the view).
 */
export function ThicknessOverlay({ spot, viewport, settings, clip }: ThicknessOverlayProps) {
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
  const hidden = clip !== undefined && isClipped(clip, spot.point[0], spot.point[1], spot.point[2]);
  const at = hidden ? undefined : toScreen(spot.point as Vec3);
  const label = formatQuantity(spot.value, LENGTH, { ...settings, precision: 2 });

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[4] overflow-hidden"
      data-thickness-spot={at ? `${at[0].toFixed(1)},${at[1].toFixed(1)}` : undefined}
    >
      {at && (
        <svg width={width} height={height} className="absolute inset-0" aria-hidden="true">
          <line
            x1={at[0]}
            y1={at[1]}
            x2={at[0] + LEADER}
            y2={at[1] - LEADER}
            stroke="var(--x-error)"
            strokeWidth={1.5}
          />
          <circle
            cx={at[0]}
            cy={at[1]}
            r={3.5}
            fill="var(--x-error)"
            stroke="var(--x-bg)"
            strokeWidth={1.5}
          />
        </svg>
      )}
      {at && (
        <div
          className="absolute rounded-control border border-line px-1.5 py-0.5 font-mono text-xs whitespace-nowrap tabular-nums shadow-raised"
          style={{
            left: at[0] + LEADER + 2,
            top: at[1] - LEADER - 18,
            background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
