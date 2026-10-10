import {
  type DocumentStore,
  dimensionAnchor,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type FeatureId,
  formatQuantity,
  measureDimension,
  readSketch,
  type SketchFrame,
  sketchToWorld,
  UNITS,
  type UnitKind,
  type Vec2,
} from '@extrudo/core';
import { arcPolyline, type SnapKind } from '@extrudo/sketch/inference';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { ExpressionInput } from '../../parameters/ExpressionInput';
import { viewProject } from '../../viewport/camera';
import type { ViewportStore } from '../../viewport/store';
import { textDraftStore } from '../textDraft';
import { EntityHighlight } from './ConstraintGlyphs';
import { DimensionGraphic, pixelGap } from './DimensionLabels';
import { dimensionShape, dimensionText } from './dimensionLayout';
import type { ToolHost } from './host';
import type { HeadsUpField } from './tool';

export interface SketchOverlayProps {
  host: ToolHost;
  store: DocumentStore;
  viewport: ViewportStore;
  sketchId: FeatureId;
  frame: SketchFrame;
}

/**
 * What a drawing tool shows over the view (P1-02, UI spec §4): the
 * rubber-band preview, dashed alignment guides, a glyph for what the point
 * snapped to, the heads-up box with the tool's fields, and the tool's
 * prompt. Drawn in screen space from the sketch coordinates, above the 3D
 * view.
 */
