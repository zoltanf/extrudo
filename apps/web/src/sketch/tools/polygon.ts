/**
 * The Polygon tool (P1-05, FR-SK-02): regular polygons in three modes.
 *
 * - **Inscribed**: the center, then a corner; the diameter is the circle
 *   through the corners.
 * - **Circumscribed**: the center, then the middle of an edge; the diameter
 *   is across the flats (a nut's wrench size, for an even count).
 * - **Edge**: the two ends of one edge, then a click on the side the
 *   polygon goes.
 *
 * Every polygon is n lines joined at the corners, all equal, with the
 * corners on a construction circle: 4 degrees of freedom (position, size,
 * rotation). The circumscribed mode adds the circle inside, concentric and
 * tangent to the first edge, which a typed diameter dimensions. The number
 * of sides is a heads-up field that stays set for the next polygon.
 */
import type { DimensionId, SketchConstraint, SketchEntityId, Vec2 } from '@extrudo/core';
import type { Inference } from '@extrudo/sketch/inference';
import { addCircle, addLine, axisOf, place, typedEnd } from './build';
import {
  constrain,
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  type PreviewArc,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
  type Typed,
} from './tool';

export const POLYGON_TOOL = 'polygon';
export const POLYGON_CIRCUMSCRIBED_TOOL = 'polygonCircumscribed';
export const POLYGON_EDGE_TOOL = 'polygonEdge';

export type PolygonMode = 'inscribed' | 'circumscribed' | 'edge';

const TOOL_IDS: Record<PolygonMode, string> = {
  inscribed: POLYGON_TOOL,
  circumscribed: POLYGON_CIRCUMSCRIBED_TOOL,
  edge: POLYGON_EDGE_TOOL,
};

export const DEFAULT_SIDES = 6;
export const MAX_SIDES = 64;

const DEG = Math.PI / 180;

/** A regular polygon: its corners in order, and the circle through them. */
interface Shape {
  corners: Vec2[];
  center: Vec2;
  /** Circumradius. */
  radius: number;
  /** Distance from the center to each edge. */
  apothem: number;
}

/** The regular n-gon around `center` with its first corner at `angle` (radians). */
function around(center: Vec2, radius: number, angle: number, n: number): Shape {
  const corners = Array.from({ length: n }, (_, k): Vec2 => {
    const t = angle + (2 * Math.PI * k) / n;
    return [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)];
  });
  return { corners, center, radius, apothem: radius * Math.cos(Math.PI / n) };
}

export class PolygonTool implements SketchTool {
  readonly id: string;
  #clicks: Inference[] = [];
  #pointer: Inference | undefined;
  #locks = new Map<string, Typed>();
  /** The side count; kept from one polygon to the next. */
  #sides: Typed | undefined;
  /** Edge mode: the first edge's typed length and whether a typed angle put it on an axis. */
  #edge: { length?: Typed; axis?: 'horizontal' | 'vertical' } = {};

  constructor(
    private readonly context: ToolContext,
    readonly mode: PolygonMode = 'inscribed',
  ) {
    this.id = TOOL_IDS[mode];
  }

  get sides(): number {
    return this.#sides?.value ?? DEFAULT_SIDES;
  }

  prompt(): string {
    const n = this.#clicks.length;
    switch (this.mode) {
      case 'inscribed':
        return n === 0 ? 'Click the center.' : 'Click a corner, or type the diameter (Tab: sides).';
      case 'circumscribed':
        return n === 0
          ? 'Click the center.'
          : 'Click the middle of an edge, or type the diameter across the flats (Tab: sides).';
      case 'edge':
        return n === 0
          ? 'Click the first corner.'
          : n === 1
            ? 'Click the end of the edge, or type its length (Tab: angle, sides).'
            : 'Click the side the polygon goes on.';
    }
  }

  anchor(): Vec2 | undefined {
    return this.#clicks.length === 1 ? this.#clicks[0]?.point : undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    const n = this.#clicks.length;
    if (n === 0) {
      this.#clicks.push(pointer);
      this.#locks.clear();
      return undefined;
    }
    if (this.mode === 'edge' && n === 1) {
      this.#placeEdge();
      return undefined;
    }
    return this.#finish();
  }

