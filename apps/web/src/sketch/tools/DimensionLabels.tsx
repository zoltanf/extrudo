import {
  addParameter,
  type Command,
  CommandError,
  DIMENSION_LABELS,
  type DimensionId,
  type DocumentStore,
  dimensionAnchor,
  dimensionRefs,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateInline,
  evaluateParameters,
  type FeatureId,
  formatQuantity,
  inlineParameter,
  measureDimension,
  newId,
  type ParameterId,
  parameterNames,
  readSketch,
  type SessionStore,
  type SketchData,
  type SketchDimension,
  type SketchFrame,
  sketchToWorld,
  UNITS,
  updateSketchDimension,
  type Vec2,
  worldToSketch,
} from '@extrudo/core';
import { type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { withDimensionExpr } from '../../parameters/drafts';
import { ExpressionInput } from '../../parameters/ExpressionInput';
import { rayPlane, viewProject, viewRay } from '../../viewport/camera';
import type { ViewportStore } from '../../viewport/store';
import { EntityHighlight } from './ConstraintGlyphs';
import { type DimensionShape, dimensionShape, dimensionText } from './dimensionLayout';
import type { ToolHost } from './host';

export interface DimensionLabelsProps {
  store: DocumentStore;
  session: SessionStore;
  viewport: ViewportStore;
  host: ToolHost;
  sketchId: FeatureId;
  frame: SketchFrame;
  /** False while a tool runs: labels show but clicks go to the tool (the editor still works). */
  interactive: boolean;
  /** Reports a refused change (a value the sketch can't take). */
  notify(tone: 'error', text: string): void;
}

/** How far a default label sits from its geometry, px. */
export const LABEL_GAP_PX = 32;
/** A press that moves farther than this is a drag, px. */
const DRAG_PX = 3;

type Screen = (p: Vec2) => [number, number] | undefined;

/**
 * The dimensions of the open sketch (P1-07, FR-SK-08, UI spec §4): lines,
 * arrows and a value label each (`dimensionLayout.ts` shapes them). A
 * label selects its dimension (Shift or Ctrl adds), drags to a new place
 * (one undo step), and a double-click edits the value in place with an
 * `<ExpressionInput>`; the host opens the same editor for a new dimension.
 * The editor also turns a dimension driven or driving. Hovering a label
 * highlights what it measures. A dimension that over-constrains the sketch
 * is red (P1-08).
 */
export function DimensionLabels({
  store,
  session,
  viewport,
  host,
  sketchId,
  frame,
  interactive,
  notify,
}: DimensionLabelsProps) {
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

  const view = useStore(viewport, (s) => s.view);
  const projection = useStore(viewport, (s) => s.projection);
  const selection = useStore(session, (s) => s.selection);
  const editing = useStore(host.state, (s) => s.editing);
  const over = useStore(host.state, (s) => s.status?.over);
  const doc = useStore(store, (s) => s.doc);
  const data = useMemo(() => {
    const feature = doc.features.find((f) => f.id === sketchId);
    return feature ? readSketch(feature)?.data : undefined;
  }, [doc, sketchId]);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const [hover, setHover] = useState<DimensionId>();
  const [drag, setDrag] = useState<{ id: DimensionId; label: { x: number; y: number } }>();
  const press = useRef<{
    id: DimensionId;
    screen: readonly [number, number];
    start: Vec2;
    label: { x: number; y: number };
    moved: boolean;
  }>(undefined);

  const { width, height } = size;
  const toScreen: Screen = (p) => {
    if (width === 0 || height === 0) return undefined;
    const ndc = viewProject(view, projection, width / height, sketchToWorld(frame, p));
    return ndc && [((ndc[0] + 1) / 2) * width, ((1 - ndc[1]) / 2) * height];
  };
  const toSketch = (x: number, y: number): Vec2 | undefined => {
    if (width === 0 || height === 0) return undefined;
    const ray = viewRay(view, projection, width / height, [
      (x / width) * 2 - 1,
      1 - (y / height) * 2,
    ]);
    const hit = rayPlane(ray, frame.origin, frame.normal);
    return hit && worldToSketch(frame, [hit.x, hit.y, hit.z]);
  };
  const local = (event: PointerEvent): readonly [number, number] => {
    const box = layer.current?.getBoundingClientRect();
    return [event.clientX - (box?.left ?? 0), event.clientY - (box?.top ?? 0)];
  };

  // The layer stays mounted (it measures itself once) even while the sketch is gone.
  if (!data) return <div ref={layer} className="pointer-events-none absolute inset-0" />;
  const values = evaluation.dimensions.get(sketchId);
  const selected = new Set(selection.filter((s) => s.kind === 'dimension').map((s) => s.id));
  const hovered = hover && data.dimensions[hover] ? hover : undefined;

  const items = Object.entries(data.dimensions).flatMap(([key, stored]) => {
    const id = key as DimensionId;
    const d = drag?.id === id ? { ...stored, label: drag.label } : stored;
    const anchor = dimensionAnchor(data, d);
    const gap = anchor && pixelGap(toScreen, anchor);
    const shape = gap !== undefined ? dimensionShape(data, d, gap) : undefined;
    const at = shape && toScreen(shape.label);
    if (!shape || !at) return [];
    const result = d.driven ? undefined : values?.get(id);
    const value = result?.ok ? result.value : measureDimension(data, d);
    return [{ id, d, shape, at, text: dimensionText(d, value, doc.settings) }];
  });

  const down = (id: DimensionId, event: PointerEvent<HTMLButtonElement>) => {
    const d = data.dimensions[id];
    const anchor = d && dimensionAnchor(data, d);
    const screen = local(event);
    const start = toSketch(...screen);
    if (!interactive || event.button !== 0 || !d || !anchor || !start) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const item = items.find((i) => i.id === id);
    const at = item?.shape.label ?? anchor;
    press.current = {
      id,
      screen,
      start,
      label: { x: at[0] - anchor[0], y: at[1] - anchor[1] },
      moved: false,
    };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    const screen = local(event);
    if (!p.moved && Math.hypot(screen[0] - p.screen[0], screen[1] - p.screen[1]) < DRAG_PX) return;
    p.moved = true;
    const now = toSketch(...screen);
    if (!now) return;
    setDrag({
      id: p.id,
      label: { x: p.label.x + now[0] - p.start[0], y: p.label.y + now[1] - p.start[1] },
    });
  };
  const up = (event: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    press.current = undefined;
    if (!p) return;
    if (p.moved && drag?.id === p.id) {
      try {
        store
          .getState()
          .dispatch(
            updateSketchDimension({ feature: sketchId, id: p.id, changes: { label: drag.label } }),
          );
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        notify('error', error.message);
      }
      setDrag(undefined);
      return;
    }
    const add = event.shiftKey || event.ctrlKey || event.metaKey;
    session.getState().select([{ kind: 'dimension', id: p.id }], add ? 'toggle' : 'replace');
  };

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[4] overflow-hidden"
      data-dimension-labels={items.length}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        width={width}
        height={height}
        aria-hidden="true"
      >
        {hovered &&
          dimensionRefs(data.dimensions[hovered] as SketchDimension).map((ref) => (
            <EntityHighlight key={ref} data={data} id={ref} toScreen={toScreen} />
          ))}
        {items.map(({ id, d, shape }) => (
          <DimensionGraphic
            key={id}
            shape={shape}
            toScreen={toScreen}
            color={
              selected.has(id) || id === hovered
                ? 'var(--x-accent)'
                : over?.includes(id)
                  ? 'var(--x-error)'
                  : d.driven
                    ? 'var(--x-muted)'
                    : 'var(--x-sketch)'
            }
          />
        ))}
      </svg>
      {items.map(({ id, d, at, text }) =>
        id === editing ? (
          <DimensionEditor
            key={id}
            id={id}
            d={d}
            data={data}
            doc={doc}
            sketchId={sketchId}
            host={host}
            notify={notify}
            at={at}
          />
        ) : (
          <button
            key={id}
            type="button"
            tabIndex={-1}
            aria-label={`${DIMENSION_LABELS[d.type]} ${d.paramName ?? ''} ${text}`.replace(
              /\s+/g,
              ' ',
            )}
            aria-pressed={selected.has(id)}
            title={d.paramName ? `${d.paramName} = ${d.expr}` : d.driven ? 'Driven' : d.expr}
            data-dimension={id}
            data-dimension-type={d.type}
            data-driven={d.driven || undefined}
            data-over={over?.includes(id) || undefined}
            data-view-passthrough=""
            className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[4px] border px-1 font-mono text-xs leading-4 tabular-nums shadow-raised ${
              interactive ? 'pointer-events-auto cursor-move' : ''
            } ${selected.has(id) ? 'border-accent bg-accent-soft' : id === hovered ? 'border-accent' : 'border-line'} ${
              over?.includes(id) ? 'text-error' : d.driven ? 'text-muted' : 'text-ink'
            }`}
            style={{
              left: at[0],
              top: at[1],
              background: selected.has(id)
                ? undefined
                : 'color-mix(in srgb, var(--x-raised) 92%, transparent)',
            }}
            onPointerEnter={() => setHover(id)}
            onPointerLeave={() => setHover((h) => (h === id ? undefined : h))}
            onPointerDown={(event) => down(id, event)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => {
              press.current = undefined;
              setDrag(undefined);
            }}
            onDoubleClick={() => {
              if (interactive) host.editDimension(id);
            }}
          >
            {text}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * mm that make `LABEL_GAP_PX` on screen at `at`: labels keep their distance
 * from the geometry whatever the zoom.
 */
export function pixelGap(toScreen: Screen, at: Vec2): number | undefined {
  const o = toScreen(at);
  const x = toScreen([at[0] + 1, at[1]]);
  const y = toScreen([at[0], at[1] + 1]);
  if (!o || !x || !y) return undefined;
  const perMm = (Math.hypot(x[0] - o[0], x[1] - o[1]) + Math.hypot(y[0] - o[0], y[1] - o[1])) / 2;
  return perMm > 1e-9 ? LABEL_GAP_PX / perMm : undefined;
}

/** A dimension's lines, arcs and arrowheads, projected to the screen. */
export function DimensionGraphic({
  shape,
  toScreen,
  color,
}: {
  shape: DimensionShape;
  toScreen: Screen;
  color: string;
}) {
  const arrows = shape.arrows.flatMap(({ tip, dir }) => {
    const t = toScreen(tip);
    const s = toScreen([tip[0] + dir[0] * 1e-3, tip[1] + dir[1] * 1e-3]);
    if (!t || !s) return [];
    const len = Math.hypot(s[0] - t[0], s[1] - t[1]);
    if (len < 1e-12) return [];
    const u = [(s[0] - t[0]) / len, (s[1] - t[1]) / len] as const;
    const base = [t[0] - u[0] * 8, t[1] - u[1] * 8] as const;
    return [
      `${t[0]},${t[1]} ${base[0] - u[1] * 3},${base[1] + u[0] * 3} ${base[0] + u[1] * 3},${base[1] - u[0] * 3}`,
    ];
  });
  return (
    <g data-dimension-graphic="">
      {shape.lines.map(([a, b], i) => {
        const p = toScreen(a);
        const q = toScreen(b);
        return (
          p &&
          q && (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: a shape's lines have no identity.
              key={i}
              x1={p[0]}
              y1={p[1]}
              x2={q[0]}
              y2={q[1]}
              stroke={color}
              strokeWidth={1}
            />
          )
        );
      })}
      {shape.arcs.map((arc, i) => {
        const points = arc.map(toScreen);
        if (points.some((p) => !p)) return null;
        return (
          <polyline
            // biome-ignore lint/suspicious/noArrayIndexKey: a shape's arcs have no identity.
            key={i}
            points={points.map((p) => (p as number[]).join(',')).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={1}
          />
        );
      })}
      {arrows.map((points, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: arrowheads have no identity.
        <polygon key={i} points={points} fill={color} />
      ))}
    </g>
  );
}

/**
 * Edits a dimension in place: its value as an expression (driving ones),
 * and whether it drives. Enter or leaving the field commits; Esc closes.
 * `name = value` creates the user parameter `name` and puts `name` in the
 * dimension (FR-PAR-03).
 */
function DimensionEditor({
  id,
  d,
  data,
  doc,
  sketchId,
  host,
  notify,
  at,
}: {
  id: DimensionId;
  d: SketchDimension;
  data: SketchData;
  doc: ExtrudoDocument;
  sketchId: FeatureId;
  host: ToolHost;
  notify(tone: 'error', text: string): void;
  at: readonly [number, number];
}) {
  const box = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    const target = box.current?.querySelector<HTMLInputElement | HTMLButtonElement>(
      'input, button',
    );
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
  }, []);

  const run = (commands: Command<unknown>[]) => {
    try {
      host.apply(commands);
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      notify('error', error.message);
    }
  };
  const apply = (changes: Parameters<typeof updateSketchDimension>[0]['changes']) =>
    run([updateSketchDimension({ feature: sketchId, id, changes })]);
  const close = () => host.editDimension(undefined);
  const unit = d.type === 'angle' ? 'angle' : 'length';
  const evaluate = (expr: string): EvaluateResult => {
    const inline = inlineParameter(expr);
    if (!inline) return draftValue(doc, sketchId, id, expr);
    const { evaluate: current } = evaluateParameters(doc);
    return evaluateInline(inline, parameterNames(doc), current, unit);
  };
  const commit = (expr: string) => {
    const inline = inlineParameter(expr);
    if (!inline) return apply({ expr });
    run([
      updateSketchDimension({ feature: sketchId, id, changes: { expr: inline.name } }),
      addParameter({
        parameter: {
          id: newId<ParameterId>(),
          name: inline.name,
          expression: inline.expression.trim(),
          unit,
        },
      }),
    ]);
  };

  return (
    <fieldset
      ref={box}
      aria-label={`Edit ${DIMENSION_LABELS[d.type].toLowerCase()}${d.paramName ? ` ${d.paramName}` : ''}`}
      data-dimension-editor={id}
      className="pointer-events-auto absolute m-0 flex w-[168px] min-w-0 -translate-x-1/2 -translate-y-[18px] flex-col gap-1 rounded-dialog border border-line p-1.5 shadow-raised"
      style={{
        left: at[0],
        top: at[1],
        background: 'color-mix(in srgb, var(--x-raised) 96%, transparent)',
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      {d.driven ? (
        <span className="px-1 font-mono text-sm text-muted">
          {dimensionText(d, measureDimension(data, d), doc.settings)}
        </span>
      ) : (
        <ExpressionInput
          label={d.paramName ? `Value of ${d.paramName}` : 'Dimension value'}
          value={d.expr}
          evaluate={evaluate}
          format={(r) => formatQuantity(r.value, r.dim, doc.settings)}
          onCommit={commit}
        />
      )}
      <label className="flex items-center gap-1.5 px-1 text-sm text-muted">
        <input
          type="checkbox"
          checked={d.driven}
          className="accent-(--x-accent)"
          onChange={(event) => {
            const driven = event.target.checked;
            // A dimension that starts driving holds what it measures now.
            const value = measureDimension(data, d);
            const factor = unit === 'angle' ? 1 : (UNITS[doc.settings.units]?.factor ?? 1);
            const expr =
              value === undefined
                ? d.expr
                : String(Number((value / factor).toFixed(doc.settings.precision)) + 0);
            apply(driven ? { driven } : { driven, expr });
          }}
        />
        Driven (measures only)
      </label>
    </fieldset>
  );
}

/** A dimension's value if its expression were `expr`, cycles and all. */
function draftValue(
  doc: ExtrudoDocument,
  sketchId: FeatureId,
  id: DimensionId,
  expr: string,
): EvaluateResult {
  const changed = withDimensionExpr(doc, sketchId, 'sketch', id, expr);
  return (
    evaluateParameters(changed).dimensions.get(sketchId)?.get(id) ?? {
      ok: true,
      value: 0,
      dim: { length: 0, angle: 0 },
    }
  );
}