export function SketchOverlay({ host, store, viewport, sketchId, frame }: SketchOverlayProps) {
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
  // Re-render on every tool change.
  useStore(host.state, (s) => s.revision);
  // The Text panel writes its draft (string, font, alignment, height) to a store of its own,
  // not through the host: the preview it draws must follow every one of them.
  useStore(textDraftStore);
  const { tool, pointer, screen, error, construction } = host.state.getState();
  const doc = useStore(store, (s) => s.doc);

  const { width, height } = size;
  const toScreen = (p: Vec2): [number, number] | undefined => {
    if (width === 0 || height === 0) return undefined;
    const ndc = viewProject(view, projection, width / height, sketchToWorld(frame, p));
    return ndc && [((ndc[0] + 1) / 2) * width, ((1 - ndc[1]) / 2) * height];
  };

  const preview = tool?.preview();
  const fields = tool?.fields() ?? [];
  // Typed values place the point: inference doesn't apply, so don't show it.
  const typed = fields.some((f) => f.locked);
  const snap = typed ? undefined : pointer?.snap;
  const alignments = typed ? [] : (pointer?.alignments ?? []);
  const snapAt = snap && snap.kind !== 'grid' ? toScreen(snap.point) : undefined;
  const summary = useMemo(() => sketchSummary(doc, sketchId), [doc, sketchId]);
  const data = useMemo(() => {
    const feature = doc.features.find((f) => f.id === sketchId);
    return feature ? readSketch(feature)?.data : undefined;
  }, [doc, sketchId]);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  // The dimension being placed (the Dimension tool), drawn like the sketch's own.
  const placing = (() => {
    const d = preview?.dimension;
    const anchor = d && data && dimensionAnchor(data, d);
    const gap = anchor && pixelGap(toScreen, anchor);
    const shape = d && data && gap !== undefined ? dimensionShape(data, d, gap) : undefined;
    const at = shape && toScreen(shape.label);
    return d && data && shape && at
      ? { shape, at, text: dimensionText(d, measureDimension(data, d), doc.settings) }
      : undefined;
  })();

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
      data-sketch-summary={summary}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        width={width}
        height={height}
        aria-hidden="true"
      >
        {alignments.map((a) => {
          const from = toScreen(a.from);
          const to = pointer && toScreen(pointer.point);
          return (
            from &&
            to && (
              <line
                key={a.axis}
                data-guide={a.axis}
                x1={from[0]}
                y1={from[1]}
                x2={to[0]}
                y2={to[1]}
                stroke="var(--x-accent)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )
          );
        })}
        {preview?.guides?.map(([a, b], i) => {
          const p = toScreen(a);
          const q = toScreen(b);
          return (
            p &&
            q && (
              <line
                // biome-ignore lint/suspicious/noArrayIndexKey: preview guides have no identity.
                key={i}
                data-preview="guide"
                x1={p[0]}
                y1={p[1]}
                x2={q[0]}
                y2={q[1]}
                stroke="var(--x-muted)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )
          );
        })}
        {preview?.lines.map(([a, b], i) => {
          const p = toScreen(a);
          const q = toScreen(b);
          return (
            p &&
            q && (
              <line
                // biome-ignore lint/suspicious/noArrayIndexKey: preview segments have no identity.
                key={i}
                data-preview="line"
                x1={p[0]}
                y1={p[1]}
                x2={q[0]}
                y2={q[1]}
                {...curveStyle(construction)}
              />
            )
          );
        })}
        {preview?.arcs?.map((arc, i) => {
          // Projected point by point: on a tilted plane a circle is an ellipse on screen.
          const points = arcPolyline(arc).map(toScreen);
          if (points.some((p) => !p)) return null;
          return (
            <polyline
              // biome-ignore lint/suspicious/noArrayIndexKey: preview arcs have no identity.
              key={i}
              data-preview={arc.sweep === undefined ? 'circle' : 'arc'}
              points={points.map((p) => (p as number[]).join(',')).join(' ')}
              fill="none"
              {...curveStyle(construction)}
            />
          );
        })}
        {preview?.polylines?.map((line, i) => {
          const points = line.map(toScreen);
          if (points.some((p) => !p)) return null;
          return (
            <polyline
              // biome-ignore lint/suspicious/noArrayIndexKey: preview curves have no identity.
              key={i}
              data-preview="curve"
              points={points.map((p) => (p as number[]).join(',')).join(' ')}
              fill="none"
              {...curveStyle(construction)}
            />
          );
        })}
        {preview?.constructionArcs?.map((arc, i) => {
          const points = arcPolyline(arc).map(toScreen);
          if (points.some((p) => !p)) return null;
          return (
            <polyline
              // biome-ignore lint/suspicious/noArrayIndexKey: preview arcs have no identity.
              key={i}
              data-preview="construction"
              points={points.map((p) => (p as number[]).join(',')).join(' ')}
              fill="none"
              {...curveStyle(true)}
            />
          );
        })}
        {(['removed', 'accent'] as const).map((kind) =>
          preview?.[kind]?.map((line, i) => {
            const points = line.map(toScreen);
            if (points.some((p) => !p)) return null;
            return (
              <polyline
                // biome-ignore lint/suspicious/noArrayIndexKey: preview curves have no identity.
                key={`${kind}${i}`}
                data-preview={kind}
                points={points.map((p) => (p as number[]).join(',')).join(' ')}
                fill="none"
                stroke={kind === 'removed' ? 'var(--x-error)' : 'var(--x-accent)'}
                strokeWidth={kind === 'removed' ? 2.5 : 1.75}
                strokeDasharray={kind === 'removed' ? '5 3' : undefined}
              />
            );
          }),
        )}
        {preview?.points.map((a, i) => {
          const p = toScreen(a);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: preview points have no identity.
            p && <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill="var(--x-sketch)" />
          );
        })}
        {data &&
          preview?.picked?.map((id) => (
            <EntityHighlight key={id} data={data} id={id} toScreen={toScreen} width={3.5} />
          ))}
        {data && preview?.hover && (
          <g data-preview="hover">
            <EntityHighlight
              data={data}
              id={preview.hover}
              toScreen={toScreen}
              color="var(--x-accent)"
              width={2.5}
            />
          </g>
        )}
        {preview?.modelPicked?.map((m, i) => {
          const p = toScreen(m.point);
          // biome-ignore lint/suspicious/noArrayIndexKey: model picks in a preview have no identity.
          return p && <SnapGlyph key={`model${i}`} kind={modelGlyphKind(m.kind)} at={p} />;
        })}
        {preview?.modelHover &&
          (() => {
            const p = toScreen(preview.modelHover.point);
            return (
              p && (
                <g data-preview="model-hover">
                  <SnapGlyph kind={modelGlyphKind(preview.modelHover.kind)} at={p} />
                </g>
              )
            );
          })()}
        {placing && (
          <g data-preview="dimension">
            <DimensionGraphic shape={placing.shape} toScreen={toScreen} color="var(--x-accent)" />
          </g>
        )}
        {snap && snapAt && <SnapGlyph kind={snap.kind} at={snapAt} />}
      </svg>
      {placing && (
        <div
          data-preview="dimension-label"
          className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[4px] border border-accent px-1 font-mono text-xs leading-4 text-ink tabular-nums shadow-raised"
          style={{
            left: placing.at[0],
            top: placing.at[1],
            background: 'color-mix(in srgb, var(--x-raised) 92%, transparent)',
          }}
        >
          {placing.text}
        </div>
      )}
      {tool && fields.length > 0 && screen && (
        <HeadsUp
          host={host}
          fields={fields}
          evaluate={(expr, kind) => evaluation.evaluate(expr, kind)}
          settings={doc.settings}
          at={placeBox(screen, width, height)}
        />
      )}
      {tool && (
        <div
          role="status"
          aria-label="Tool prompt"
          className="absolute top-3 max-w-[60%] -translate-x-1/2 rounded-input border border-line px-3 py-1 text-sm shadow-raised"
          style={{
            left: 'calc(50% + var(--x-browser-inset, 0px) / 2)',
            background: 'color-mix(in srgb, var(--x-raised) 90%, transparent)',
          }}
        >
          {error ? <span className="text-error">{error}</span> : tool.prompt()}
        </div>
      )}
    </div>
  );
}