  enter(): SketchEdit | undefined {
    if (this.#locks.size === 0) return undefined;
    if (this.mode === 'edge' && this.#clicks.length === 1) {
      this.#placeEdge();
      return undefined;
    }
    return this.#clicks.length > 0 ? this.#finish() : undefined;
  }

  fields(): HeadsUpField[] {
    const n = this.#clicks.length;
    if (n === 0 || !this.#pointer) return [];
    const field = (name: string, label: string, kind: HeadsUpField['kind'], value: number) => ({
      name,
      label,
      kind,
      value,
      locked: this.#locks.get(name),
    });
    const sides: HeadsUpField = {
      name: 'sides',
      label: 'Sides',
      kind: 'unitless',
      value: this.sides,
      locked: this.#sides,
    };
    if (this.mode === 'edge') {
      if (n === 1) {
        const a = this.#clicks[0]?.point as Vec2;
        const b = this.#edgeEnd()?.point ?? a;
        const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
        return [
          field('length', 'Length', 'length', Math.hypot(d[0], d[1])),
          field('angle', 'Angle', 'angle', Math.atan2(d[1], d[0]) / DEG + 0),
          sides,
        ];
      }
      return [sides];
    }
    const shape = this.#shape();
    const across = shape ? 2 * (this.mode === 'inscribed' ? shape.radius : shape.apothem) : 0;
    return [field('diameter', 'Diameter', 'length', across), sides];
  }

  lock(name: string, typed: Typed | undefined): void {
    if (name === 'sides') {
      const whole = typed && Number.isInteger(typed.value);
      this.#sides = whole && typed.value >= 3 && typed.value <= MAX_SIDES ? typed : undefined;
    } else if (typed && (name === 'angle' || typed.value > 0)) this.#locks.set(name, typed);
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
    const n = this.#clicks.length;
    if (this.mode === 'edge' && n === 1) {
      const a = this.#clicks[0]?.point as Vec2;
      const b = this.#edgeEnd()?.point;
      return b ? { lines: [[a, b]], points: [a, b] } : EMPTY_PREVIEW;
    }
    const shape = this.#shape();
    if (!shape)
      return n > 0 ? { lines: [], points: this.#clicks.map((c) => c.point) } : EMPTY_PREVIEW;
    const { corners } = shape;
    const circles: PreviewArc[] = [{ center: shape.center, radius: shape.radius }];
    if (this.mode === 'circumscribed')
      circles.push({ center: shape.center, radius: shape.apothem });
    return {
      lines: corners.map((c, i) => [c, corners[(i + 1) % corners.length] as Vec2] as const),
      points: [...corners, shape.center],
      constructionArcs: circles,
    };
  }

  /** Edge mode's second click: the first edge, with its typed length and angle. */
  #placeEdge(): void {
    const end = this.#edgeEnd();
    const a = this.#clicks[0]?.point;
    if (!end || !a || Math.hypot(end.point[0] - a[0], end.point[1] - a[1]) < 1e-9) return;
    this.#clicks.push(end);
    this.#edge = { length: this.#locks.get('length'), axis: axisOf(this.#locks.get('angle')) };
    this.#locks.clear();
  }

  /** Edge mode: the end of the first edge, at the pointer or the typed length and angle. */
  #edgeEnd(): Inference | undefined {
    const a = this.#clicks[0]?.point;
    const pointer = this.#pointer;
    if (!a || !pointer) return undefined;
    return typedEnd(a, pointer, this.#locks.get('length'), this.#locks.get('angle'));
  }

  /** Where the pointer (or a typed diameter) puts the second point, from the center. */
  #reach(): { at: Vec2; distance: number; angle: number } | undefined {
    const c = this.#clicks[0]?.point;
    const pointer = this.#pointer;
    if (!c || !pointer) return undefined;
    const diameter = this.#locks.get('diameter');
    const p = diameter ? pointer.cursor : pointer.point;
    const angle = Math.atan2(p[1] - c[1], p[0] - c[0]);
    const distance = diameter ? diameter.value / 2 : Math.hypot(p[0] - c[0], p[1] - c[1]);
    return { at: p, distance, angle };
  }

  #shape(): Shape | undefined {
    const n = this.sides;
    if (this.mode === 'edge') {
      const [first, second] = this.#clicks;
      const pointer = this.#pointer;
      if (!first || !second || !pointer) return undefined;
      const a = first.point;
      const b = second.point;
      const e: Vec2 = [b[0] - a[0], b[1] - a[1]];
      const s = Math.hypot(e[0], e[1]);
      if (s === 0) return undefined;
      let normal: Vec2 = [-e[1] / s, e[0] / s];
      const side = (pointer.cursor[0] - a[0]) * normal[0] + (pointer.cursor[1] - a[1]) * normal[1];
      if (side < 0) normal = [-normal[0], -normal[1]];
      const apothem = s / 2 / Math.tan(Math.PI / n);
      const center: Vec2 = [
        (a[0] + b[0]) / 2 + normal[0] * apothem,
        (a[1] + b[1]) / 2 + normal[1] * apothem,
      ];
      const radius = s / 2 / Math.sin(Math.PI / n);
      // Corners from `a` round through `b`: the turn from a to b around the center.
      const angle = Math.atan2(a[1] - center[1], a[0] - center[0]);
      const turn = Math.sign((a[0] - center[0]) * e[1] - (a[1] - center[1]) * e[0]) || 1;
      const corners = Array.from({ length: n }, (_, k): Vec2 => {
        const t = angle + (turn * 2 * Math.PI * k) / n;
        return [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)];
      });
      return { corners, center, radius, apothem };
    }
    const reach = this.#reach();
    const center = this.#clicks[0]?.point;
    if (!reach || !center || reach.distance < 1e-9) return undefined;
    if (this.mode === 'inscribed') return around(center, reach.distance, reach.angle, n);
    // Circumscribed: the pointer marks the middle of the first edge.
    const radius = reach.distance / Math.cos(Math.PI / n);
    return around(center, radius, reach.angle - Math.PI / n, n);
  }

  #finish(): SketchEdit | undefined {
    const shape = this.#shape();
    const pointer = this.#pointer;
    if (!shape || !pointer || shape.radius < 1e-9) return undefined;
    const ctx = this.context;
    const construction: ToolContext = { ...ctx, construction: () => true };
    const edit = emptyEdit();
    const n = shape.corners.length;
    const corner = (i: number) => shape.corners[i % n] as Vec2;
    const lines = shape.corners.map((_, i) => addLine(edit, ctx, corner(i), corner(i + 1)));
    const edge = (i: number) => lines[i % n] as (typeof lines)[number];
    const circle = addCircle(edit, construction, shape.center, shape.radius);

    const required: SketchConstraint[] = [];
    for (let i = 0; i < n; i++) {
      required.push(
        { type: 'coincident', a: edge(i).end, b: edge(i + 1).start },
        { type: 'pointOnCurve', point: edge(i).start, curve: circle.id },
      );
      if (i > 0) required.push({ type: 'equal', a: edge(0).id, b: edge(i).id });
    }
    let inner: SketchEntityId | undefined;
    if (this.mode === 'circumscribed') {
      const flats = addCircle(edit, construction, shape.center, shape.apothem);
      inner = flats.id;
      required.push(
        { type: 'concentric', a: circle.id, b: flats.id },
        { type: 'tangent', a: flats.id, b: edge(0).id },
      );
    }
    constrain(edit, ctx, required, false);

    const diameter = this.#locks.get('diameter');
    if (this.mode === 'edge') {
      place(edit, ctx, this.#clicks[0], edge(0).start);
      place(edit, ctx, this.#clicks[1], edge(0).end, { line: edge(0).id });
      if (this.#edge.axis) constrain(edit, ctx, [{ type: this.#edge.axis, a: edge(0).id }], true);
      const length = this.#edge.length;
      if (length) {
        edit.dimensions[ctx.newId() as DimensionId] = {
          type: 'distance',
          orientation: 'aligned',
          a: edge(0).id,
          expr: length.expr,
          driven: false,
        };
      }
    } else {
      place(edit, ctx, this.#clicks[0], circle.center);
      if (!diameter && this.mode === 'inscribed') {
        place(edit, ctx, pointer, edge(0).start, { point: circle.center });
      }
      if (!diameter && this.mode === 'circumscribed') {
        // Lined up with the center, the middle of the first edge makes that edge square to the guide.
        for (const a of pointer.alignments) {
          if (a.source.kind !== 'anchor') continue;
          const axis = a.axis === 'horizontal' ? 'vertical' : 'horizontal';
          constrain(edit, ctx, [{ type: axis, a: edge(0).id }], true);
        }
      }
      if (diameter) {
        edit.dimensions[ctx.newId() as DimensionId] = {
          type: 'diameter',
          curve: inner ?? circle.id,
          expr: diameter.expr,
          driven: false,
        };
      }
    }

    this.#clicks = [];
    this.#locks.clear();
    this.#edge = {};
    return edit;
  }
}
