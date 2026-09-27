import {
  CONSTRAINT_LABELS,
  type ConstraintId,
  constraintRefs,
  curvePolyline,
  type DocumentStore,
  type FeatureId,
  readSketch,
  type SessionStore,
  type SketchConstraintType,
  type SketchData,
  type SketchFrame,
  sketchToWorld,
  type Vec2,
} from '@extrudo/core';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { type IconName, ToolIcon } from '../../design-system';
import { viewProject } from '../../viewport/camera';
import type { ViewportStore } from '../../viewport/store';
import { GLYPH_SIZE, glyphAnchors, layoutGlyphs } from './glyphs';

export interface ConstraintGlyphsProps {
  store: DocumentStore;
  session: SessionStore;
  viewport: ViewportStore;
  sketchId: FeatureId;
  frame: SketchFrame;
  /** False while a tool runs: the glyphs show but clicks go to the tool. */
  interactive: boolean;
  /** Constraints that conflict or are redundant (P1-08): drawn red. */
  over?: readonly string[];
}

/** The icon of each constraint type; a point on a curve is a coincidence. */
const ICONS: Record<SketchConstraintType, IconName> = {
  coincident: 'coincident',
  pointOnCurve: 'coincident',
  collinear: 'collinear',
  concentric: 'concentric',
  midpoint: 'midpoint',
  fix: 'fix',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  horizontal: 'horizontal',
  vertical: 'vertical',
  tangent: 'tangent',
  smooth: 'smooth',
  equal: 'equal',
  symmetric: 'symmetric',
};

/**
 * The constraint glyphs of the open sketch (P1-06, FR-SK-07, UI spec §4):
 * a small icon next to each constrained entity (`glyphs.ts` places them).
 * Hovering a glyph highlights the entities it constrains and its other
 * glyphs; one that over-constrains the sketch is red (P1-08). Clicking selects the constraint (Shift or Ctrl adds or removes),
 * and Delete removes the selection (`sketch/selection.ts`). Glyphs of
 * constraints added while the sketch is open flash once.
 *
 * The layer lets the wheel and the middle and right buttons through to the
 * view (`data-view-passthrough`), so the camera still moves over a glyph.
 */
