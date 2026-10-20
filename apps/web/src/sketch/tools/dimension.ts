/**
 * The Sketch Dimension tool (`D`, P1-07, FR-SK-08). It picks one or two
 * entities, works out which dimension they mean, and places it where the
 * next click is:
 *
 * - a line: its length (click on empty space to place it); a second line
 *   makes an angle, or the distance if the lines are parallel; a point makes
 *   the point's distance to the line; a datum axis with a parallel line or a
 *   point (ADR-0093) is placed by the second pick, with no placement click;
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
  isDatumRef,
  lineCrossing,
  lineEnds,
  measureDimension,
  type ProjectionId,
  projectionOf,
  type SketchData,
  type SketchDimension,
  type SketchEntity,
  type SketchEntityId,
  UNITS,
  type Vec2,
} from '@extrudo/core';
import type { Inference, ModelSnap } from '@extrudo/sketch/inference';
import { labelOffset, lineAxisCursor, pointAxisCursor } from './dimensionLayout';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  modelAttachments,
  modelStandIn,
  type SketchEdit,
  type SketchTool,
  storedDatumMarker,
  type ToolContext,
  type ToolPreview,
} from './tool';

export const DIMENSION_TOOL = 'dimension';

interface Pick {
  id: SketchEntityId;
  entity: SketchEntity;
  /** Set when the pick is a body edge or vertex (auto-project, P6-07 slice 2). */
  model?: ModelSnap;
  /** The stand-in entities a model pick needs to be measured before it is projected. */
  synthetic?: Record<SketchEntityId, SketchEntity>;
  /** The marker for a stored datum axis line (ADR-0093), drawn like a fresh axis pick. */
  marker?: ModelSnap;
}

/** Lines closer to parallel than this (sine of the angle) get a distance, not an angle. */
const PARALLEL = 1e-6;

