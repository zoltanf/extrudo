/**
 * The polylines of the shown sketches' curves, sampled once per version of a
 * sketch's data (ADR-0156). Picking in the model measured against every curve
 * of every shown sketch on each pointer move and sampled them all again each
 * time; the drawing and Fit's bounds sampled them too. A cache belongs to one
 * view and keeps only the sketches it shows (`retain`), so the undo history,
 * which keeps old data objects alive, never keeps their samples.
 */
import {
  entityPolylines,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
} from '@extrudo/core';

/** A curve entity's polylines as flat x, y pairs, with the box around them all. */
export interface CurveLines {
  readonly lines: readonly Float64Array[];
  /** minX, minY, maxX, maxY; `undefined` without points or with a point that isn't finite. */
  readonly box: readonly [number, number, number, number] | undefined;
}

/** The polylines `entityPolylines` gives, flattened, with their box. Never kept. */
export function curveLinesOf(
  data: SketchData,
  entity: SketchEntity,
  id: SketchEntityId,
): CurveLines {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let finite = true;
  const lines = entityPolylines(data, entity, id).map((line) => {
    const flat = new Float64Array(line.length * 2);
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i] as [number, number];
      flat[2 * i] = x;
      flat[2 * i + 1] = y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) finite = false;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return flat;
  });
  const box: CurveLines['box'] =
    finite && minX <= maxX && minY <= maxY ? [minX, minY, maxX, maxY] : undefined;
  return { lines, box };
}

/** How the lines of one curve are found: a cache's `lines`, or `curveLinesOf` itself. */
export type CurveLinesOf = (
  data: SketchData,
  entity: SketchEntity,
  id: SketchEntityId,
) => CurveLines;

function frozenThrough(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  for (const inner of Object.values(value)) if (!frozenThrough(inner)) return false;
  return true;
}

/** Data checked to be frozen all the way through: it can never change again. */
const checked = new WeakSet<SketchData>();

function unchanging(data: SketchData): boolean {
  if (checked.has(data)) return true;
  if (!Object.isFrozen(data) || !Object.isFrozen(data.entities)) return false;
  for (const id in data.entities)
    if (!frozenThrough(data.entities[id as SketchEntityId])) return false;
  checked.add(data);
  return true;
}

/**
 * One view's polylines of its shown sketches. Only data frozen all the way
 * through is kept (the document's is; a builder's or a draft's is sampled
 * every time), and never a text's curves, which follow the fonts.
 */
export class SketchCurves {
  private readonly byData = new Map<SketchData, Map<SketchEntityId, CurveLines>>();
  /** Polylines sampled, kept or not (tests count the work). */
  sampled = 0;

  readonly lines: CurveLinesOf = (data, entity, id) => {
    if (entity.type === 'text' || !unchanging(data)) {
      this.sampled++;
      return curveLinesOf(data, entity, id);
    }
    let byId = this.byData.get(data);
    if (!byId) {
      byId = new Map();
      this.byData.set(data, byId);
    }
    let known = byId.get(id);
    if (!known) {
      this.sampled++;
      known = curveLinesOf(data, entity, id);
      byId.set(id, known);
    }
    return known;
  };

  /** Lets go of every sketch but these (the ones the view shows). */
  retain(shown: Iterable<SketchData>): void {
    const keep = new Set(shown);
    for (const data of this.byData.keys()) if (!keep.has(data)) this.byData.delete(data);
  }

  /** How many sketches' polylines are kept (tests). */
  get size(): number {
    return this.byData.size;
  }
}

/**
 * The distance from `x, y` to the nearest segment of a flat polyline, with the
 * arithmetic of `polylineDistance` (`@extrudo/sketch/inference`) so the same
 * curve wins a pick. Infinity for fewer than two points.
 */
export function flatPolylineDistance(line: Float64Array, x: number, y: number): number {
  let best = Infinity;
  for (let i = 2; i + 1 < line.length; i += 2) {
    const ax = line[i - 2] as number;
    const ay = line[i - 1] as number;
    const dx = (line[i] as number) - ax;
    const dy = (line[i + 1] as number) - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return best;
}

/**
 * Whether a curve with this box may lie within `reach` of `x, y`. A box further
 * away than `reach` (plus a margin for rounding) can't hold a nearer point, so
 * the curve is skipped; without a box it is always measured.
 */
export function boxWithin(box: CurveLines['box'], x: number, y: number, reach: number): boolean {
  if (!box) return true;
  const [minX, minY, maxX, maxY] = box;
  const dx = Math.max(minX - x, 0, x - maxX);
  const dy = Math.max(minY - y, 0, y - maxY);
  const scale = Math.max(Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY));
  const margin = 1e-9 * (1 + scale + Math.abs(x) + Math.abs(y) + reach);
  return !(Math.hypot(dx, dy) > reach + margin);
}
