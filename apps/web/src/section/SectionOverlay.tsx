import type { ExtrudoDocument, Vec3 } from '@extrudo/core';
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { along, distanceAlong, draggedExpression, type Ray } from '../features/manipulate';
import { viewProject, viewRay, worldPerPixel } from '../viewport/camera';
import type { ViewportStore } from '../viewport/store';
import { arrowBase, BOX_FACES, type BoxFace, boxFaceAxis, boxFaceCentre } from './clip';
import type { SectionTool } from './useSection';

export interface SectionOverlayProps {
  tool: SectionTool;
  viewport: ViewportStore;
  settings: ExtrudoDocument['settings'];
}

type Screen = readonly [number, number];

/** How far beyond the plane the arrowhead reaches, px. */
const ARROW_PX = 46;

/**
 * The section's arrow over the view (P3-09, UI spec §3.4): a handle on the cut plane and an
 * arrowhead on the side that is cut away. Dragging the handle along the plane's normal writes
 * the offset (snapped like a dialog's arrows, the same helpers), so the model follows live.
 * Shown while the Section Analysis panel is open; the view has no permanent overlay for it.
 *
 * Test hooks: `data-section-handle` (the handle, `cx`/`cy` in view px) and
 * `data-section-arrow` on the group (the arrowhead's tip, "x,y").
 */
