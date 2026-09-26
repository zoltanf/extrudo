/**
 * The Circle tool (P1-04, FR-SK-02) in three modes:
 *
 * - **Center** (`C`): the center, then a point on the rim; type the diameter.
 * - **2-point**: the two ends of a diameter.
 * - **3-point**: three points on the rim.
 *
 * A rim point that snapped to a sketch point puts that point on the circle.
 * A typed diameter becomes a driving diameter dimension.
 */
import type { DimensionId, Vec2 } from '@extrudo/core';
import { type CircleShape, circleThrough, type Inference } from '@extrudo/sketch/inference';
import { addCircle, place, throughPoint } from './build';
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

export const CIRCLE_TOOL = 'circle';
export const CIRCLE_2POINT_TOOL = 'circle2';
export const CIRCLE_3POINT_TOOL = 'circle3';

export type CircleMode = 'center' | '2-point' | '3-point';

const TOOL_IDS: Record<CircleMode, string> = {
  center: CIRCLE_TOOL,
  '2-point': CIRCLE_2POINT_TOOL,
  '3-point': CIRCLE_3POINT_TOOL,
};

const CLICKS: Record<CircleMode, number> = { center: 2, '2-point': 2, '3-point': 3 };

export class CircleTool implements SketchTool {
  readonly id: string;
  #clicks: Inference[] = [];
  #pointer: Inference | undefined;
  #diameter: Typed | undefined;

  constructor(
    private readonly context: ToolContext,
    readonly mode: CircleMode = 'center',
  ) {
    this.id = TOOL_IDS[mode];
  }

  prompt(): string {
    const n = this.#clicks.length;
    if (this.mode === 'center') {
      return n === 0 ? 'Click the center.' : 'Click a point on the circle, or type the diameter.';
    }
    if (this.mode === '2-point') {
      return n === 0
        ? 'Click one end of the diameter.'
        : 'Click the other end, or type the diameter.';
    }
    return [
      'Click the first point on the circle.',
      'Click the second point.',
      'Click the third point.',
    ][n] as string;
  }

  anchor(): Vec2 | undefined {
    return undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    if (this.#clicks.length < CLICKS[this.mode] - 1) {
      this.#clicks.push(pointer);
      return undefined;
    }
    return this.#finish();
  }

  enter(): SketchEdit | undefined {
    return this.#diameter ? this.#finish() : undefined;
  }

  fields(): HeadsUpField[] {
    if (this.mode === '3-point' || this.#clicks.length === 0) return [];
    const circle = this.#circle();
    return [
      {
        name: 'diameter',
        label: 'Diameter',
        kind: 'length',
        value: circle ? 2 * circle.radius : 0,
        locked: this.#diameter,
      },
    ];
  }

  lock(name: string, typed: Typed | undefined): void {
    if (name === 'diameter') this.#diameter = typed && typed.value > 0 ? typed : undefined;
  }

  escape(): boolean {
    if (this.#diameter) {
      this.#diameter = undefined;
      return false;
    }
    if (this.#clicks.length > 0) {
      this.#clicks.pop();
      return false;
    }
    return true;
  }

  preview(): ToolPreview {
    const circle = this.#circle();
    const points = this.#clicks.map((c) => c.point);
    if (!circle) {
      if (this.mode === '3-point' && points.length === 2) {
        return { lines: [[points[0] as Vec2, points[1] as Vec2]], points };
      }
      return points.length > 0 ? { lines: [], points } : EMPTY_PREVIEW;
    }
    const preview: ToolPreview = { lines: [], arcs: [circle], points: [...points, circle.center] };
    if (this.mode === 'center') {
      const rim = this.#rim();
      if (rim) preview.guides = [[circle.center, rim]];
    }
    return preview;
  }

  /** Where the pointer puts the rim (center mode) or the second end (2-point), with a typed diameter. */
  #rim(): Vec2 | undefined {
    const first = this.#clicks[0]?.point;
    const pointer = this.#pointer;
    if (!first || !pointer) return undefined;
    if (!this.#diameter) return pointer.point;
    const dx = pointer.cursor[0] - first[0];
    const dy = pointer.cursor[1] - first[1];
    const len = Math.hypot(dx, dy);
    const dir: Vec2 = len > 0 ? [dx / len, dy / len] : [1, 0];
    const reach = this.mode === 'center' ? this.#diameter.value / 2 : this.#diameter.value;
    return [first[0] + dir[0] * reach, first[1] + dir[1] * reach];
  }

  #circle(): CircleShape | undefined {
    const [a, b] = this.#clicks.map((c) => c.point);
    if (!a) return undefined;
    if (this.mode === '3-point') {
      const c = this.#pointer?.point;
      return b && c ? circleThrough(a, b, c) : undefined;
    }
    const rim = this.#rim();
    if (!rim) return undefined;
    if (this.mode === 'center') {
      const radius = Math.hypot(rim[0] - a[0], rim[1] - a[1]);
      return radius > 0 ? { center: a, radius } : undefined;
    }
    const radius = Math.hypot(rim[0] - a[0], rim[1] - a[1]) / 2;
    return radius > 0 ? { center: [(a[0] + rim[0]) / 2, (a[1] + rim[1]) / 2], radius } : undefined;
  }

  #finish(): SketchEdit | undefined {
    const circle = this.#circle();
    if (!circle || circle.radius < 1e-9) return undefined;
    const ctx = this.context;
    const edit = emptyEdit();
    const { id, center } = addCircle(edit, ctx, circle.center, circle.radius);
    // Points the user put on the rim; the pointer's only if no typed diameter moved it.
    const rim = this.mode === 'center' ? [] : [...this.#clicks];
    if (!this.#diameter) rim.push(this.#pointer as Inference);
    if (this.mode === 'center') place(edit, ctx, this.#clicks[0], center);
    for (const p of rim) throughPoint(edit, ctx, p.snap, id);
    if (this.#diameter) {
      edit.dimensions[ctx.newId() as DimensionId] = {
        type: 'diameter',
        curve: id,
        expr: this.#diameter.expr,
        driven: false,
      };
    }
    this.#clicks = [];
    this.#diameter = undefined;
    return edit;
  }
}
