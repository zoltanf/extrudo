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
import { FieldExpression } from './FeatureDialog';
import {
  along,
  angleAround,
  cross,
  distanceAlong,
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
const BOX_WIDTH = 168;
/** The feature dialog's column on the right of the view, which the box keeps out of. */
const DIALOG_COLUMN = 280;

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
 * heads-up box next to the active one. Dragging a handle writes the field;
 * typing a number while nothing else has the keyboard goes into the box.
 * Rendered directly from the shell, never through `React.lazy` (keys typed
 * while a lazy boundary suspends are lost).
 *
 * Test hooks: `data-manipulators` ("distance:depth angle:tilt", kind and
 * field), each handle's `data-manipulator-handle` (its field) with its
 * centre in `cx`/`cy` (px in the view), and the box's `data-heads-up`.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: manipulators follow the values, their evaluation and the bodies.
  const manipulators = useMemo(() => {
    const ctx = controller.context();
    return open && ctx ? (open.spec.manipulators?.(open.values, ctx) ?? []) : [];
  }, [controller, open?.values, open?.expressions, bodies]);

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

  const current = manipulators.find((m) => m.field === open?.activeField) ?? manipulators[0];

  // Typing a number goes straight into the heads-up box (UI spec §3.4); Tab moves into it.
  const box = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
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
    const at = distanceAlong(m.origin, m.direction, ray);
    return at === undefined ? undefined : at / (m.scale ?? 1);
  };
  const local = (event: ReactPointerEvent) => {
    const r = layer.current?.getBoundingClientRect();
    return [event.clientX - (r?.left ?? 0), event.clientY - (r?.top ?? 0)] as const;
  };
  const onDown = (m: Manipulator) => (event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const [x, y] = local(event);
    const at = measure(m, x, y);
    if (at === undefined) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    drag.current = { m, offset: fieldValue(m.field) - at, pointer: event.pointerId };
    controller.activate(m.field);
  };
  const onMove = (event: ReactPointerEvent<SVGElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    const [x, y] = local(event);
    const at = measure(d.m, x, y);
    if (at === undefined) return;
    let value = at + d.offset;
    if (d.m.kind === 'angle' && d.m.fullTurn) {
      // Round and round: the value nearest the last one, within a whole turn.
      value = unwrapAngle(value, fieldValue(d.m.field), 360 / (d.m.scale ?? 1));
    } else if (d.m.kind === 'angle') {
      value = ((((value + 180) % 360) + 360) % 360) - 180;
    }
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
    const radius = ARC_PX * perPixel(m.origin);
    return { m, radius, shape: shapeOf(m, fieldValue(m.field), radius) };
  });
  const currentHandle = drawn.find((d) => d.m === current)?.shape.handle;
  const handleAt = currentHandle && toScreen(currentHandle);
  const label = current && fieldLabel(open, current.field);

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[4] overflow-hidden"
      data-manipulators={manipulators.map((m) => `${m.kind}:${m.field}`).join(' ') || undefined}
    >
      {open && width > 0 && (
        <svg
          className="absolute inset-0 h-full w-full"
          width={width}
          height={height}
          aria-hidden="true"
        >
          {drawn.map(({ m, shape, radius }) => {
            const active = m === current;
            const color = active ? 'var(--x-accent)' : 'var(--x-sketch)';
            const handle = toScreen(shape.handle);
            const line = (m.kind === 'distance' ? shape.line : arcPoints(m, shape.angle, radius))
              .map(toScreen)
              .filter((p): p is Screen => p !== undefined);
            const zero = m.kind === 'angle' ? toScreen(along(m.origin, m.zero, radius)) : undefined;
            const base = toScreen(m.origin);
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
                {m.kind === 'distance' && handle && base && (
                  <ArrowHead from={line.at(-2) ?? base} to={handle} color={color} />
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
                    style={{ pointerEvents: 'auto', cursor: 'grab' }}
                    onPointerDown={onDown(m)}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                  >
                    <title>{`Drag to set ${fieldLabel(open, m.field)?.toLowerCase()}`}</title>
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
  if (m.kind === 'distance') {
    const handle = along(m.origin, m.direction, value * (m.scale ?? 1));
    return { handle, line: [m.origin, handle], angle: 0 };
  }
  const angle = value * (m.scale ?? 1);
  return { handle: arcPoint(m, angle, r), line: [], angle };
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
