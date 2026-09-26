/**
 * The Rectangle tool (P1-04, FR-SK-02) in three modes:
 *
 * - **2-point** (`R`): two opposite corners, axis-aligned.
 * - **3-point**: one edge from two clicks (any angle), then the height.
 * - **Center**: the center, then a corner; construction diagonals hold the
 *   center point in the middle.
 *
 * Four lines joined at their corners by coincident constraints. An
 * axis-aligned rectangle is horizontal and vertical; a 3-point one is
 * perpendicular and parallel. Typed widths, heights and lengths become
 * driving dimensions on the edges.
 */
import type { DimensionId, SketchConstraint, SketchEntityId, Vec2 } from '@extrudo/core';
import type { Inference } from '@extrudo/sketch/inference';
import { addLine, addPoint, axisOf, place, typedEnd } from './build';
import {
  constrain,
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
  type Typed,
} from './tool';

export const RECTANGLE_TOOL = 'rectangle';
export const RECTANGLE_3POINT_TOOL = 'rectangle3';
export const RECTANGLE_CENTER_TOOL = 'rectangleCenter';

export type RectangleMode = '2-point' | '3-point' | 'center';

const TOOL_IDS: Record<RectangleMode, string> = {
  '2-point': RECTANGLE_TOOL,
  '3-point': RECTANGLE_3POINT_TOOL,
  center: RECTANGLE_CENTER_TOOL,
};

const DEG = Math.PI / 180;

/** The four corners in drawing order, and what placed them. */
interface Corners {
  corners: [Vec2, Vec2, Vec2, Vec2];
  /** Inference behind each corner the user placed directly. */
  placed: (Inference | undefined)[];
  /** Typed dimensions: on edge 0 (corners 0–1) and edge 1 (corners 1–2). */
  dims: [Typed | undefined, Typed | undefined];
  /** Edge 0 along an axis (3-point: a typed angle or an alignment). */
  axis?: 'horizontal' | 'vertical';
}

export class RectangleTool implements SketchTool {
  readonly id: string;
  /** Points clicked so far. */
  #clicks: Inference[] = [];
  #pointer: Inference | undefined;
  #locks = new Map<string, Typed>();
  /** A 3-point rectangle's first edge, once placed: its typed length and axis. */
  #edge: { length?: Typed; axis?: 'horizontal' | 'vertical' } = {};

  constructor(
    private readonly context: ToolContext,
    readonly mode: RectangleMode = '2-point',
  ) {
    this.id = TOOL_IDS[mode];
  }

  prompt(): string {
    const n = this.#clicks.length;
    switch (this.mode) {
      case '2-point':
        return n === 0
          ? 'Click the first corner.'
          : 'Click the opposite corner, or type the width (Tab: height).';
      case '3-point':
        return n === 0
          ? 'Click the first corner.'
          : n === 1
            ? 'Click the end of the first edge, or type its length (Tab: angle).'
            : 'Click to set the height, or type it.';
      case 'center':
        return n === 0 ? 'Click the center.' : 'Click a corner, or type the width (Tab: height).';
    }
  }