/** Preview curves: solid, or dashed for construction geometry. */
function curveStyle(construction: boolean) {
  return construction
    ? {
        stroke: 'var(--x-muted)',
        strokeWidth: 1.5,
        strokeDasharray: '6 4',
        'data-construction': true,
      }
    : { stroke: 'var(--x-sketch)', strokeWidth: 1.75 };
}

/** Counts for tests and debugging: "points=6 lines=3 … constraints=5 dimensions=0". */
export function sketchSummary(doc: ExtrudoDocument, id: FeatureId) {
  const feature = doc.features.find((f) => f.id === id);
  const data = feature && readSketch(feature)?.data;
  if (!data) return undefined;
  const count = (type: string) =>
    Object.values(data.entities).filter((e) => e.type === type).length;
  return [
    `points=${count('point')}`,
    `lines=${count('line')}`,
    `circles=${count('circle')}`,
    `arcs=${count('arc')}`,
    `ellipses=${count('ellipse')}`,
    `splines=${count('spline')}`,
    `constraints=${Object.keys(data.constraints).length}`,
    `dimensions=${Object.keys(data.dimensions).length}`,
  ].join(' ');
}

/** Width of the sketch palette's column on the right of the view, which the box keeps out of. */
const PALETTE_COLUMN = 264;

/** The heads-up box sits below and right of the pointer, inside the view and clear of the palette. */
function placeBox(screen: readonly [number, number], width: number, height: number) {
  const W = 200;
  const H = 120;
  const x = screen[0] + 20 + W > width - PALETTE_COLUMN ? screen[0] - 20 - W : screen[0] + 20;
  const y = screen[1] + 20 + H > height ? screen[1] - 20 - H : screen[1] + 20;
  return [Math.max(4, x), Math.max(4, y)] as const;
}

const SNAP_NAMES: Record<SnapKind, string> = {
  endpoint: 'Endpoint',
  center: 'Center',
  point: 'Point',
  origin: 'Origin',
  intersection: 'Intersection',
  midpoint: 'Midpoint',
  onCurve: 'On curve',
  grid: 'Grid',
};

/** The snap glyph a model pick draws as (a vertex a point, an edge an on-curve circle). */
function modelGlyphKind(kind: 'vertex' | 'edge'): SnapKind {
  return kind === 'vertex' ? 'point' : 'onCurve';
}

