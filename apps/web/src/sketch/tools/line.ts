/**
 * The Line tool (P1-02's reference tool, with P1-04's tangent-arc drag):
 * click a start point, then click point after point for a chain of lines.
 * Each segment is committed on its click. The chain ends with Esc, or by
 * clicking its own first point (a closed loop).
 *
 * While a segment is rubber-banding, the heads-up box shows its length and
 * angle; typing locks them (FR-SK-06). A typed length becomes a driving
 * dimension; a typed angle that is a multiple of 90° becomes horizontal or
 * vertical.
 *
 * Pressing on the chain's end (or, to start, on the end of any line or arc)
 * and dragging draws an arc tangent to the curve there instead (FR-SK-02);
 * the chain goes on from the arc's end.
 */
import type { DimensionId, SketchEntityId, Vec2 } from '@extrudo/core';
import { type ArcShape, type Inference, tangentArc } from '@extrudo/sketch/inference';
import {
  addArc,
  addLine,
  arcEndDirection,
  type CurveEnd,
  curveEnd,
  place,
  tangentJoin,
} from './build';
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

export const LINE_TOOL = 'line';

/** The end of the chain's last curve, where the next segment starts. */
interface ChainEnd {
  /** Its point entity: the next segment starts coincident with it. */
  point: SketchEntityId;
  /** The curve and its direction there, for a tangent arc. */
  from: Pick<CurveEnd, 'curve' | 'isEnd' | 'outward'>;
}

type State =
  | { phase: 'start' }
  | {
      phase: 'next';
      start: Inference;
      joinTo?: ChainEnd;
      /** The chain's first point: clicking it closes the loop. */
      first?: SketchEntityId;
    };

interface End {
  point: Vec2;
  /** The inference behind the point, unless typed values placed it. */
  inference?: Inference;
  /** A typed angle along an axis. */
  axis?: 'horizontal' | 'vertical';
}

/** A tangent arc being dragged out of a curve's end. */
interface Drag {
  at: Vec2;
  from: ChainEnd;
  first?: SketchEntityId;
}

const DEG = Math.PI / 180;

export class LineTool implements SketchTool {
  readonly id = LINE_TOOL;
  #state: State = { phase: 'start' };
  #pointer: Inference | undefined;
  #length: Typed | undefined;
  #angle: Typed | undefined;
  #drag: Drag | undefined;

  constructor(private readonly context: ToolContext) {}