export class DimensionTool implements SketchTool {
  readonly id = DIMENSION_TOOL;
  readonly picks = true;
  #picked: Pick[] = [];
  #hover: Pick | undefined;
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
      const pick = this.#pickAt(pointer.cursor);
      if (pick) {
        this.#picked.push(pick);
        this.#hover = undefined;
        // A datum distance has nothing left to decide: no placement click.
        const auto = this.#datumCursor();
        if (!auto) return undefined;
        return this.#commit(auto);
      }
      // Empty space after a line places its length; otherwise a click needs a pick.
      if (this.#picked[0]?.entity.type !== 'line') return undefined;
    }
    return this.#commit(pointer.cursor);
  }

  /** Commits the picks' dimension with its label at `cursor`. */
  #commit(cursor: Vec2): SketchEdit | undefined {
    const dimension = this.#candidate(cursor);
    const picks = this.#picked;
    this.#picked = [];
    this.#hover = undefined;
    if (!dimension) return undefined;
    const edit = emptyEdit();
    const id = this.context.newId() as DimensionId;
    edit.dimensions[id] = dimension;
    edit.verify = [id];
    edit.editDimension = id;
    edit.cursor = cursor;
    const models = modelAttachments(picks);
    if (models.length > 0) edit.models = models;
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
    const modelPicked = this.#picked
      .map((p) => p.model ?? p.marker)
      .filter((m): m is ModelSnap => m !== undefined);
    if (this.#picked.length === 0 && !this.#hover) return EMPTY_PREVIEW;
    // A line's length preview hides while a second pick is under the cursor
    // (ADR-0093): its label sits there and would cover the hover marker.
    const [first] = this.#picked;
    const second =
      this.#picked.length === 1 && first?.entity.type === 'line' && this.#hover !== undefined;
    const dimension = this.#cursor && !second ? this.#candidate(this.#cursor) : undefined;
    return {
      ...EMPTY_PREVIEW,
      picked: this.#picked.map((p) => p.id),
      hover: this.#hover?.id,
      dimension,
      ...((this.#hover?.model ?? this.#hover?.marker) && {
        modelHover: this.#hover?.model ?? this.#hover?.marker,
      }),
      ...(modelPicked.length > 0 && { modelPicked }),
    };
  }

  /** The picks make a dimension without another pick (a circle, an arc, two entities). */
  #placing(): boolean {
    const [first, second] = this.#picked;
    return second !== undefined || first?.entity.type === 'circle' || first?.entity.type === 'arc';
  }

  /**
   * The label position when the two picks are a datum axis and a point, or a
   * line parallel to it (ADR-0093): the distance needs no placement click.
   */
  #datumCursor(): Vec2 | undefined {
    const [first, second] = this.#picked;
    if (!first || !second || this.#picked.length !== 2) return undefined;
    const view = this.#view(this.context.sketch());
    const isAxis = (p: Pick) => {
      if (p.entity.type !== 'line') return false;
      if (p.model) return p.model.kind === 'axis';
      const ref = projectionOf(view, p.id)?.projection.ref;
      return ref !== undefined && isDatumRef(ref);
    };
    const [axis, other] = isAxis(second) && !isAxis(first) ? [second, first] : [first, second];
    if (!isAxis(axis) || isAxis(other)) return undefined;
    const axisEnds = lineEnds(view, axis.id);
    if (!axisEnds) return undefined;
    const step = 3 * (this.context.snapDistance?.() ?? 1);
    if (other.entity.type === 'point') {
      return pointAxisCursor([other.entity.x, other.entity.y], axisEnds, step);
    }
    const ends = lineEnds(view, other.id);
    return ends && parallel(ends, axisEnds) ? lineAxisCursor(ends, axisEnds, step) : undefined;
  }

  #pickAt(cursor: Vec2): Pick | undefined {
    const sketch = this.context.sketch();
    const taken = new Set(this.#picked.map((p) => p.id));
    const first = this.#picked[0];
    const firstType = first?.entity.type;
    // After a sketch line, an axis across it is left for the label (ADR-0093 §4: a
    // centred line's label lands on the other axis); only a parallel one is taken.
    const firstLine =
      first && firstType === 'line' && !first.model ? lineEnds(sketch, first.id) : undefined;
    const across = (line: readonly [Vec2, Vec2] | undefined) =>
      firstLine !== undefined && (!line || !parallel(firstLine, line));
    const accept = (entity: SketchEntity, id: SketchEntityId) => {
      if (taken.has(id)) return false;
      if (!firstType) return ['point', 'line', 'circle', 'arc'].includes(entity.type);
      if (entity.type === 'line' && firstLine) {
        const source = projectionOf(sketch, id)?.projection.ref;
        if (source && isDatumRef(source) && across(lineEnds(sketch, id))) return false;
      }
      return entity.type === 'point' || entity.type === 'line';
    };
    const id = this.context.pick(cursor, accept);
    if (id) {
      const entity = sketch.entities[id];
      if (entity) return { id, entity, marker: storedDatumMarker(sketch, id, cursor) };
    }
    // After a sketch line the next click may place the label, so a body edge
    // or vertex under it must not be taken as a second pick (P6-07 slice 2;
    // a model edge first pick still takes one, so two body edges can be
    // dimensioned against each other). The origin and a parallel axis are
    // taken (ADR-0093 §4): to place a length on one, click away from it.
    const model = this.context.pickModel(cursor);
    if (!model) return undefined;
    if (firstLine && model.kind !== 'point' && model.kind !== 'axis') return undefined;
    if (firstLine && model.kind === 'axis' && across(model.line)) return undefined;
    if (model.entityId) {
      const entity = sketch.entities[model.entityId];
      if (entity && accept(entity, model.entityId)) {
        return {
          id: model.entityId,
          entity,
          marker: storedDatumMarker(sketch, model.entityId, cursor),
        };
      }
      return undefined;
    }
    const stand = modelStandIn(this.context, model);
    return accept(stand.entity, stand.id)
      ? { id: stand.id, entity: stand.entity, model, synthetic: stand.synthetic }
      : undefined;
  }

  /** The sketch as the picks see it: their stand-in entities added for measuring. */
  #view(sketch: SketchData): SketchData {
    const picks = this.#hover ? [...this.#picked, this.#hover] : this.#picked;
    const extra: Record<string, SketchEntity> = {};
    let projections: SketchData['projections'];
    for (const pick of picks) {
      if (pick.synthetic) {
        Object.assign(extra, pick.synthetic);
        // A fresh datum pick stands in exactly for its projection (ADR-0093):
        // anchor and measure it like the stored axis it will become.
        if (pick.model && pick.entity.type === 'line' && isDatumRef(pick.model.ref)) {
          projections ??= { ...sketch.projections };
          projections[`view:${pick.id}` as ProjectionId] = {
            ref: pick.model.ref,
            curves: { axis: pick.id },
          };
        }
      }
    }
    if (Object.keys(extra).length === 0) return sketch;
    return {
      ...sketch,
      entities: { ...sketch.entities, ...extra },
      ...(projections && { projections }),
    };
  }

  /** The dimension the picks make with its label at `cursor`, at its measured value. */
  #candidate(cursor: Vec2): SketchDimension | undefined {
    const sketch = this.context.sketch();
    const view = this.#view(sketch);
    const shape = this.#shape(view, cursor);
    if (!shape) return undefined;
    const value = measureDimension(view, shape);
    if (value === undefined) return undefined;
    const { units, precision } = this.context.settings();
    const factor = shape.type === 'angle' ? 1 : (UNITS[units]?.factor ?? 1);
    const expr = String(Number((value / factor).toFixed(precision)) + 0);
    const dimension = { ...shape, expr };
    const label = labelOffset(view, dimension, cursor);
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
    return this.#hover;
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
