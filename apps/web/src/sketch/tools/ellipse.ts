/**
 * The Ellipse tool (P1-05, FR-SK-02): the center, the end of the first axis
 * (type its radius, Tab: angle), then the other radius (click or type).
 *
 * An ellipse is three points (ADR-0014): center, major end and minor end;
 * the solver keeps the minor end square to the major axis. If the second
 * radius comes out longer than the first, the axes swap roles, so the
 * clicked point becomes the minor end. Typed radii become distance
 * dimensions from the center to the axis ends.
 */
import {
  type DimensionId,
  ellipsePoint,
  ellipseShape,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import type { Inference } from '@extrudo/sketch/inference';
import { addPoint, place, typedEnd } from './build';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
  type Typed,
} from './tool';

export const ELLIPSE_TOOL = 'ellipse';

const DEG = Math.PI / 180;
const SEGMENTS = 96;

/** The ellipse being drawn: its three points, and which one the second click made. */
interface Shape {
  center: Vec2;
  major: Vec2;
  minor: Vec2;
  /** The second axis came out longer: the first click's axis is the minor one. */
  swapped: boolean;
}

export class EllipseTool implements SketchTool {
  readonly id = ELLIPSE_TOOL;
  #clicks: Inference[] = [];
  #pointer: Inference | undefined;
  #locks = new Map<string, Typed>();
  /** The first axis's typed radius, once placed. */
  #first: Typed | undefined;

  constructor(private readonly context: ToolContext) {}

  prompt(): string {
    return [
      'Click the center.',
      'Click the end of the first axis, or type its radius (Tab: angle).',
      'Click to set the other radius, or type it.',
    ][this.#clicks.length] as string;
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
    if (n === 1) {
      this.#placeAxis();
      return undefined;
    }
    return this.#finish();
  }

  enter(): SketchEdit | undefined {
    if (this.#locks.size === 0) return undefined;
    if (this.#clicks.length === 1) {
      this.#placeAxis();
      return undefined;
    }
    return this.#clicks.length === 2 ? this.#finish() : undefined;
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
    if (n === 1) {
      const c = this.#clicks[0]?.point as Vec2;
      const end = this.#axisEnd()?.point ?? c;
      const d: Vec2 = [end[0] - c[0], end[1] - c[1]];
      return [
        field('radius', 'Radius', 'length', Math.hypot(d[0], d[1])),
        field('angle', 'Angle', 'angle', Math.atan2(d[1], d[0]) / DEG + 0),
      ];
    }
    return [field('radius2', 'Radius', 'length', this.#secondRadius())];
  }

  lock(name: string, typed: Typed | undefined): void {
    if (typed && (name === 'angle' || typed.value > 0)) this.#locks.set(name, typed);
    else this.#locks.delete(name);
  }

  escape(): boolean {
    if (this.#locks.size > 0) {
      this.#locks.clear();
      return false;
    }
    if (this.#clicks.length > 0) {
      this.#clicks.pop();
      this.#first = undefined;
      return false;
    }
    return true;
  }

  preview(): ToolPreview {
    const n = this.#clicks.length;
    const c = this.#clicks[0]?.point;
    if (n === 1 && c) {
      const end = this.#axisEnd()?.point;
      return end ? { lines: [], guides: [[c, end]], points: [c, end] } : EMPTY_PREVIEW;
    }
    const shape = this.#shape();
    if (!shape) return c ? { lines: [], points: [c] } : EMPTY_PREVIEW;
    const e = ellipseShape(shape.center, shape.major, shape.minor);
    const curve = Array.from({ length: SEGMENTS + 1 }, (_, i) =>
      ellipsePoint(e, (2 * Math.PI * i) / SEGMENTS),
    );
    return {
      lines: [],
      polylines: [curve],
      points: [shape.center, shape.major, shape.minor],
      guides: [
        [shape.center, shape.major],
        [shape.center, shape.minor],
      ],
    };
  }

  /** The second click: the end of the first axis, at the pointer or the typed radius and angle. */
  #placeAxis(): void {
    const end = this.#axisEnd();
    const c = this.#clicks[0]?.point;
    if (!end || !c || Math.hypot(end.point[0] - c[0], end.point[1] - c[1]) < 1e-9) return;
    this.#clicks.push(end);
    this.#first = this.#locks.get('radius');
    this.#locks.clear();
  }

  #axisEnd(): Inference | undefined {
    const c = this.#clicks[0]?.point;
    const pointer = this.#pointer;
    if (!c || !pointer) return undefined;
    return typedEnd(c, pointer, this.#locks.get('radius'), this.#locks.get('angle'));
  }

  /** The other radius: typed, or the pointer's distance from the first axis. */
  #secondRadius(): number {
    const typed = this.#locks.get('radius2');
    if (typed) return typed.value;
    const [c, a] = this.#clicks.map((x) => x.point);
    const p = this.#pointer?.cursor;
    if (!c || !a || !p) return 0;
    const len = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cross = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
    return len === 0 ? 0 : Math.abs(cross) / len;
  }

  #shape(): Shape | undefined {
    const [c, a] = this.#clicks.map((x) => x.point);
    const p = this.#pointer?.cursor;
    if (!c || !a || !p) return undefined;
    const first = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const second = this.#secondRadius();
    if (first === 0 || second < 1e-9) return undefined;
    const u: Vec2 = [(a[0] - c[0]) / first, (a[1] - c[1]) / first];
    // The other axis goes to the pointer's side of the first.
    const side = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]) < 0 ? -1 : 1;
    const other: Vec2 = [c[0] - side * u[1] * second, c[1] + side * u[0] * second];
    return second > first
      ? { center: c, major: other, minor: a, swapped: true }
      : { center: c, major: a, minor: other, swapped: false };
  }

  #finish(): SketchEdit | undefined {
    const shape = this.#shape();
    if (!shape) return undefined;
    const e = ellipseShape(shape.center, shape.major, shape.minor);
    // Equal radii would be a circle: the major axis (and the solver's focus) would be undefined.
    if (e.a - e.b < 1e-6 * e.a) return undefined;
    const ctx = this.context;
    const edit = emptyEdit();
    const center = addPoint(edit, ctx, shape.center);
    const major = addPoint(edit, ctx, shape.major);
    const minor = addPoint(edit, ctx, shape.minor);
    const id = ctx.newId() as SketchEntityId;
    edit.entities[id] = { type: 'ellipse', center, major, minor, construction: ctx.construction() };

    const [firstEnd, secondEnd] = shape.swapped ? [minor, major] : [major, minor];
    place(edit, ctx, this.#clicks[0], center);
    place(edit, ctx, this.#clicks[1], firstEnd, { point: center });
    const radius = (typed: Typed | undefined, end: SketchEntityId) => {
      if (!typed) return;
      edit.dimensions[ctx.newId() as DimensionId] = {
        type: 'distance',
        orientation: 'aligned',
        a: center,
        b: end,
        expr: typed.expr,
        driven: false,
      };
    };
    radius(this.#first, firstEnd);
    radius(this.#locks.get('radius2'), secondEnd);

    this.#clicks = [];
    this.#locks.clear();
    this.#first = undefined;
    return edit;
  }
}
