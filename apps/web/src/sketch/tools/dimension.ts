/**
 * The Sketch Dimension tool (`D`, P1-07, FR-SK-08). It picks one or two
 * entities, works out which dimension they mean, and places it where the
 * next click is:
 *
 * - a line: its length (click on empty space to place it); a second line
 *   makes an angle, or the distance if the lines are parallel; a point makes
 *   the point's distance to the line;
 * - a circle: its diameter; an arc: its radius;
 * - two points: their distance.
 *
 * A length or a distance between points is horizontal or vertical when the
 * label is placed beside the geometry's extent, aligned otherwise; an
 * angle's label picks the pair of angles between the lines. The new
 * dimension drives the sketch at its measured value (rounded to the
 * document precision), and the host opens its value for editing
 * (`SketchEdit.editDimension`). If it would over-constrain the sketch, the
 * host asks whether to add it as driven (P1-08).
 */
import {
  type DimensionId,
  lineCrossing,
  lineEnds,
  measureDimension,
  type SketchData,
  type SketchDimension,
  type SketchEntity,
  type SketchEntityId,
  UNITS,
  type Vec2,
} from '@extrudo/core';
import type { Inference } from '@extrudo/sketch/inference';
import { labelOffset } from './dimensionLayout';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
} from './tool';

export const DIMENSION_TOOL = 'dimension';

interface Pick {
  id: SketchEntityId;
  entity: SketchEntity;
}

/** Lines closer to parallel than this (sine of the angle) get a distance, not an angle. */
const PARALLEL = 1e-6;

export class DimensionTool implements SketchTool {
  readonly id = DIMENSION_TOOL;
  readonly picks = true;
  #picked: Pick[] = [];
  #hover: SketchEntityId | undefined;
  #cursor: Vec2 | undefined;

  constructor(private readonly context: ToolContext) {}

  prompt(): string {
    const [first, second] = this.#picked;
    if (!first) return 'Pick a line, circle or arc to dimension, or a point.';
    if (second || first.entity.type === 'circle' || first.entity.type === 'arc') {
      return 'Click to place the dimension.';
    }
    if (first.entity.type === 'line') {
      return 'Click to place the length, or pick a second line or a point.';
    }
    return 'Pick a second point, or a line.';
  }

  anchor(): Vec2 | undefined {
    return undefined;
  }

