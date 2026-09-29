import type { ExtrudoDocument } from '@extrudo/core';
import { formatQuantity, LENGTH } from '@extrudo/core';
import type { PairMeasure, Vec3 } from '@extrudo/kernel';
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { viewProject } from '../viewport/camera';
import type { ViewportStore } from '../viewport/store';

export interface MeasureOverlayProps {
  pair: PairMeasure;
  viewport: ViewportStore;
  settings: ExtrudoDocument['settings'];
}

type Screen = readonly [number, number];

/**
 * The line of a measured distance over the view (P2-13): between the
 * closest points of two picks, dots at its ends and the distance at its
 * middle; a centre distance, where there is one, as a fainter line.
 *
 * Test hook: `data-measure-line` ("x1,y1 x2,y2", px in the view).
 */
export function MeasureOverlay({ pair, viewport, settings }: MeasureOverlayProps) {
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
  const a = toScreen(pair.from);
  const b = toScreen(pair.to);
  const ca = pair.centers && toScreen(pair.centers.from);
  const cb = pair.centers && toScreen(pair.centers.to);
  const label = formatQuantity(pair.distance, LENGTH, settings);

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[4] overflow-hidden"
      data-measure-line={
        a && b
          ? `${a[0].toFixed(1)},${a[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`
          : undefined
      }
    >
      {a && b && (
        <svg width={width} height={height} className="absolute inset-0" aria-hidden="true">
          {ca && cb && (
            <line
              x1={ca[0]}
              y1={ca[1]}
              x2={cb[0]}
              y2={cb[1]}
              stroke="var(--x-accent)"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          )}
          <line
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke="var(--x-accent)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
          {[a, b].map(([x, y], i) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: always the two ends.
              key={i}
              cx={x}
              cy={y}
              r={3.5}
              fill="var(--x-accent)"
              stroke="var(--x-bg)"
              strokeWidth={1.5}
            />
          ))}
        </svg>
      )}
      {a && b && pair.distance > 0 && (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-control border border-line px-1.5 py-0.5 font-mono text-xs whitespace-nowrap tabular-nums shadow-raised"
          style={{
            left: (a[0] + b[0]) / 2,
            top: (a[1] + b[1]) / 2,
            background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