/** A small glyph at the snap point, one shape per kind (UI spec §4). */
function SnapGlyph({ kind, at: [x, y] }: { kind: SnapKind; at: readonly [number, number] }) {
  const s = 5;
  const common = {
    stroke: 'var(--x-accent)',
    strokeWidth: 1.5,
    fill: 'none',
  } as const;
  let shape: ReactNode;
  switch (kind) {
    case 'endpoint':
    case 'point':
    case 'origin':
      shape = <rect x={x - s} y={y - s} width={2 * s} height={2 * s} {...common} />;
      break;
    case 'center':
      shape = (
        <>
          <circle cx={x} cy={y} r={s + 1} {...common} />
          <circle cx={x} cy={y} r={1.5} fill="var(--x-accent)" />
        </>
      );
      break;
    case 'midpoint':
      shape = (
        <polygon
          points={`${x},${y - s - 1} ${x + s + 1},${y + s} ${x - s - 1},${y + s}`}
          {...common}
        />
      );
      break;
    case 'intersection':
      shape = (
        <path
          d={`M${x - s},${y - s}L${x + s},${y + s}M${x + s},${y - s}L${x - s},${y + s}`}
          {...common}
        />
      );
      break;
    case 'onCurve':
      shape = <circle cx={x} cy={y} r={s} {...common} />;
      break;
    case 'grid':
      shape = null;
      break;
  }
  return (
    <g data-snap={kind}>
      <title>{SNAP_NAMES[kind]}</title>
      {shape}
    </g>
  );
}

const TYPING = /^[0-9.+\-(]$/;

function HeadsUp({
  host,
  fields,
  evaluate,
  settings,
  at,
}: {
  host: ToolHost;
  fields: HeadsUpField[];
  evaluate: (expr: string, kind: UnitKind) => EvaluateResult;
  settings: ExtrudoDocument['settings'];
  at: readonly [number, number];
}) {
  const box = useRef<HTMLFieldSetElement>(null);

  // Typing a number while drawing goes straight into the first field (UI spec §3.4);
  // Tab moves into the box.
  useEffect(() => {
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
      if (event.key === 'Tab') {
        event.preventDefault();
        input.focus();
        input.select();
      } else if (TYPING.test(event.key)) {
        // Focus before the key's default action, so the character lands in the field.
        input.focus();
        input.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const shown = (field: HeadsUpField) => {
    if (field.locked) return field.locked.expr;
    const factor = field.kind === 'length' ? (UNITS[settings.units]?.factor ?? 1) : 1;
    const value = field.value / factor;
    return String(Number(value.toFixed(settings.precision)) + 0);
  };

  const onKeyDown = (field: HeadsUpField) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      // The field has committed and blurred by now.
      host.enter();
    } else if (event.key === 'Escape') {
      host.lock(field.name, undefined);
      (event.target as HTMLElement).blur();
    }
  };

  return (
    <fieldset
      ref={box}
      aria-label="Heads-up input"
      className="pointer-events-auto absolute m-0 flex w-[200px] flex-col gap-1 rounded-dialog border border-line p-2 shadow-raised"
      style={{
        left: at[0],
        top: at[1],
        background: 'color-mix(in srgb, var(--x-raised) 92%, transparent)',
      }}
    >
      {fields.map((field) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: forwards Enter and Esc from the field inside.
        <div
          key={field.name}
          className="grid grid-cols-[52px_minmax(0,1fr)] items-start gap-2"
          onKeyDown={onKeyDown(field)}
        >
          <span
            className={`pt-1 text-sm ${field.locked ? 'font-semibold text-ink' : 'text-muted'}`}
          >
            {field.label}
          </span>
          <ExpressionInput
            label={field.label}
            value={shown(field)}
            evaluate={(expr) => evaluate(expr, field.kind)}
            format={(r) => formatQuantity(r.value, r.dim, settings)}
            onDraftChange={(expr, valid) => {
              const result = evaluate(expr, field.kind);
              host.lock(field.name, valid && result.ok ? { expr, value: result.value } : undefined);
            }}
            // Only typing locks a field. Leaving a field commits its draft, which
            // for an untouched field is the live value from when it got focus.
            onCommit={() => {}}
          />
        </div>
      ))}
    </fieldset>
  );
}