  anchor(): Vec2 | undefined {
    // A 3-point rectangle's first edge aligns with its first corner; other
    // stages have no meaningful guide from the last click.
    return this.mode === '3-point' && this.#clicks.length === 1
      ? this.#clicks[0]?.point
      : undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    const needed = this.mode === '3-point' ? 2 : 1;
    if (this.#clicks.length < needed) {
      if (this.mode === '3-point' && this.#clicks.length === 1) this.#placeEdge();
      else {
        this.#clicks.push(pointer);
        this.#locks.clear();
      }
      return undefined;
    }
    return this.#finish();
  }

  enter(): SketchEdit | undefined {
    if (this.#locks.size === 0) return undefined;
    if (this.mode === '3-point' && this.#clicks.length === 1) {
      this.#placeEdge();
      return undefined;
    }
    return this.#finish();
  }

  /** A 3-point rectangle's second click: the first edge, with its typed length and angle. */
  #placeEdge(): void {
    const end = this.#edgeEnd();
    if (!end) return;
    const a = this.#clicks[0]?.point as Vec2;
    if (Math.hypot(end.point[0] - a[0], end.point[1] - a[1]) < 1e-9) return;
    this.#clicks.push(end);
    this.#edge = { length: this.#locks.get('length'), axis: axisOf(this.#locks.get('angle')) };
    this.#locks.clear();
  }

  fields(): HeadsUpField[] {
    const n = this.#clicks.length;
    if (n === 0 || !this.#pointer) return [];
    const field = (name: string, label: string, kind: 'length' | 'angle', value: number) => ({
      name,
      label,
      kind,
      value,
      locked: this.#locks.get(name),
    });
    if (this.mode === '3-point' && n === 1) {
      const a = this.#clicks[0]?.point as Vec2;
      const b = this.#edgeEnd()?.point ?? a;
      const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
      return [
        field('length', 'Length', 'length', Math.hypot(d[0], d[1])),
        field('angle', 'Angle', 'angle', Math.atan2(d[1], d[0]) / DEG + 0),
      ];
    }
    const r = this.#corners();
    if (!r) return [];
    const [c0, c1, c2] = r.corners;
    const w = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
    const h = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
    if (this.mode === '3-point') return [field('height', 'Height', 'length', h)];
    return [field('width', 'Width', 'length', w), field('height', 'Height', 'length', h)];
  }

  lock(name: string, typed: Typed | undefined): void {
    const positive = name !== 'angle';
    if (typed && (!positive || typed.value > 0)) this.#locks.set(name, typed);
    else this.#locks.delete(name);
  }

  escape(): boolean {
    if (this.#locks.size > 0) {
      this.#locks.clear();
      return false;
    }
    if (this.#clicks.length > 0) {
      this.#clicks.pop();
      if (this.#clicks.length < 2) this.#edge = {};
      return false;
    }
    return true;
  }

  preview(): ToolPreview {
    if (this.mode === '3-point' && this.#clicks.length === 1) {
      const a = this.#clicks[0]?.point as Vec2;
      const b = this.#edgeEnd()?.point;
      return b ? { lines: [[a, b]], points: [a, b] } : EMPTY_PREVIEW;
    }
    const r = this.#corners();
    if (!r) return EMPTY_PREVIEW;
    const [a, b, c, d] = r.corners;
    const preview: ToolPreview = {
      lines: [
        [a, b],
        [b, c],
        [c, d],
        [d, a],
      ],
      points: [a, b, c, d],
    };
    if (this.mode === 'center') {
      preview.guides = [
        [a, c],
        [b, d],
      ];
      preview.points.push(this.#clicks[0]?.point as Vec2);
    }
    return preview;
  }

  /** The end of a 3-point rectangle's first edge: the pointer, or the typed length and angle. */
  #edgeEnd(): Inference | undefined {
    const a = this.#clicks[0]?.point;
    const pointer = this.#pointer;
    if (!a || !pointer) return undefined;
    return typedEnd(a, pointer, this.#locks.get('length'), this.#locks.get('angle'));
  }

  #corners(): Corners | undefined {
    const pointer = this.#pointer;
    const first = this.#clicks[0];
    if (!pointer || !first) return undefined;
    const width = this.#locks.get('width');
    const height = this.#locks.get('height');
    const [ox, oy] = first.point;
    const typedCorner = !!(width || height);
    const corner = typedCorner ? pointer.cursor : pointer.point;
    const dx = corner[0] - ox;
    const dy = corner[1] - oy;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;

    if (this.mode === '2-point') {
      const w = width?.value ?? Math.abs(dx);
      const h = height?.value ?? Math.abs(dy);
      const c: Vec2 = [ox + sx * w, oy + sy * h];
      return {
        corners: [first.point, [c[0], oy], c, [ox, c[1]]],
        placed: [first, undefined, typedCorner ? undefined : pointer, undefined],
        dims: [width, height],
      };
    }
    if (this.mode === 'center') {
      const hx = (width?.value ?? 2 * Math.abs(dx)) / 2;
      const hy = (height?.value ?? 2 * Math.abs(dy)) / 2;
      const a: Vec2 = [ox - sx * hx, oy - sy * hy];
      const c: Vec2 = [ox + sx * hx, oy + sy * hy];
      return {
        corners: [a, [c[0], a[1]], c, [a[0], c[1]]],
        placed: [undefined, undefined, typedCorner ? undefined : pointer, undefined],
        dims: [width, height],
      };
    }
    // 3-point: the first edge from the two clicks, the height toward the pointer.
    const second = this.#clicks[1];
    if (!second) return undefined;
    const a = first.point;
    const b = second.point;
    const e: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(e[0], e[1]);
    if (len === 0) return undefined;
    let n: Vec2 = [-e[1] / len, e[0] / len];
    const side = (pointer.cursor[0] - b[0]) * n[0] + (pointer.cursor[1] - b[1]) * n[1];
    if (side < 0) n = [-n[0], -n[1]];
    const h = height?.value ?? Math.abs(side);
    const c: Vec2 = [b[0] + n[0] * h, b[1] + n[1] * h];
    const d: Vec2 = [a[0] + n[0] * h, a[1] + n[1] * h];
    return {
      corners: [a, b, c, d],
      placed: [first, second, undefined, undefined],
      dims: [this.#edge.length, height],
      axis: this.#edge.axis,
    };
  }

  #finish(): SketchEdit | undefined {
    const r = this.#corners();
    if (!r) return undefined;
    const [c0, c1, c2] = r.corners;
    const w = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
    const h = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
    if (w < 1e-9 || h < 1e-9) return undefined;

    const ctx = this.context;
    const edit = emptyEdit();
    const lines = [0, 1, 2, 3].map((i) =>
      addLine(edit, ctx, r.corners[i] as Vec2, r.corners[(i + 1) % 4] as Vec2),
    );
    const edge = (i: number) => lines[i] as (typeof lines)[number];
    const required: SketchConstraint[] = [];
    for (let i = 0; i < 4; i++) {
      required.push({ type: 'coincident', a: edge(i).end, b: edge((i + 1) % 4).start });
    }
    if (this.mode === '3-point') {
      required.push(
        { type: 'perpendicular', a: edge(0).id, b: edge(1).id },
        { type: 'parallel', a: edge(0).id, b: edge(2).id },
        { type: 'parallel', a: edge(1).id, b: edge(3).id },
      );
    } else {
      required.push(
        { type: 'horizontal', a: edge(0).id },
        { type: 'vertical', a: edge(1).id },
        { type: 'horizontal', a: edge(2).id },
        { type: 'vertical', a: edge(3).id },
      );
    }
    constrain(edit, ctx, required, false);
    if (r.axis) constrain(edit, ctx, [{ type: r.axis, a: edge(0).id }], true);

    // Corners the user placed keep what they snapped to.
    // A 3-point rectangle's second corner aligned with its first makes edge 0 level.
    r.placed.forEach((inference, i) => {
      if (inference)
        place(edit, ctx, inference, edge(i).start, i === 1 ? { line: edge(0).id } : {});
    });

    if (this.mode === 'center') {
      // Two construction diagonals; the center point sits in the middle of one.
      const diagonals: ToolContext = { ...ctx, construction: () => true };
      const ac = addLine(edit, diagonals, r.corners[0], r.corners[2]);
      const bd = addLine(edit, diagonals, r.corners[1], r.corners[3]);
      const center = addPoint(edit, ctx, this.#clicks[0]?.point as Vec2);
      constrain(
        edit,
        ctx,
        [
          { type: 'coincident', a: ac.start, b: edge(0).start },
          { type: 'coincident', a: ac.end, b: edge(2).start },
          { type: 'coincident', a: bd.start, b: edge(1).start },
          { type: 'coincident', a: bd.end, b: edge(3).start },
          { type: 'midpoint', point: center, of: ac.id },
        ],
        false,
      );
      place(edit, ctx, this.#clicks[0], center);
    }

    r.dims.forEach((typed, i) => {
      if (!typed) return;
      edit.dimensions[ctx.newId() as DimensionId] = {
        type: 'distance',
        orientation: 'aligned',
        a: edge(i).id as SketchEntityId,
        expr: typed.expr,
        driven: false,
      };
    });

    this.#clicks = [];
    this.#locks.clear();
    this.#edge = {};
    return edit;
  }
}