export function ConstraintGlyphs({
  store,
  session,
  viewport,
  sketchId,
  frame,
  interactive,
  over,
}: ConstraintGlyphsProps) {
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
  const data = useStore(store, (s) => {
    const feature = s.doc.features.find((f) => f.id === sketchId);
    return feature ? readSketch(feature)?.data : undefined;
  });
  const [hover, setHover] = useState<ConstraintId>();
  const anchors = useMemo(() => (data ? glyphAnchors(data) : []), [data]);

  // The constraints there when the layer opened don't flash; later ones do.
  const initial = useRef<Set<string>>(undefined);
  initial.current ??= new Set(Object.keys(data?.constraints ?? {}));

  const { width, height } = size;
  const toScreen = (p: Vec2): [number, number] | undefined => {
    if (width === 0 || height === 0) return undefined;
    const ndc = viewProject(view, projection, width / height, sketchToWorld(frame, p));
    return ndc && [((ndc[0] + 1) / 2) * width, ((1 - ndc[1]) / 2) * height];
  };
  const placed = layoutGlyphs(anchors, toScreen);
  const selected = new Set(selection.filter((s) => s.kind === 'constraint').map((s) => s.id));
  const bad = new Set(over);
  // A hovered constraint that has gone (undo) highlights nothing.
  const hovered = hover && data?.constraints[hover] ? hover : undefined;

  const seen = new Map<string, number>();
  const leave = (id: ConstraintId) => setHover((h) => (h === id ? undefined : h));

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[4] overflow-hidden"
      data-constraint-glyphs={placed.length}
    >
      {hovered && data && (
        <Highlight
          data={data}
          constraint={hovered}
          toScreen={toScreen}
          width={width}
          height={height}
        />
      )}
      {placed.map((g) => {
        // One constraint can have two glyphs; number them within it, so deleting
        // another constraint doesn't remount (and re-flash) this one.
        const nth = seen.get(g.constraint) ?? 0;
        seen.set(g.constraint, nth + 1);
        const isSelected = selected.has(g.constraint);
        const lit = g.constraint === hovered;
        const wrong = bad.has(g.constraint);
        const label = `${CONSTRAINT_LABELS[g.type]} constraint`;
        return (
          <button
            key={`${g.constraint}:${nth}`}
            type="button"
            tabIndex={-1}
            aria-label={label}
            aria-pressed={isSelected}
            title={CONSTRAINT_LABELS[g.type]}
            data-constraint={g.constraint}
            data-constraint-type={g.type}
            data-over={wrong || undefined}
            data-view-passthrough=""
            className={`absolute grid place-items-center rounded-[4px] border shadow-raised ${
              interactive ? 'pointer-events-auto cursor-pointer' : ''
            } ${isSelected ? 'border-accent bg-accent-soft' : lit ? 'border-accent' : wrong ? 'border-error' : 'border-line'} ${
              initial.current?.has(g.constraint) ? '' : 'x-glyph-new'
            }`}
            style={{
              left: g.x - GLYPH_SIZE / 2,
              top: g.y - GLYPH_SIZE / 2,
              width: GLYPH_SIZE,
              height: GLYPH_SIZE,
              background: isSelected
                ? undefined
                : 'color-mix(in srgb, var(--x-raised) 92%, transparent)',
            }}
            onPointerEnter={() => setHover(g.constraint)}
            onPointerLeave={() => leave(g.constraint)}
            onClick={(event) => {
              const add = event.shiftKey || event.ctrlKey || event.metaKey;
              session
                .getState()
                .select([{ kind: 'constraint', id: g.constraint }], add ? 'toggle' : 'replace');
            }}
          >
            <ToolIcon
              name={ICONS[g.type]}
              category="sketch"
              size={14}
              color={
                isSelected || lit ? 'var(--x-accent)' : wrong ? 'var(--x-error)' : 'var(--x-sketch)'
              }
            />
          </button>
        );
      })}
    </div>
  );
}

/** The hovered constraint's entities, in the pre-selection colour. */
function Highlight({
  data,
  constraint,
  toScreen,
  width,
  height,
}: {
  data: SketchData;
  constraint: ConstraintId;
  toScreen: (p: Vec2) => [number, number] | undefined;
  width: number;
  height: number;
}) {
  const c = data.constraints[constraint];
  if (!c) return null;
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      width={width}
      height={height}
      aria-hidden="true"
      data-highlight={constraint}
    >
      {constraintRefs(c).map((id) => (
        <EntityHighlight key={id} data={data} id={id} toScreen={toScreen} />
      ))}
    </svg>
  );
}

/** One entity drawn highlighted: a ring for a point, a thick stroke for a curve. */
export function EntityHighlight({
  data,
  id,
  toScreen,
  color = 'var(--x-accent)',
  width = 3,
}: {
  data: SketchData;
  id: string;
  toScreen: (p: Vec2) => [number, number] | undefined;
  color?: string;
  width?: number;
}) {
  const entity = data.entities[id as keyof SketchData['entities']];
  if (!entity) return null;
  if (entity.type === 'point') {
    const p = toScreen([entity.x, entity.y]);
    return (
      p && (
        <circle
          data-highlight-entity={id}
          cx={p[0]}
          cy={p[1]}
          r={4.5}
          fill="none"
          stroke={color}
          strokeWidth={2}
        />
      )
    );
  }
  const points = (curvePolyline(data, entity) ?? []).map(toScreen);
  if (points.length < 2 || points.some((p) => !p)) return null;
  return (
    <polyline
      data-highlight-entity={id}
      points={points.map((p) => (p as number[]).join(',')).join(' ')}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.85}
    />
  );
}
