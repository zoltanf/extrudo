/**
 * The Arc tool (P1-04, FR-SK-02) in three modes:
 *
 * - **3-point** (`A`): the start, the end, then a point the arc passes
 *   through; type the radius instead of the third click.
 * - **Center**: the center, the start (type the radius), then the end
 *   (type the sweep angle). The arc turns the way the pointer went round.
 * - **Tangent**: the end of a line or an arc, then the arc's end; the arc
 *   leaves tangent to the curve. (The Line tool draws the same arc on a drag.)
 *
 * Arcs are stored counter-clockwise (ADR-0010): an arc drawn clockwise
 * swaps its start and end.
 */
import type { DimensionId, SketchEntityId, Vec2 } from '@extrudo/core';
import {
  type ArcShape,
  arcAround,
  arcThrough,
  arcWithRadius,
  type Inference,
  tangentArc,
} from '@extrudo/sketch/inference';
import { addArc, type CurveEnd, curveEnd, place, tangentJoin, throughPoint } from './build';
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

export const ARC_TOOL = 'arc';
export const ARC_CENTER_TOOL = 'arcCenter';
export const ARC_TANGENT_TOOL = 'arcTangent';

export type ArcMode = '3-point' | 'center' | 'tangent';

const TOOL_IDS: Record<ArcMode, string> = {
  '3-point': ARC_TOOL,
  center: ARC_CENTER_TOOL,
  tangent: ARC_TANGENT_TOOL,
};

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

/** An angle difference in (−π, π]. */
function wrap(angle: number): number {
  const a = (angle + Math.PI) % TAU;
  return (a <= 0 ? a + TAU : a) - Math.PI;
}

export class ArcTool implements SketchTool {
  readonly id: string;
  #clicks: Inference[] = [];
  #pointer: Inference | undefined;
  #radius: Typed | undefined;
  #angle: Typed | undefined;
  /** Center mode: the radius typed before the start was placed. */
  #typedRadius: Typed | undefined;
  /** Center mode: the signed sweep the pointer has gone round since the start, radians. */
  #sweep = 0;
  #lastAngle = 0;
  /** Tangent mode: the curve end the arc leaves from. */
  #from: (CurveEnd & { point: Vec2; id: SketchEntityId }) | undefined;
  #error: string | undefined;

  constructor(
    private readonly context: ToolContext,
    readonly mode: ArcMode = '3-point',
  ) {
    this.id = TOOL_IDS[mode];
  }

