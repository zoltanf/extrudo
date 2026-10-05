import type { BodyId, ExtrudoDocument, Vec3 } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { viewProject, viewRay, worldPerPixel } from '../viewport/camera';
import type { ViewportStore } from '../viewport/store';
import type { DialogController, OpenDialog } from './dialog';
import { DIALOG_COLUMN, FieldExpression } from './FeatureDialog';
import {
  along,
  angleAround,
  cross,
  distanceAlong,
  draggedCount,
  draggedExpression,
  type Ray,
  unwrapAngle,
} from './manipulate';
import type { DialogField, Manipulator } from './spec';

export interface DialogOverlayProps {
  controller: DialogController;
  viewport: ViewportStore;
  settings: ExtrudoDocument['settings'];
  /** The model's bodies: manipulators on faces follow them. */
  bodies: Readonly<Record<BodyId, BodyMesh>>;
}

/** Screen radius of an angle arc, px. */
const ARC_PX = 64;
/** How long a direction arrow is drawn, mm. */
const ARROW_MM = 12;
const BOX_WIDTH = 168;

/** The heads-up box goes right of the handle, or left of it where the dialog is. */
function boxLeft(x: number, width: number): number {
  const right = x + 18;
  const left = right + BOX_WIDTH > width - DIALOG_COLUMN ? x - 18 - BOX_WIDTH : right;
  return Math.max(4, Math.min(width - BOX_WIDTH - 4, left));
}
const TYPING = /^[0-9.+\-(]$/;

type Screen = readonly [number, number];

/**
 * The open dialog's in-canvas manipulators (UI spec §3.4, ADR-0027): a
 * distance arrow and an angle arc per the spec, drawn over the view, with a
 * heads-up box next to the active one, a direction arrow for a toggle (a rib's
 * Flip), which a click turns the other way, and (P4-12) a dot on every
 * instance of a pattern, which a click skips or keeps, and a handle on the
 * last instance of each series, which a drag turns into a whole count.
 * Dragging a handle writes the field; typing a number while nothing else has
 * the keyboard goes into the box.
 * Rendered directly from the shell, never through `React.lazy` (keys typed
 * while a lazy boundary suspends are lost).
 *
 * Test hooks: `data-manipulators` ("distance:depth angle:tilt count:count1
 * toggle:skip", kind and field, each listed once), each draggable handle's
 * `data-manipulator-handle` (its field) with its centre in `cx`/`cy` (px in
 * the view), a pattern instance's `data-instance-toggle` (its label), and the
 * box's `data-heads-up`.
 */
export function DialogOverlay({ controller, viewport, settings, bodies }: DialogOverlayProps) {
  const open = useStore(controller.state, (s) => s.open);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: manipulators follow the values, their evaluation, the bodies and the layout the last preview reported (P4-12's dots and count handles).
  const manipulators = useMemo(() => {
    const ctx = controller.context();
    return open && ctx ? (open.spec.manipulators?.(open.values, ctx) ?? []) : [];
  }, [controller, open?.values, open?.expressions, open?.preview?.pattern, bodies]);

  // The last value of each field that evaluated, so an arrow stays put while its text is invalid.
  const last = useRef(new Map<string, number>());
  const fieldValue = (field: string) => {
    const result = open?.expressions.get(field);
    if (result?.ok) last.current.set(field, result.value);
    return last.current.get(field) ?? 0;
  };

  const { width, height } = size;
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
  const perPixel = (p: Vec3) => worldPerPixel(view, projection, height, p);

  // A direction arrow or an instance dot writes without a heads-up box and no value.
  const boxed = manipulators.filter((m) => m.kind !== 'arrow' && m.kind !== 'toggle');
  const current = boxed.find((m) => m.field === open?.activeField) ?? boxed[0];

  // Typing a number goes straight into the heads-up box (UI spec §3.4); Tab moves into it.
  // A key with a modifier is a command, not typing: Shift+1…7 turn the view and
  // Ctrl+Z undoes, and taking the digit would leave the shortcut's own handler
  // with a prevented default (this listener is registered before the shell's).
  const box = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.defaultPrevented
      )
        return;
      if (
        target &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      )
        return;
      const input = box.current?.querySelector('input');
      if (!input) return;
      if (event.key === 'Tab' || TYPING.test(event.key)) {
        if (event.key === 'Tab') event.preventDefault();
        // Focus before the key's default action, so the character lands in the field.
        input.focus();
        input.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current]);

  // A drag: which manipulator, and the offset between the value and where the pointer grabbed it.
  const drag = useRef<{ m: Manipulator; offset: number; pointer: number }>(undefined);
  const measure = (m: Manipulator, x: number, y: number): number | undefined => {
    const ray = rayAt(x, y);
    if (m.kind === 'angle') {
      const at = angleAround(m.origin, m.axis, m.zero, ray);
      return at === undefined ? undefined : at / (m.scale ?? 1);
    }
    if (m.kind === 'toggle') return undefined; // a dot is clicked, never dragged
    if (m.kind === 'count') {
      // A row is dragged along, a turn round about its axis (in degrees, as `angleAround`).
      return m.turn
        ? angleAround(m.origin, m.direction, m.zero ?? turnZero(m), ray)
        : distanceAlong(m.origin, m.direction, ray);
    }
    const at = distanceAlong(m.origin, m.direction, ray);
    return at === undefined ? undefined : at / (m.kind === 'arrow' ? 1 : (m.scale ?? 1));
  };
  const local = (event: ReactPointerEvent) => {
    const r = layer.current?.getBoundingClientRect();
    return [event.clientX - (r?.left ?? 0), event.clientY - (r?.top ?? 0)] as const;
  };
  const onDown = (m: Manipulator) => (event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    if (m.kind === 'arrow') {
      controller.setToggle(m.field, open?.values.toggles[m.field] !== true);
      return;
    }
    if (m.kind === 'toggle') {
      controller.toggleLabel(m.field, m.label);
      return;
    }
    const [x, y] = local(event);
    const at = measure(m, x, y);
    if (at === undefined) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    // A lifted head is drawn away from the geometry, so where it was pressed says
    // nothing about the value: such a drag is measured from the origin instead.
    const liftedBy = 'lift' in m ? (m.lift ?? 0) : 0;
    drag.current = {
      m,
      offset: liftedBy > 0 ? 0 : fieldValue(m.field) - at,
      pointer: event.pointerId,
    };
    controller.activate(m.field);
  };
  const onMove = (event: ReactPointerEvent<SVGElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    const [x, y] = local(event);
    const at = measure(d.m, x, y);
    if (at === undefined) return;
    if (d.m.kind === 'count') {
      // The step is the series' own, held still while the drag runs, so the count
      // follows the pointer instead of chasing it.
      // A turn's step is in radians and a drag reads degrees, and reads −180…180,
      // so it is taken round to the steps the count is at now.
      const step = d.m.turn ? (d.m.step * 180) / Math.PI : d.m.step;
      const reached = d.m.turn ? unwrapAngle(at, (d.m.count - 1) * step, 360) : at + d.offset;
      controller.setExpr(
        d.m.field,
        String(draggedCount(reached, { step, count: d.m.count, extent: d.m.extent })),
      );
      return;
    }
    let value = at + d.offset;
    if (d.m.kind === 'angle' && d.m.fullTurn) {
      // Round and round: the value nearest the last one, within a whole turn.
      value = unwrapAngle(value, fieldValue(d.m.field), 360 / (d.m.scale ?? 1));
    } else if (d.m.kind === 'angle') {
      value = ((((value + 180) % 360) + 360) % 360) - 180;
    }
    if (d.m.kind === 'toggle') return;
    const unit = fieldUnit(open, d.m.field);
    // A pixel along a scaled arrow is worth 1 / scale of the value.
    const step = perPixel(d.m.origin) / (d.m.kind === 'distance' ? (d.m.scale ?? 1) : 1);
    controller.setExpr(d.m.field, draggedExpression(value, unit, settings, step));
  };
  const onUp = (event: ReactPointerEvent<SVGElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = undefined;
  };

  const drawn = manipulators.map((m) => {
    const radius = ARC_PX * perPixel(m.kind === 'toggle' ? m.at : m.origin);
    return { m, radius, shape: shapeOf(m, fieldValue(m.field), radius) };
  });
  const currentHandle = drawn.find((d) => d.m === current)?.shape.handle;
  const handleAt = currentHandle && toScreen(currentHandle);
  const label = current && fieldLabel(open, current.field);

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[4] overflow-hidden"
      data-manipulators={
        [...new Set(manipulators.map((m) => `${m.kind}:${m.field}`))].join(' ') || undefined
      }
    >
      {open && width > 0 && (
        <svg
          className="absolute inset-0 h-full w-full"
          width={width}
          height={height}
          aria-hidden="true"
        >
          {drawn.map(({ m, shape, radius }) => {
            if (m.kind === 'toggle') {
              const at = toScreen(m.at);
              if (!at) return null;
              const color = m.skipped ? 'var(--x-muted)' : 'var(--x-accent)';
              const r = 7;
              return (
                <g key={`${m.kind}:${m.label}`} data-manipulator="toggle">
                  <circle
                    data-instance-toggle={m.label}
                    data-skipped={m.skipped}
                    data-view-passthrough=""
                    cx={round(at[0])}
                    cy={round(at[1])}
                    r={r}
                    fill="none"
                    stroke={color}
                    strokeWidth={m.skipped ? 1.5 : 2}
                    strokeDasharray={m.skipped ? '3 2' : undefined}
                    style={{ pointerEvents: 'all', cursor: 'pointer' }}
                    onPointerDown={onDown(m)}
                  >
                    <title>
                      {m.skipped
                        ? `Click to make instance ${m.label}`
                        : `Click to skip instance ${m.label}`}
                    </title>
                  </circle>
                  {m.skipped ? (
                    <line
                      x1={round(at[0] - 4)}
                      y1={round(at[1] + 4)}
                      x2={round(at[0] + 4)}
                      y2={round(at[1] - 4)}
                      stroke={color}
                      strokeWidth={1.5}
                      style={{ pointerEvents: 'none' }}
                    />
                  ) : (
                    <circle
                      cx={round(at[0])}
                      cy={round(at[1])}
                      r={2.5}
                      fill={color}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                </g>
              );
            }
            const active = m === current;
            const color = active ? 'var(--x-accent)' : 'var(--x-sketch)';
            const shaft = toScreen(shape.handle);
            const line = (m.kind === 'distance' ? shape.line : arcPoints(m, shape.angle, radius))
              .map(toScreen)
              .filter((p): p is Screen => p !== undefined);
            const zero = m.kind === 'angle' ? toScreen(along(m.origin, m.zero, radius)) : undefined;
            const base = toScreen(m.origin);
            // A lifted head floats clear of the geometry under it (a pattern's
            // instance dot), with a tick back to where it really is.
            const lift = 'lift' in m ? (m.lift ?? 0) : 0;
            const handle =
              shaft && lift
                ? lifted(shaft, base, lift, m.kind === 'count' && m.turn === true)
                : shaft;
            return (
              <g key={`${m.kind}:${m.field}`} data-manipulator={m.kind}>
                {zero && base && (
                  <line
                    x1={base[0]}
                    y1={base[1]}
                    x2={zero[0]}
                    y2={zero[1]}
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    opacity={0.7}
                  />
                )}
                <polyline
                  points={line.map((p) => p.join(',')).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                />
                {(m.kind === 'distance' || m.kind === 'arrow') && handle && base && (
                  <ArrowHead from={line.at(-2) ?? base} to={handle} color={color} />
                )}
                {lift > 0 && shaft && handle && (
                  <line
                    x1={round(shaft[0])}
                    y1={round(shaft[1])}
                    x2={round(handle[0])}
                    y2={round(handle[1])}
                    stroke={color}
                    strokeWidth={1}
                    opacity={0.7}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {m.kind === 'count' && handle && (
                  <line
                    x1={base?.[0]}
                    y1={base?.[1]}
                    x2={handle[0]}
                    y2={handle[1]}
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.5}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {handle && (
                  <circle
                    data-manipulator-handle={m.field}
                    data-view-passthrough=""
                    cx={round(handle[0])}
                    cy={round(handle[1])}
                    r={7}
                    fill="var(--x-raised)"
                    stroke={color}
                    strokeWidth={2}
                    style={{
                      pointerEvents: 'auto',
                      cursor: m.kind === 'arrow' ? 'pointer' : 'grab',
                    }}
                    onPointerDown={onDown(m)}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                  >
                    <title>
                      {m.kind === 'arrow'
                        ? `Click to turn ${fieldLabel(open, m.field)?.toLowerCase()} the other way`
                        : m.kind === 'count'
                          ? `Drag to set ${fieldLabel(open, m.field)?.toLowerCase()}`
                          : `Drag to set ${fieldLabel(open, m.field)?.toLowerCase()}`}
                    </title>
                  </circle>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {open && current && handleAt && label && (
        <fieldset
          ref={box}
          aria-label="Heads-up input"
          data-heads-up={current.field}
          className="pointer-events-auto absolute m-0 flex w-[168px] flex-col gap-1 rounded-dialog border border-line p-2 shadow-raised"
          style={{
            left: boxLeft(handleAt[0], width),
            top: Math.max(4, Math.min(height - 80, handleAt[1] + 18)),
            background: 'color-mix(in srgb, var(--x-raised) 92%, transparent)',
          }}
        >
          <legend className="sr-only">{label}</legend>
          <div className="grid grid-cols-[48px_minmax(0,1fr)] items-start gap-2">
            <span className="pt-1 text-sm text-muted">{label}</span>
            <FieldExpression
              field={current.field}
              label={label}
              open={open}
              controller={controller}
              settings={settings}
            />
          </div>
        </fieldset>
      )}
    </div>
  );
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * A head drawn `up` px above its own shaft (P4-12: the arrow of a pattern ends
 * where one of its instances is, and that instance's dot has to stay clickable).
 * Upwards on screen, or straight out from the origin where there is no shaft.
 */
function lifted(handle: Screen, base: Screen | undefined, px: number, radial = false): Screen {
  const dx = base ? handle[0] - base[0] : 0;
  const dy = base ? handle[1] - base[1] : 0;
  const length = Math.hypot(dx, dy);
  if (length < 4) return [handle[0], handle[1] - px];
  // Straight out from the origin for a turn (an arc's own direction), else across
  // the shaft and upwards, which is the shorter way round.
  const ax = radial ? dx / length : -dy / length;
  const ay = radial ? dy / length : dx / length;
  const way = !radial && ay > 0 ? -1 : 1;
  return [handle[0] + ax * way * px, handle[1] + ay * way * px];
}

/** A vector's unit length (a zero vector stands for itself). */
function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function fieldOf(open: OpenDialog | undefined, name: string): DialogField | undefined {
  return open?.spec.fields.find((f) => f.name === name);
}

function fieldLabel(open: OpenDialog | undefined, name: string): string | undefined {
  return fieldOf(open, name)?.label;
}

function fieldUnit(open: OpenDialog | undefined, name: string) {
  const field = fieldOf(open, name);
  return field?.kind === 'expression' ? field.unit : 'length';
}

/** A manipulator's handle and line (an arrow's shaft) at a value; arcs of radius `r` (mm). */
function shapeOf(m: Manipulator, value: number, r: number) {
  if (m.kind === 'distance' || m.kind === 'arrow') {
    const head =
      m.kind === 'arrow'
        ? along(m.origin, m.direction, m.length ?? ARROW_MM)
        : along(m.origin, m.direction, value * (m.scale ?? 1));
    return { handle: head, line: [m.origin, head], angle: 0 };
  }
  // A count handle sits on the series' last instance; an instance dot on its own.
  if (m.kind === 'count') return { handle: m.last, line: [], angle: 0 };
  if (m.kind === 'toggle') return { handle: m.at, line: [], angle: 0 };
  const angle = value * (m.scale ?? 1);
  return { handle: arcPoint(m, angle, r), line: [], angle };
}

/**
 * The direction a turn is measured from when the spec gives none (P4-12): from
 * the series' first instance out from the axis, so a drag counts steps round
 * from there. (The axis is taken through `last`, which a pattern's centre is
 * never on, so the fallback is only ever used by a spec of its own.)
 */
function turnZero(m: Extract<Manipulator, { kind: 'count' }>): Vec3 {
  const axis = unit(m.direction);
  const at = m.origin;
  const t =
    (at[0] - m.last[0]) * axis[0] + (at[1] - m.last[1]) * axis[1] + (at[2] - m.last[2]) * axis[2];
  const foot: Vec3 = [m.last[0] + t * axis[0], m.last[1] + t * axis[1], m.last[2] + t * axis[2]];
  const out: Vec3 = [at[0] - foot[0], at[1] - foot[1], at[2] - foot[2]];
  if (Math.hypot(...out) > 1e-9) return unit(out);
  return unit(cross(axis, Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
}

/** A point on the arc at `degrees` and radius `r` (world mm). */
function arcPoint(m: Extract<Manipulator, { kind: 'angle' }>, degrees: number, r: number): Vec3 {
  const t = (degrees * Math.PI) / 180;
  const y = cross(m.axis, m.zero);
  const [c, s] = [r * Math.cos(t), r * Math.sin(t)];
  const o = m.origin;
  return [
    o[0] + c * m.zero[0] + s * y[0],
    o[1] + c * m.zero[1] + s * y[1],
    o[2] + c * m.zero[2] + s * y[2],
  ];
}

function arcPoints(m: Manipulator, degrees: number, r: number): Vec3[] {
  if (m.kind !== 'angle') return [];
  const steps = Math.max(2, Math.ceil(Math.abs(degrees) / 5));
  return Array.from({ length: steps + 1 }, (_, i) => arcPoint(m, (degrees * i) / steps, r));
}

function ArrowHead({ from, to, color }: { from: Screen; to: Screen; color: string }) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const [ux, uy] = [dx / length, dy / length];
  // Beyond the handle, so the circle doesn't hide it.
  const tip: Screen = [to[0] + ux * 24, to[1] + uy * 24];
  const back: Screen = [to[0] + ux * 10, to[1] + uy * 10];
  const w = 6;
  const points = [tip, [back[0] - uy * w, back[1] + ux * w], [back[0] + uy * w, back[1] - ux * w]];
  return <polygon points={points.map((p) => p.join(',')).join(' ')} fill={color} />;
}
