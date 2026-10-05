/**
 * Placed text curves (P4-03, ADR-0058 §1–2): a `text` entity laid out with
 * the registered shaper (`@extrudo/sketch/text`, opentype.js — never imported
 * here) and placed in sketch coordinates by its two points. The entity
 * itself maps to nothing in the solver; everything that turns entities into
 * curves expands it into these sub-curves, whose IDs (`<text id>.<k>`) the
 * profile detection, the kernel's faces and the region references all use.
 */

import type { SketchEntityId } from '../ids';
import type { ExtrudoDocument } from '../schema';
import { curvePolyline, splinePolyline } from './curves';
import { readSketch } from './feature';
import type { Vec2 } from './planes';
import type { SketchData, SketchEntity } from './schema';
import type { TextShaper } from './text-layout';

export type TextCurveId = `${string}.${number}`;

export type TextCurve =
  | { id: TextCurveId; kind: 'line'; a: Vec2; b: Vec2 }
  | { id: TextCurveId; kind: 'spline'; degree: 2 | 3; poles: Vec2[]; knots: number[] };

export interface PlacedText {
  /** Fixed order: line, glyph, contour, segment. */
  curves: TextCurve[];
  /** The curve IDs of each closed contour, in order. */
  contours: TextCurveId[][];
  status: 'ok' | 'no-font' | 'missing-glyphs' | 'empty';
  /** Characters the font has no glyph for (drawn as its .notdef). */
  missing: string[];
}

let shaper: TextShaper | undefined;
let cache = new WeakMap<SketchData, Map<SketchEntityId, PlacedText>>();

/**
 * The fonts a document's sketches use: every text entity's font ID (ADR-0058
 * §4). What a kernel is sent before it computes a design (`addFont`), so the
 * app and the headless CLI (ADR-0069) read the same list.
 */
export function usedFonts(doc: ExtrudoDocument): Set<string> {
  const out = new Set<string>();
  for (const feature of doc.features) {
    const sketch = readSketch(feature)?.data;
    if (!sketch) continue;
    for (const entity of Object.values(sketch.entities)) {
      if (entity.type === 'text') out.add(entity.font);
    }
  }
  return out;
}

/**
 * Sets the shaper used to lay out text (the app and the kernel worker call
 * it with `@extrudo/sketch/text`'s `shapeText`), or takes it away. Everything
 * placed so far is forgotten: a layout depends on the fonts loaded.
 */
export function registerTextShaper(next: TextShaper | undefined): void {
  shaper = next;
  cache = new WeakMap();
}

/** Anchor and top closer than this (mm) is no text at all. */
const MIN_HEIGHT = 1e-6;

/**
 * Lays out a text entity of `data` (ADR-0058 §1, §2). Never throws. Memoised
 * per sketch data object and entity ID.
 */
export function placeText(data: SketchData, id: SketchEntityId): PlacedText {
  let byId = cache.get(data);
  if (!byId) {
    byId = new Map();
    cache.set(data, byId);
  }
  let placed = byId.get(id);
  if (!placed) {
    placed = placeNew(data, id);
    byId.set(id, placed);
  }
  return placed;
}

/**
 * One polyline per curve of a text (lines as 2 points, splines through
 * `splinePolyline`), keyed by curve ID.
 */
export function textPolylines(data: SketchData, id: SketchEntityId): Map<TextCurveId, Vec2[]> {
  const out = new Map<TextCurveId, Vec2[]>();
  for (const curve of placeText(data, id).curves) {
    out.set(
      curve.id,
      curve.kind === 'line'
        ? [curve.a, curve.b]
        : splinePolyline({ degree: curve.degree, poles: curve.poles, knots: curve.knots }),
    );
  }
  return out;
}

/**
 * The polylines a curve entity draws as: one for every ordinary curve, one per
 * glyph curve for a `text` (P4-03, ADR-0058 §2). What picking, box selection
 * and the viewport's segments measure against. Empty for points, and for a
 * text without its font.
 */
export function entityPolylines(
  data: SketchData,
  entity: SketchEntity,
  id: SketchEntityId,
): Vec2[][] {
  if (entity.type === 'text') return [...textPolylines(data, id).values()];
  const line = entity.type === 'point' ? undefined : curvePolyline(data, entity);
  return line ? [line] : [];
}

const NONE: PlacedText = { curves: [], contours: [], status: 'empty', missing: [] };

function placeNew(data: SketchData, id: SketchEntityId): PlacedText {
  const entity = data.entities[id];
  if (entity?.type !== 'text') return NONE;
  if (!shaper) return { ...NONE, status: 'no-font' };
  const layout = shaper(entity.font, entity.text, entity.align);
  if (!layout) return { ...NONE, status: 'no-font' };

  const at = (ref: SketchEntityId): Vec2 | undefined => {
    const p = data.entities[ref];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  const anchor = at(entity.anchor);
  const top = at(entity.top);
  if (!anchor || !top) return NONE;
  const up: Vec2 = [top[0] - anchor[0], top[1] - anchor[1]];
  const height = Math.hypot(up[0], up[1]);
  if (height < MIN_HEIGHT) return NONE;
  const u: Vec2 = [up[0] / height, up[1] / height];
  // The baseline runs 90° clockwise from up.
  const b: Vec2 = [u[1], -u[0]];
  const place = (p: Vec2): Vec2 => [
    anchor[0] + height * (p[0] * b[0] + p[1] * u[0]),
    anchor[1] + height * (p[0] * b[1] + p[1] * u[1]),
  ];

  const curves: TextCurve[] = [];
  const contours: TextCurveId[][] = [];
  let k = 0;
  for (const contour of layout.contours) {
    const ids: TextCurveId[] = [];
    for (const segment of contour.segments) {
      const cid = `${id}.${k++}` as TextCurveId;
      if (segment.kind === 'line') {
        curves.push({ id: cid, kind: 'line', a: place(segment.a), b: place(segment.b) });
      } else {
        const degree = segment.points.length - 1;
        curves.push({
          id: cid,
          kind: 'spline',
          degree: degree as 2 | 3,
          poles: segment.points.map(place),
          knots: [...Array<0>(degree + 1).fill(0), ...Array<1>(degree + 1).fill(1)],
        });
      }
      ids.push(cid);
    }
    if (ids.length > 0) contours.push(ids);
  }
  if (curves.length === 0) return NONE;
  return {
    curves,
    contours,
    status: layout.missing.length > 0 ? 'missing-glyphs' : 'ok',
    missing: [...layout.missing],
  };
}