export function SectionOverlay({ tool, viewport, settings }: SectionOverlayProps) {
  const view = useStore(viewport, (s) => s.view);
  const projection = useStore(viewport, (s) => s.projection);
  const bounds = useStore(viewport, (s) => s.bounds);
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
  const { rows, box } = tool;
  const aspect = width / Math.max(1, height);
  const toScreen = (p: Vec3): Screen | undefined => {
    if (width === 0 || height === 0) return undefined;
    const ndc = viewProject(view, projection, aspect, p);
    return ndc && [((ndc[0] + 1) / 2) * width, ((1 - ndc[1]) / 2) * height];
  };
  const rayAt = (x: number, y: number): Ray => {
    const r = viewRay(view, projection, aspect, [(x / width) * 2 - 1, 1 - (y / height) * 2]);
    return {
      origin: [r.origin.x, r.origin.y, r.origin.z],
      direction: [r.direction.x, r.direction.y, r.direction.z],
    };
  };

  // One handle at a time is dragged: its key, how far the grab was from the value, the pointer.
  const drag = useRef<{ key: string; grab: number; pointer: number }>(undefined);
  const local = (event: ReactPointerEvent) => {
    const r = layer.current?.getBoundingClientRect();
    return [event.clientX - (r?.left ?? 0), event.clientY - (r?.top ?? 0)] as const;
  };
  const measure = (event: ReactPointerEvent, base: Vec3, normal: Vec3) => {
    const [x, y] = local(event);
    return distanceAlong(base, normal, rayAt(x, y));
  };

  /** A handle on the line through `base` along `normal`, standing `value` mm along it. */
  interface Track {
    key: string;
    /** The `data-section-handle` value. */
    id: string;
    base: Vec3;
    normal: Vec3;
    value: number;
    /** The side that is cut away: the arrowhead points along it. */
    removed: Vec3 | undefined;
    set(value: number, perPixel: number): void;
  }
  const tracks: Track[] = [];
  rows.forEach((row, i) => {
    const { state, frame, offset } = row;
    if (!state.on || !frame || offset === undefined) return;
    const n = frame.normal;
    tracks.push({
      key: `p${i}`,
      id: String(i),
      // The arrow stands where the middle of the model projects onto the plane (offset 0).
      base: arrowBase(frame, bounds?.center ?? frame.origin),
      normal: n,
      value: offset,
      removed: state.flip ? [-n[0], -n[1], -n[2]] : n,
      set: (value, perPixel) =>
        tool.setOffset(i, draggedExpression(value, 'length', settings, perPixel)),
    });
  });
  if (box?.state.on && box.value) {
    const value = box.value;
    for (const face of BOX_FACES) {
      const { axis, sign } = boxFaceAxis(face);
      const normal: [number, number, number] = [0, 0, 0];
      normal[axis] = 1;
      const at = boxFaceCentre(value, face);
      // The line runs along the face's axis through the face's centre; the value is the coordinate.
      tracks.push({
        key: `b${face}`,
        id: `box:${face}`,
        base: [
          at[0] - normal[0] * at[axis],
          at[1] - normal[1] * at[axis],
          at[2] - normal[2] * at[axis],
        ],
        normal,
        value: at[axis],
        removed: [normal[0] * sign, normal[1] * sign, normal[2] * sign],
        set: (coordinate, perPixel) => tool.dragBoxFace(face as BoxFace, coordinate, perPixel),
      });
    }
  }

  const color = 'var(--x-cat-inspect)';
  const shown = tracks.flatMap((track) => {
    const handle = along(track.base, track.normal, track.value);
    const handleAt = toScreen(handle);
    const baseAt = toScreen(track.base);
    if (!handleAt || !baseAt) return [];
    const tip =
      track.removed &&
      toScreen(
        along(handle, track.removed, ARROW_PX * worldPerPixel(view, projection, height, handle)),
      );
    return [{ track, handle, handleAt, baseAt, tip }];
  });
  const tipText = shown
    .map(({ tip }) => (tip ? `${Math.round(tip[0])},${Math.round(tip[1])}` : ''))
    .join(';');
  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[4] overflow-hidden"
      data-section-arrow={tipText || undefined}
    >
      {width > 0 && shown.length > 0 && (
        <svg
          className="absolute inset-0 h-full w-full"
          width={width}
          height={height}
          aria-hidden="true"
        >
          {shown.map(({ track, handle, handleAt, baseAt, tip }) => {
            const onDown = (event: ReactPointerEvent<SVGElement>) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.preventDefault();
              const at = measure(event, track.base, track.normal);
              if (at === undefined) return;
              (event.currentTarget as Element).setPointerCapture(event.pointerId);
              drag.current = { key: track.key, grab: track.value - at, pointer: event.pointerId };
            };
            const onMove = (event: ReactPointerEvent<SVGElement>) => {
              const d = drag.current;
              if (!d || d.key !== track.key || d.pointer !== event.pointerId) return;
              const at = measure(event, track.base, track.normal);
              if (at === undefined) return;
              track.set(at + d.grab, worldPerPixel(view, projection, height, handle));
            };
            const onUp = (event: ReactPointerEvent<SVGElement>) => {
              if (drag.current?.pointer === event.pointerId) drag.current = undefined;
            };
            return (
              <g key={track.key}>
                <line
                  x1={baseAt[0]}
                  y1={baseAt[1]}
                  x2={handleAt[0]}
                  y2={handleAt[1]}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  opacity={0.8}
                />
                <circle cx={baseAt[0]} cy={baseAt[1]} r={2.5} fill={color} opacity={0.8} />
                {tip && <Arrow from={handleAt} to={tip} color={color} />}
                <circle
                  data-section-handle={track.id}
                  data-view-passthrough=""
                  cx={Math.round(handleAt[0] * 10) / 10}
                  cy={Math.round(handleAt[1] * 10) / 10}
                  r={7}
                  fill="var(--x-raised)"
                  stroke={color}
                  strokeWidth={2}
                  style={{ pointerEvents: 'auto', cursor: 'grab' }}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                >
                  <title>Drag to move the cut</title>
                </circle>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** A shaft from the handle and a head at `to`. */
function Arrow({ from, to, color }: { from: Screen; to: Screen; color: string }) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  // Along the view, the arrow shortens to nothing; the handle alone stays.
  if (length < 14) return null;
  const [ux, uy] = [dx / length, dy / length];
  const start: Screen = [from[0] + ux * 8, from[1] + uy * 8];
  const back: Screen = [to[0] - ux * 11, to[1] - uy * 11];
  const w = 6;
  const head = [to, [back[0] - uy * w, back[1] + ux * w], [back[0] + uy * w, back[1] - ux * w]];
  return (
    <g>
      <line
        x1={start[0]}
        y1={start[1]}
        x2={back[0]}
        y2={back[1]}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <polygon points={head.map((p) => p.join(',')).join(' ')} fill={color} />
    </g>
  );
}
