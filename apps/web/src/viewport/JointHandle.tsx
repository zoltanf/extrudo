import type { Joint, JointReport, Vec3 } from '@extrudo/core';
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { angleAround, distanceAlong, type Ray, snap, unwrapAngle } from '../features/manipulate';
import { viewProject, viewRay, worldPerPixel } from './camera';
import type { ViewportStore } from './store';

/** Screen radius of a revolute's arc, px. */
const ARC_PX = 72;
/** Dragged values snap to this many degrees or mm unless Shift is held. */
const SNAP_ANGLE = 5;
const SNAP_LENGTH = 1;
/** Screen length of a slider's guide either way from its foot, px. */
const GUIDE_PX = 90;

type Screen = readonly [number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const at = (o: Vec3, d: Vec3, t: number): Vec3 => [
  o[0] + d[0] * t,
  o[1] + d[1] * t,
  o[2] + d[2] * t,
];

/** A unit vector square to `d`, the same one for the same `d`. */
function perpendicular(d: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(d, helper));
}

/**
 * The joint's handle in the view (P6-05 J2, ADR-0081 §6) while its panel is open: an arc about
 * the axis (revolute) or an arrow along the direction (slider), standing at the moving side's
 * box centre projected on the axis. Dragging the round head poses the joint, snapping to 5° or
 * 1 mm unless Shift is held. Test hooks: `data-joint-handle` carries its centre in `cx`/`cy`
 * (px in the view).
 */
export function JointHandle({
  viewport,
  joint,
  report,
  centre,
  value,
  onChange,
}: {
  viewport: ViewportStore;
  joint: Joint;
  report: JointReport;
  /** The moving side's box centre, as built. */
  centre: Vec3;
  value: number;
  /** A pose value from a drag (the caller clamps it to the joint's range). */
  onChange(value: number): void;
}) {
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
  const drag = useRef<{ pointer: number; offset: number } | undefined>(undefined);

  const axis = report.axis;
  const { width, height } = size;
  if (!axis || joint.type === 'rigid' || width === 0 || height === 0) {
    return <div ref={layer} className="pointer-events-none absolute inset-0 z-[4]" />;
  }
  const direction = unit(axis.direction);
  const foot = at(
    axis.origin,
    direction,
    dot(
      [centre[0] - axis.origin[0], centre[1] - axis.origin[1], centre[2] - axis.origin[2]],
      direction,
    ),
  );
  const sign = joint.flip ? -1 : 1;
  const aspect = width / Math.max(1, height);
  const toScreen = (p: Vec3): Screen | undefined => {
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
  const perPixel = worldPerPixel(view, projection, height, foot);
  const zero = perpendicular(direction);
  const quarter = cross(direction, zero);
  const radius = ARC_PX * perPixel;
  const onCircle = (degrees: number): Vec3 => {
    const a = (sign * degrees * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [
      foot[0] + radius * (c * zero[0] + s * quarter[0]),
      foot[1] + radius * (c * zero[1] + s * quarter[1]),
      foot[2] + radius * (c * zero[2] + s * quarter[2]),
    ];
  };

  const measure = (x: number, y: number): number | undefined => {
    const ray = rayAt(x, y);
    if (joint.type === 'revolute') {
      const degrees = angleAround(foot, direction, zero, ray);
      return degrees === undefined ? undefined : degrees * sign;
    }
    const t = distanceAlong(foot, direction, ray);
    return t === undefined ? undefined : t * sign;
  };
  const local = (event: ReactPointerEvent) => {
    const r = layer.current?.getBoundingClientRect();
    return [event.clientX - (r?.left ?? 0), event.clientY - (r?.top ?? 0)] as const;
  };
  const onDown = (event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const [x, y] = local(event);
    const reached = measure(x, y);
    if (reached === undefined) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const offset =
      joint.type === 'revolute' ? value - unwrapAngle(reached, value) : value - reached;
    drag.current = { pointer: event.pointerId, offset };
  };
  const onMove = (event: ReactPointerEvent<SVGElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    const [x, y] = local(event);
    const reached = measure(x, y);
    if (reached === undefined) return;
    let next =
      joint.type === 'revolute' ? unwrapAngle(reached, value) + d.offset : reached + d.offset;
    if (!event.shiftKey) next = snap(next, joint.type === 'revolute' ? SNAP_ANGLE : SNAP_LENGTH);
    onChange(next);
  };
  const onUp = (event: ReactPointerEvent<SVGElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = undefined;
  };

  let head: Screen | undefined;
  let shape: string | undefined;
  if (joint.type === 'revolute') {
    head = toScreen(onCircle(value));
    const steps = Math.max(2, Math.ceil(Math.abs(value) / 5));
    const points: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const p = toScreen(onCircle((value * i) / steps));
      if (p) points.push(`${p[0].toFixed(1)},${p[1].toFixed(1)}`);
    }
    const start = toScreen(foot);
    shape = start
      ? `M${start[0].toFixed(1)},${start[1].toFixed(1)}L${points.join('L')}`
      : undefined;
  } else {
    const reach = GUIDE_PX * perPixel;
    const a = toScreen(at(foot, direction, -reach));
    const b = toScreen(at(foot, direction, reach));
    head = toScreen(at(foot, direction, sign * value));
    shape =
      a && b
        ? `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`
        : undefined;
  }

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 z-[4] overflow-hidden">
      <svg
        className="absolute inset-0 h-full w-full"
        width={width}
        height={height}
        aria-hidden="true"
      >
        {shape && (
          <path
            d={shape}
            fill="none"
            stroke="var(--x-accent)"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        )}
        {head && (
          <circle
            data-joint-handle={joint.type}
            cx={head[0]}
            cy={head[1]}
            r={7}
            fill="var(--x-accent)"
            stroke="var(--x-raised)"
            strokeWidth={2}
            className="pointer-events-auto cursor-grab"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        )}
      </svg>
    </div>
  );
}