  prompt(): string {
    if (this.#drag) return 'Release to place the tangent arc.';
    return this.#state.phase === 'start'
      ? 'Click to start a line. Drag from the end of a curve for a tangent arc.'
      : 'Click the next point, or type a length. Drag from the end for an arc; Esc ends.';
  }

  anchor(): Vec2 | undefined {
    if (this.#drag) return undefined;
    return this.#state.phase === 'next' ? this.#state.start.point : undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    if (this.#state.phase === 'start') {
      this.#state = { phase: 'next', start: pointer };
      return undefined;
    }
    return this.#segment();
  }

  enter(): SketchEdit | undefined {
    if (this.#state.phase !== 'next' || (!this.#length && !this.#angle)) return undefined;
    return this.#segment();
  }

  dragStart(pointer: Inference): boolean {
    const s = this.#state;
    if (s.phase === 'next') {
      // Only from the end of the chain's last curve.
      if (!s.joinTo || pointer.snap?.kind !== 'endpoint' || pointer.snap.ids[0] !== s.joinTo.point)
        return false;
      this.#drag = { at: s.start.point, from: s.joinTo, first: s.first };
    } else {
      // Starting a chain: from the end of any line or arc.
      const id = pointer.snap?.kind === 'endpoint' ? pointer.snap.ids[0] : undefined;
      const end = id ? curveEnd(this.context.sketch(), id as SketchEntityId) : undefined;
      if (!id || !end) return false;
      this.#drag = { at: end.point, from: { point: id as SketchEntityId, from: end } };
    }
    this.#length = undefined;
    this.#angle = undefined;
    this.#pointer = pointer;
    return true;
  }

  dragEnd(pointer: Inference): SketchEdit | undefined {
    const drag = this.#drag;
    this.#drag = undefined;
    this.#pointer = pointer;
    const shape = drag && this.#arc(drag, pointer.point);
    if (!drag || !shape) return undefined;
    const ctx = this.context;
    const edit = emptyEdit();
    const arc = addArc(edit, ctx, shape);
    tangentJoin(edit, ctx, drag.from.from, drag.from.point, arc, shape);
    place(edit, ctx, pointer, arc.last);

    const end = shape.reversed ? shape.from : shape.from + shape.sweep;
    const point: Vec2 = [
      shape.center[0] + shape.radius * Math.cos(end),
      shape.center[1] + shape.radius * Math.sin(end),
    ];
    const first = drag.first ?? arc.first;
    const closed = pointer.snap?.kind === 'endpoint' && pointer.snap.ids[0] === drag.first;
    this.#state = closed
      ? { phase: 'start' }
      : {
          phase: 'next',
          start: { point, cursor: point, snap: undefined, alignments: [] },
          joinTo: {
            point: arc.last,
            from: { curve: arc.id, isEnd: !shape.reversed, outward: arcEndDirection(shape) },
          },
          first,
        };
    return edit;
  }

  fields(): HeadsUpField[] {
    const s = this.#state;
    if (s.phase !== 'next' || this.#drag) return [];
    const end = this.#end();
    const d = end ? [end.point[0] - s.start.point[0], end.point[1] - s.start.point[1]] : [0, 0];
    return [
      {
        name: 'length',
        label: 'Length',
        kind: 'length',
        value: Math.hypot(d[0] as number, d[1] as number),
        locked: this.#length,
      },
      {
        name: 'angle',
        label: 'Angle',
        kind: 'angle',
        value: Math.atan2(d[1] as number, d[0] as number) / DEG + 0,
        locked: this.#angle,
      },
    ];
  }

  lock(name: string, typed: Typed | undefined): void {
    if (name === 'length') this.#length = typed && typed.value > 0 ? typed : undefined;
    else if (name === 'angle') this.#angle = typed;
  }

  escape(): boolean {
    if (this.#drag) {
      this.#drag = undefined;
      return false;
    }
    if (this.#length || this.#angle) {
      this.#length = undefined;
      this.#angle = undefined;
      return false;
    }
    if (this.#state.phase === 'next') {
      this.#state = { phase: 'start' };
      return false;
    }
    return true;
  }

  preview(): ToolPreview {
    const drag = this.#drag;
    if (drag) {
      const shape = this.#pointer && this.#arc(drag, this.#pointer.point);
      if (!shape) return { lines: [], points: [drag.at] };
      return { lines: [], arcs: [shape], points: [drag.at, (this.#pointer as Inference).point] };
    }
    const s = this.#state;
    const end = this.#end();
    if (s.phase !== 'next' || !end) return EMPTY_PREVIEW;
    return { lines: [[s.start.point, end.point]], points: [s.start.point, end.point] };
  }

  #arc(drag: Drag, to: Vec2): ArcShape | undefined {
    return tangentArc(drag.at, drag.from.from.outward, to);
  }

  /** Where the segment being drawn ends: the pointer, or the typed length and angle. */
  #end(): End | undefined {
    const s = this.#state;
    const pointer = this.#pointer;
    if (s.phase !== 'next' || !pointer) return undefined;
    if (!this.#length && !this.#angle) return { point: pointer.point, inference: pointer };
    const [sx, sy] = s.start.point;
    const dx = pointer.cursor[0] - sx;
    const dy = pointer.cursor[1] - sy;
    let dir: Vec2;
    if (this.#angle) dir = [Math.cos(this.#angle.value * DEG), Math.sin(this.#angle.value * DEG)];
    else {
      const len = Math.hypot(dx, dy);
      dir = len > 0 ? [dx / len, dy / len] : [1, 0];
    }
    const length = this.#length?.value ?? Math.max(0, dx * dir[0] + dy * dir[1]);
    const point: Vec2 = [sx + dir[0] * length, sy + dir[1] * length];
    // A typed multiple of 90° becomes horizontal or vertical.
    const quarters = this.#angle ? this.#angle.value / 90 : Number.NaN;
    const k = Math.round(quarters);
    const axis =
      Math.abs(quarters - k) < 1e-9 ? (k % 2 === 0 ? 'horizontal' : 'vertical') : undefined;
    return { point, axis };
  }

  #segment(): SketchEdit | undefined {
    const s = this.#state;
    const end = this.#end();
    if (s.phase !== 'next' || !end) return undefined;
    const [sx, sy] = s.start.point;
    const length = Math.hypot(end.point[0] - sx, end.point[1] - sy);
    if (length < 1e-9) return undefined;

    const ctx = this.context;
    const edit = emptyEdit();
    const line = addLine(edit, ctx, s.start.point, end.point);

    if (s.joinTo) {
      constrain(edit, ctx, [{ type: 'coincident', a: line.start, b: s.joinTo.point }], false);
    } else place(edit, ctx, s.start, line.start);
    place(edit, ctx, end.inference, line.end, { line: line.id });
    if (end.axis) constrain(edit, ctx, [{ type: end.axis, a: line.id }], true);
    if (this.#length) {
      edit.dimensions[ctx.newId() as DimensionId] = {
        type: 'distance',
        orientation: 'aligned',
        a: line.id,
        expr: this.#length.expr,
        driven: false,
      };
    }

    const snap = end.inference?.snap;
    const first = s.first ?? line.start;
    const closed = snap?.kind === 'endpoint' && snap.ids[0] === first;
    this.#length = undefined;
    this.#angle = undefined;
    const outward: Vec2 = [(end.point[0] - sx) / length, (end.point[1] - sy) / length];
    this.#state = closed
      ? { phase: 'start' }
      : {
          phase: 'next',
          start: { point: end.point, cursor: end.point, snap: undefined, alignments: [] },
          joinTo: { point: line.end, from: { curve: line.id, isEnd: true, outward } },
          first,
        };
    return edit;
  }
}