  prompt(): string {
    const n = this.#clicks.length;
    switch (this.mode) {
      case '3-point':
        return [
          'Click the start of the arc.',
          'Click the end of the arc.',
          'Click a point on the arc, or type the radius.',
        ][n] as string;
      case 'center':
        return [
          'Click the center.',
          'Click the start, or type the radius.',
          'Click the end, or type the angle.',
        ][n] as string;
      case 'tangent':
        return this.#from
          ? 'Click the end of the arc.'
          : (this.#error ?? 'Click the end of a line or an arc.');
    }
  }

  anchor(): Vec2 | undefined {
    return this.mode === '3-point' && this.#clicks.length === 1
      ? this.#clicks[0]?.point
      : undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
    if (this.mode === 'center' && this.#clicks.length === 2) {
      const center = this.#clicks[0]?.point as Vec2;
      const angle = Math.atan2(pointer.cursor[1] - center[1], pointer.cursor[0] - center[0]);
      this.#sweep = Math.max(-TAU, Math.min(TAU, this.#sweep + wrap(angle - this.#lastAngle)));
      this.#lastAngle = angle;
    }
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.move(pointer);
    if (this.mode === 'tangent') {
      if (this.#from) return this.#finish();
      const id =
        pointer.snap?.kind === 'endpoint' ? (pointer.snap.ids[0] as SketchEntityId) : undefined;
      const end = id && curveEnd(this.context.sketch(), id);
      if (!id || !end) {
        this.#error = 'Start on the end of a line or an arc.';
        return undefined;
      }
      this.#from = { ...end, id };
      this.#error = undefined;
      return undefined;
    }
    if (this.mode === 'center' && this.#clicks.length === 1) {
      this.#placeStart();
      return undefined;
    }
    if (this.#clicks.length < 2) {
      this.#clicks.push(pointer);
      return undefined;
    }
    return this.#finish();
  }

  enter(): SketchEdit | undefined {
    if (this.mode === 'center' && this.#clicks.length === 1 && this.#radius) {
      this.#placeStart();
      return undefined;
    }
    if (this.#clicks.length === 2 && (this.#radius || this.#angle)) return this.#finish();
    return undefined;
  }

  fields(): HeadsUpField[] {
    const n = this.#clicks.length;
    const shape = this.#shape();
    if (this.mode === '3-point' && n === 2) {
      return [
        {
          name: 'radius',
          label: 'Radius',
          kind: 'length',
          value: shape?.radius ?? 0,
          locked: this.#radius,
        },
      ];
    }
    if (this.mode === 'center' && n === 1) {
      const start = this.#startPoint();
      const c = this.#clicks[0]?.point as Vec2;
      const r = start ? Math.hypot(start[0] - c[0], start[1] - c[1]) : 0;
      return [{ name: 'radius', label: 'Radius', kind: 'length', value: r, locked: this.#radius }];
    }
    if (this.mode === 'center' && n === 2) {
      return [
        {
          name: 'angle',
          label: 'Angle',
          kind: 'angle',
          value: this.#sweep / DEG + 0,
          locked: this.#angle,
        },
      ];
    }
    return [];
  }

  lock(name: string, typed: Typed | undefined): void {
    if (name === 'radius') this.#radius = typed && typed.value > 0 ? typed : undefined;
    else if (name === 'angle') this.#angle = typed && typed.value !== 0 ? typed : undefined;
  }

  escape(): boolean {
    if (this.#radius || this.#angle) {
      this.#radius = undefined;
      this.#angle = undefined;
      return false;
    }
    if (this.#from) {
      this.#from = undefined;
      return false;
    }
    if (this.#clicks.length > 0) {
      this.#clicks.pop();
      this.#typedRadius = undefined;
      return false;
    }
    return true;
  }

  preview(): ToolPreview {
    const shape = this.#shape();
    const points = this.#clicks.map((c) => c.point);
    if (this.#from) points.push(this.#from.point);
    if (!shape) {
      if (this.mode === 'center' && points.length === 1) {
        const start = this.#startPoint();
        if (start)
          return { lines: [], guides: [[points[0] as Vec2, start]], points: [...points, start] };
      }
      if (this.mode === '3-point' && points.length === 1 && this.#pointer) {
        return { lines: [], guides: [[points[0] as Vec2, this.#pointer.point]], points };
      }
      // The third point is still on the chord: show the chord.
      if (this.mode === '3-point' && points.length === 2) {
        return { lines: [], guides: [[points[0] as Vec2, points[1] as Vec2]], points };
      }
      return points.length > 0 ? { lines: [], points } : EMPTY_PREVIEW;
    }
    const preview: ToolPreview = { lines: [], arcs: [shape], points };
    if (this.mode === 'center') {
      const c = shape.center;
      const end = shape.reversed ? shape.from : shape.from + shape.sweep;
      const start = shape.reversed ? shape.from + shape.sweep : shape.from;
      const at = (a: number): Vec2 => [
        c[0] + shape.radius * Math.cos(a),
        c[1] + shape.radius * Math.sin(a),
      ];
      preview.guides = [
        [c, at(start)],
        [c, at(end)],
      ];
    }
    return preview;
  }

  /** Center mode's second click: the start, at the pointer or the typed radius. */
  #placeStart(): void {
    const start = this.#startPoint();
    const pointer = this.#pointer;
    const center = this.#clicks[0]?.point;
    if (!start || !pointer || !center) return;
    if (Math.hypot(start[0] - center[0], start[1] - center[1]) < 1e-9) return;
    this.#clicks.push(
      this.#radius ? { point: start, cursor: start, snap: undefined, alignments: [] } : pointer,
    );
    this.#typedRadius = this.#radius;
    this.#radius = undefined;
    this.#lastAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    this.#sweep = 0;
  }

  /** Center mode, before the second click: the start at the pointer, or at the typed radius. */
  #startPoint(): Vec2 | undefined {
    const c = this.#clicks[0]?.point;
    const pointer = this.#pointer;
    if (!c || !pointer) return undefined;
    if (!this.#radius) return pointer.point;
    const dx = pointer.cursor[0] - c[0];
    const dy = pointer.cursor[1] - c[1];
    const len = Math.hypot(dx, dy);
    const dir: Vec2 = len > 0 ? [dx / len, dy / len] : [1, 0];
    return [c[0] + dir[0] * this.#radius.value, c[1] + dir[1] * this.#radius.value];
  }

  #shape(): ArcShape | undefined {
    const pointer = this.#pointer;
    if (!pointer) return undefined;
    if (this.mode === 'tangent') {
      return this.#from
        ? tangentArc(this.#from.point, this.#from.outward, pointer.point)
        : undefined;
    }
    const [a, b] = this.#clicks.map((c) => c.point);
    if (!a || !b) return undefined;
    if (this.mode === '3-point') {
      return this.#radius
        ? arcWithRadius(a, b, this.#radius.value, pointer.cursor)
        : arcThrough(a, pointer.point, b);
    }
    // Center mode: `a` is the center, `b` the start.
    const radius = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const sweep = this.#angle ? this.#angle.value * DEG : this.#sweep;
    if (radius === 0 || Math.abs(sweep) < 1e-9) return undefined;
    const from = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const end: Vec2 = [
      a[0] + radius * Math.cos(from + sweep),
      a[1] + radius * Math.sin(from + sweep),
    ];
    if (Math.abs(sweep) >= TAU - 1e-9) return undefined;
    return arcAround(a, b, end, sweep > 0);
  }

  #finish(): SketchEdit | undefined {
    const shape = this.#shape();
    const pointer = this.#pointer;
    if (!shape || !pointer || shape.radius < 1e-9) return undefined;
    const ctx = this.context;
    const edit = emptyEdit();
    const arc = addArc(edit, ctx, shape);

    if (this.mode === '3-point') {
      place(edit, ctx, this.#clicks[0], arc.first);
      place(edit, ctx, this.#clicks[1], arc.last, { point: arc.first });
      if (this.#radius) {
        edit.dimensions[ctx.newId() as DimensionId] = {
          type: 'radius',
          curve: arc.id,
          expr: this.#radius.expr,
          driven: false,
        };
      } else throughPoint(edit, ctx, pointer.snap, arc.id);
    } else if (this.mode === 'center') {
      place(edit, ctx, this.#clicks[0], arc.center);
      place(edit, ctx, this.#clicks[1], arc.first);
      // The end sits where the pointer's angle meets the circle; keep a snap only if it's there.
      const snap = pointer.snap;
      const r = shape.radius;
      const onRim =
        !this.#angle &&
        snap !== undefined &&
        Math.abs(Math.hypot(snap.point[0] - shape.center[0], snap.point[1] - shape.center[1]) - r) <
          1e-6 * Math.max(1, r);
      if (onRim) place(edit, ctx, { ...pointer, alignments: [] }, arc.last);
      const radius = this.#typedRadius;
      if (radius) {
        edit.dimensions[ctx.newId() as DimensionId] = {
          type: 'radius',
          curve: arc.id,
          expr: radius.expr,
          driven: false,
        };
      }
    } else if (this.#from) {
      tangentJoin(edit, ctx, this.#from, this.#from.id, arc, shape);
      place(edit, ctx, pointer, arc.last);
    }

    this.#clicks = [];
    this.#radius = undefined;
    this.#angle = undefined;
    this.#typedRadius = undefined;
    this.#from = undefined;
    return edit;
  }
}
