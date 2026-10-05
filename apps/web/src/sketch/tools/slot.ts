/**
 * The Slot tool (P1-05, FR-SK-02) in two modes:
 *
 * - **Center to center**: the two arc centers, then the width.
 * - **Overall**: the two ends of the slot, then the width.
 *
 * A slot is two lines and two half circles, joined and tangent all round,
 * with equal radii, plus a construction centerline: 5 degrees of freedom
 * (both centers and the width). The centerline runs between the arc centers
 * (center mode) or between the slot's ends, with the centers on it (overall),
 * so a typed length dimensions it either way. A typed width is the distance
 * between the two lines.
 */
import type { DimensionId, SketchEntityId, Vec2 } from '@extrudo/core';
import {
  axisOf,
  constrain,
  place,
  type SlotShape,
  slotEdit,
  slotOutline,
  slotShape,
  typedEnd,
} from '@extrudo/sketch/build';
import type { Inference } from '@extrudo/sketch/inference';
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

export const SLOT_TOOL = 'slot';
export const SLOT_OVERALL_TOOL = 'slotOverall';

export type SlotMode = 'center' | 'overall';

const DEG = Math.PI / 180;

export class SlotTool implements SketchTool {
  readonly id: string;
  #clicks: Inference[] = [];
  #pointer: Inference | undefined;
  #locks = new Map<string, Typed>();
  /** The centerline's typed length and whether a typed angle put it on an axis. */
  #axis: { length?: Typed; along?: 'horizontal' | 'vertical' } = {};

  constructor(
    private readonly context: ToolContext,
    readonly mode: SlotMode = 'center',
  ) {
    this.id = mode === 'center' ? SLOT_TOOL : SLOT_OVERALL_TOOL;
  }

  prompt(): string {
    const n = this.#clicks.length;
    const what = this.mode === 'center' ? 'center' : 'end';
    return n === 0
      ? `Click the first ${what}.`
      : n === 1
        ? `Click the second ${what}, or type the length (Tab: angle).`
        : 'Click to set the width, or type it.';
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
      this.#placeSecond();
      return undefined;
    }
    return this.#finish();
  }

  enter(): SketchEdit | undefined {
    if (this.#locks.size === 0) return undefined;
    if (this.#clicks.length === 1) {
      this.#placeSecond();
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
      const a = this.#clicks[0]?.point as Vec2;
      const b = this.#secondEnd()?.point ?? a;
      const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
      return [
        field('length', 'Length', 'length', Math.hypot(d[0], d[1])),
        field('angle', 'Angle', 'angle', Math.atan2(d[1], d[0]) / DEG + 0),
      ];
    }
    return [field('width', 'Width', 'length', 2 * this.#halfWidth())];
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
      this.#axis = {};
      return false;
    }
    return true;
  }

  preview(): ToolPreview {
    const n = this.#clicks.length;
    if (n === 1) {
      const a = this.#clicks[0]?.point as Vec2;
      const b = this.#secondEnd()?.point;
      return b ? { lines: [], guides: [[a, b]], points: [a, b] } : EMPTY_PREVIEW;
    }
    const shape = this.#shape();
    if (!shape) {
      const points = this.#clicks.map((c) => c.point);
      return points.length > 0 ? { lines: [], points } : EMPTY_PREVIEW;
    }
    const o = slotOutline(shape);
    return {
      lines: [o.a, o.b],
      arcs: [o.arc1, o.arc2],
      points: [shape.c1, shape.c2],
      guides: [shape.axis],
    };
  }

  /** The second click: the other center or end, with the typed length and angle. */
  #placeSecond(): void {
    const end = this.#secondEnd();
    const a = this.#clicks[0]?.point;
    if (!end || !a || Math.hypot(end.point[0] - a[0], end.point[1] - a[1]) < 1e-9) return;
    this.#clicks.push(end);
    this.#axis = { length: this.#locks.get('length'), along: axisOf(this.#locks.get('angle')) };
    this.#locks.clear();
  }

  #secondEnd(): Inference | undefined {
    const a = this.#clicks[0]?.point;
    const pointer = this.#pointer;
    if (!a || !pointer) return undefined;
    return typedEnd(a, pointer, this.#locks.get('length'), this.#locks.get('angle'));
  }

  /** Half the width: typed, or the pointer's distance from the line through the two clicks. */
  #halfWidth(): number {
    const width = this.#locks.get('width');
    if (width) return width.value / 2;
    const [a, b] = this.#clicks.map((c) => c.point);
    const p = this.#pointer?.cursor;
    if (!a || !b || !p) return 0;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    return len === 0 ? 0 : Math.abs(cross) / len;
  }

  /** The outline, from the two clicks and the width: centres in centre mode, ends in overall. */
  #shape(): SlotShape | undefined {
    const [a, b] = this.#clicks.map((c) => c.point);
    if (!a || !b) return undefined;
    return slotShape(a, b, this.#halfWidth(), this.mode === 'overall');
  }

  #finish(): SketchEdit | undefined {
    const shape = this.#shape();
    if (!shape) return undefined;
    const ctx = this.context;
    const edit = emptyEdit();
    // The two lines, two arcs, their tangencies and the construction centerline
    // (ADR-0068 §5: the same builder `k.slot(…)` uses).
    const { outline: o, centerline } = slotEdit(
      edit,
      ctx,
      shape,
      this.mode === 'center' ? 'centers' : 'ends',
    );
    const { lineA, lineB } = o;

    place(edit, ctx, this.#clicks[0], centerline.start);
    place(edit, ctx, this.#clicks[1], centerline.end, { line: centerline.id });
    if (this.#axis.along)
      constrain(edit, ctx, [{ type: this.#axis.along, a: centerline.id }], true);

    const dimension = (typed: Typed | undefined, a: SketchEntityId, b?: SketchEntityId) => {
      if (!typed) return;
      edit.dimensions[ctx.newId() as DimensionId] = {
        type: 'distance',
        orientation: 'aligned',
        a,
        ...(b ? { b } : {}),
        expr: typed.expr,
        driven: false,
      };
    };
    dimension(this.#axis.length, centerline.id);
    dimension(this.#locks.get('width'), lineA.id, lineB.id);

    this.#clicks = [];
    this.#locks.clear();
    this.#axis = {};
    return edit;
  }
}