  move(pointer: Inference): void {
    this.#cursor = pointer.cursor;
    this.#hover = this.#placing() ? undefined : this.#pickAt(pointer.cursor);
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#cursor = pointer.cursor;
    if (!this.#placing()) {
      const id = this.#pickAt(pointer.cursor);
      const entity = id && this.context.sketch().entities[id];
      if (id && entity) {
        this.#picked.push({ id, entity });
        this.#hover = undefined;
        return undefined;
      }
      // Empty space after a line places its length; otherwise a click needs a pick.
      if (this.#picked[0]?.entity.type !== 'line') return undefined;
    }
    const dimension = this.#candidate(pointer.cursor);
    this.#picked = [];
    this.#hover = undefined;
    if (!dimension) return undefined;
    const edit = emptyEdit();
    const id = this.context.newId() as DimensionId;
    edit.dimensions[id] = dimension;
    edit.verify = [id];
    edit.editDimension = id;
    return edit;
  }

  enter(): undefined {
    return undefined;
  }

  fields(): HeadsUpField[] {
    return [];
  }

  lock(): void {}

  escape(): boolean {
    if (this.#picked.length === 0) return true;
    this.#picked = [];
    this.#hover = undefined;
    return false;
  }

  preview(): ToolPreview {
    if (this.#picked.length === 0 && !this.#hover) return EMPTY_PREVIEW;
    const dimension = this.#cursor && this.#candidate(this.#cursor);
    return {
      ...EMPTY_PREVIEW,
      picked: this.#picked.map((p) => p.id),
      hover: this.#hover,
      dimension,
    };
  }

  /** The picks make a dimension without another pick (a circle, an arc, two entities). */
  #placing(): boolean {
    const [first, second] = this.#picked;
    return second !== undefined || first?.entity.type === 'circle' || first?.entity.type === 'arc';
  }

  #pickAt(cursor: Vec2): SketchEntityId | undefined {
    const taken = new Set(this.#picked.map((p) => p.id));
    const first = this.#picked[0]?.entity.type;
    return this.context.pick(cursor, (entity, id) => {
      if (taken.has(id)) return false;
      if (!first) return ['point', 'line', 'circle', 'arc'].includes(entity.type);
      return entity.type === 'point' || entity.type === 'line';
    });
  }

  /** The dimension the picks make with its label at `cursor`, at its measured value. */
  #candidate(cursor: Vec2): SketchDimension | undefined {
    const sketch = this.context.sketch();
    const shape = this.#shape(sketch, cursor);
    if (!shape) return undefined;
    const value = measureDimension(sketch, shape);
    if (value === undefined) return undefined;
    const { units, precision } = this.context.settings();
    const factor = shape.type === 'angle' ? 1 : (UNITS[units]?.factor ?? 1);
    const expr = String(Number((value / factor).toFixed(precision)) + 0);
    const dimension = { ...shape, expr };
    const label = labelOffset(sketch, dimension, cursor);
    return label ? { ...dimension, label } : dimension;
  }

  #shape(sketch: SketchData, cursor: Vec2): SketchDimension | undefined {
    const [first, second] = this.#picked;
    if (!first) return undefined;
    const base = { expr: '', driven: false };
    if (first.entity.type === 'circle') return { type: 'diameter', curve: first.id, ...base };
    if (first.entity.type === 'arc') return { type: 'radius', curve: first.id, ...base };
    // A line alone: the second pick may still come; until then, its length.
    const b = second ?? (first.entity.type === 'line' ? undefined : this.#hoverPick());
    if (first.entity.type === 'line' && !b) {
      const ends = lineEnds(sketch, first.id);
      const orientation = ends ? orient(ends[0], ends[1], cursor) : 'aligned';
      return { type: 'distance', orientation, a: first.id, ...base };
    }
    if (!b) return undefined;
    if (first.entity.type === 'point' && b.entity.type === 'point') {
      const p: Vec2 = [first.entity.x, first.entity.y];
      const q: Vec2 = [b.entity.x, b.entity.y];
      return {
        type: 'distance',
        orientation: orient(p, q, cursor),
        a: first.id,
        b: b.id,
        ...base,
      };
    }
    if (first.entity.type === 'line' && b.entity.type === 'line') {
      const la = lineEnds(sketch, first.id);
      const lb = lineEnds(sketch, b.id);
      const crossing = la && lb && lineCrossing(la, lb);
      if (!la || !lb || !crossing || parallel(la, lb)) {
        return { type: 'distance', orientation: 'aligned', a: first.id, b: b.id, ...base };
      }
      // The label's sector: the angle between the directions, or its supplement.
      const u = sub(la[1], la[0]);
      const v = sub(lb[1], lb[0]);
      const w = sub(cursor, crossing);
      const det = u[0] * v[1] - u[1] * v[0];
      const x = (w[0] * v[1] - w[1] * v[0]) / det;
      const y = (u[0] * w[1] - u[1] * w[0]) / det;
      const supplement = x < 0 !== y < 0;
      return {
        type: 'angle',
        a: first.id,
        b: b.id,
        ...(supplement ? { supplement } : {}),
        ...base,
      };
    }
    return { type: 'distance', orientation: 'aligned', a: first.id, b: b.id, ...base };
  }

  #hoverPick(): Pick | undefined {
    const id = this.#hover;
    const entity = id && this.context.sketch().entities[id];
    return id && entity ? { id, entity } : undefined;
  }
}

/**
 * Horizontal when the label is above or below the span between `p` and
 * `q`, vertical when it is left or right of it, aligned elsewhere (on the
 * slant, or beyond both).
 */
function orient(p: Vec2, q: Vec2, cursor: Vec2): 'aligned' | 'horizontal' | 'vertical' {
  const inX = cursor[0] >= Math.min(p[0], q[0]) && cursor[0] <= Math.max(p[0], q[0]);
  const inY = cursor[1] >= Math.min(p[1], q[1]) && cursor[1] <= Math.max(p[1], q[1]);
  const flat = Math.abs(p[1] - q[1]) < 1e-9;
  const upright = Math.abs(p[0] - q[0]) < 1e-9;
  // A horizontal or vertical pair measures the same aligned.
  if (flat || upright) return 'aligned';
  if (inX && !inY) return 'horizontal';
  if (inY && !inX) return 'vertical';
  return 'aligned';
}

function parallel(a: readonly [Vec2, Vec2], b: readonly [Vec2, Vec2]): boolean {
  const u = sub(a[1], a[0]);
  const v = sub(b[1], b[0]);
  const scale = Math.hypot(...u) * Math.hypot(...v);
  return scale === 0 || Math.abs(u[0] * v[1] - u[1] * v[0]) < PARALLEL * scale;
}

const sub = (a: Vec2, b: Vec2): [number, number] => [a[0] - b[0], a[1] - b[1]];
