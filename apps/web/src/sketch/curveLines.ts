/**
 * The polylines of the shown sketches' curves, sampled once per version of a
 * sketch's data (ADR-0156). Picking in the model measured against every curve
 * of every shown sketch on each pointer move and sampled them all again each
 * time; the drawing and Fit's bounds sampled them too. A cache belongs to one
 * view and keeps only the sketches it shows (`retain`), so the undo history,
 * which keeps old data objects alive, never keeps their samples.
 *
 * What it keeps is lean: one flat array of points per sketch, with an offset
 * and a box per kept curve, and nothing for a line, a point, a text or a
 * polyline of fewer than `MIN_KEPT_POINTS` points (a line is measured from its
 * two end points, as cheap as reading a copy). So a view keeps at most about
 * the bytes the drawing keeps for the same curves (ADR-0156's amendment).
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
  readonly box: ArrayLike<number> | undefined;
}

const NO_LINES: CurveLines = Object.freeze({ lines: Object.freeze([]), box: undefined });

/** The box of `[x0, y0, x1, y1, …]`, or `undefined` without points or with one not finite. */
function boxOf(flat: Float64Array): [number, number, number, number] | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i] as number;
    const y = flat[i + 1] as number;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return minX <= maxX ? [minX, minY, maxX, maxY] : undefined;
}

/** The polylines `entityPolylines` gives, flattened, with their box. Never kept. */
export function curveLinesOf(
  data: SketchData,
  entity: SketchEntity,
  id: SketchEntityId,
): CurveLines {
  if (entity.type === 'point') return NO_LINES;
  const lines = entityPolylines(data, entity, id).map((line) => {
    const flat = new Float64Array(line.length * 2);
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i] as [number, number];
      flat[2 * i] = x;
      flat[2 * i + 1] = y;
    }
    return flat;
  });
  if (lines.length === 0) return NO_LINES;
  if (lines.length === 1) return { lines, box: boxOf(lines[0] as Float64Array) };
  const all = new Float64Array(lines.reduce((n, l) => n + l.length, 0));
  let at = 0;
  for (const l of lines) {
    all.set(l, at);
    at += l.length;
  }
  return { lines, box: boxOf(all) };
}

/** How the lines of one curve are found: a cache's `lines`, or `curveLinesOf` itself. */
export type CurveLinesOf = (
  data: SketchData,
  entity: SketchEntity,
  id: SketchEntityId,
) => CurveLines;

/**
 * A polyline of fewer points is not kept: what it would keep (its box, offset
 * and map entry) is more than twice the drawing's bytes for so few segments.
 */
export const MIN_KEPT_POINTS = 8;

/** What `keptBytes` counts for each kept curve's place in a sketch's map (key and slot). */
export const MAP_ENTRY_BYTES = 48;

/** The kept curves of one sketch: their points end to end, an offset and a box each. */
interface SketchEntry {
  /** Slot of each kept curve. */
  readonly slots: Map<SketchEntityId, number>;
  /** Where each slot's points start, in numbers (x and y); one more for the end. */
  readonly starts: Uint32Array;
  /** minX, minY, maxX, maxY per slot; NaN in the first for no box. */
  readonly boxes: Float64Array;
  readonly points: Float64Array;
}

/** A sketch of lines and points only: nothing to keep but the note that there is nothing. */
const NOTHING_KEPT: SketchEntry = {
  slots: new Map(),
  starts: new Uint32Array(0),
  boxes: new Float64Array(0),
  points: new Float64Array(0),
};

/** Whether `entity` is sampled once and kept (lines, points and texts never are). */
function keepable(entity: SketchEntity): boolean {
  return entity.type !== 'point' && entity.type !== 'line' && entity.type !== 'text';
}

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
 * every time), and never a text's curves, which follow the fonts. A sketch's
 * curves are all sampled together the first time one is asked for.
 */
export class SketchCurves {
  private readonly byData = new Map<SketchData, SketchEntry>();
  /** Polylines sampled, kept or not, and sketches whose kept curves were sampled (tests). */
  sampled = 0;
  built = 0;

  readonly lines: CurveLinesOf = (data, entity, id) => {
    if (entity.type === 'point') return NO_LINES;
    if (!keepable(entity) || !unchanging(data)) return this.fresh(data, entity, id);
    let entry = this.byData.get(data);
    if (!entry) {
      entry = this.build(data);
      this.byData.set(data, entry);
    }
    const slot = entry.slots.get(id);
    // A polyline too short to keep is sampled again: a few points.
    if (slot === undefined) return this.fresh(data, entity, id);
    const from = entry.starts[slot] as number;
    const to = entry.starts[slot + 1] as number;
    const box = entry.boxes.subarray(4 * slot, 4 * slot + 4);
    return {
      lines: [entry.points.subarray(from, to)],
      box: Number.isNaN(box[0] as number) ? undefined : box,
    };
  };

  private fresh(data: SketchData, entity: SketchEntity, id: SketchEntityId): CurveLines {
    this.sampled++;
    return curveLinesOf(data, entity, id);
  }

  private build(data: SketchData): SketchEntry {
    this.built++;
    const slots = new Map<SketchEntityId, number>();
    const kept: Float64Array[] = [];
    for (const key in data.entities) {
      const id = key as SketchEntityId;
      const entity = data.entities[id] as SketchEntity;
      if (!keepable(entity)) continue;
      this.sampled++;
      const { lines } = curveLinesOf(data, entity, id);
      const line = lines[0];
      if (lines.length !== 1 || !line || line.length < 2 * MIN_KEPT_POINTS) continue;
      slots.set(id, kept.length);
      kept.push(line);
    }
    if (kept.length === 0) return NOTHING_KEPT;
    const starts = new Uint32Array(kept.length + 1);
    let total = 0;
    for (let s = 0; s < kept.length; s++) {
      starts[s] = total;
      total += (kept[s] as Float64Array).length;
    }
    starts[kept.length] = total;
    const points = new Float64Array(total);
    const boxes = new Float64Array(4 * kept.length);
    for (let s = 0; s < kept.length; s++) {
      const line = kept[s] as Float64Array;
      points.set(line, starts[s] as number);
      const box = boxOf(line);
      if (box) boxes.set(box, 4 * s);
      else boxes[4 * s] = Number.NaN;
    }
    return { slots, starts, boxes, points };
  }

  /** Lets go of every sketch but these (the ones the view shows). */
  retain(shown: Iterable<SketchData>): void {
    const keep = new Set(shown);
    for (const data of this.byData.keys()) if (!keep.has(data)) this.byData.delete(data);
  }

  /** How many sketches' polylines are kept (tests). */
  get size(): number {
    return this.byData.size;
  }

  /** The bytes kept: the arrays' lengths and `MAP_ENTRY_BYTES` a kept curve (tests). */
  keptBytes(): number {
    let n = 0;
    for (const e of this.byData.values()) {
      n += e.points.byteLength + e.starts.byteLength + e.boxes.byteLength;
      n += e.slots.size * MAP_ENTRY_BYTES;
    }
    return n;
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
  const minX = box[0] as number;
  const minY = box[1] as number;
  const maxX = box[2] as number;
  const maxY = box[3] as number;
  const dx = Math.max(minX - x, 0, x - maxX);
  const dy = Math.max(minY - y, 0, y - maxY);
  const scale = Math.max(Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY));
  const margin = 1e-9 * (1 + scale + Math.abs(x) + Math.abs(y) + reach);
  return !(Math.hypot(dx, dy) > reach + margin);
}
