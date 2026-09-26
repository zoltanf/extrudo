/**
 * The Line tool (P1-02's reference tool; P1-04 adds the tangent-arc drag):
 * click a start point, then click point after point for a chain of lines.
 * Each segment is committed on its click. The chain ends with Esc, or by
 * clicking its own first point (a closed loop).
 *
 * While a segment is rubber-banding, the heads-up box shows its length and
 * angle; typing locks them (FR-SK-06). A typed length becomes a driving
 * dimension; a typed angle that is a multiple of 90° becomes horizontal or
 * vertical.
 */
import type { DimensionId, SketchEntityId, Vec2 } from '@extrudo/core';
import { alignmentConstraints, type Inference, snapConstraints } from '@extrudo/sketch/inference';
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

type State =
  | { phase: 'start' }
  | {
      phase: 'next';
      start: Inference;
      /** The previous segment's end point: the new segment starts coincident with it. */
      joinTo?: SketchEntityId;
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

const DEG = Math.PI / 180;

export class LineTool implements SketchTool {
  readonly id = LINE_TOOL;
  #state: State = { phase: 'start' };
  #pointer: Inference | undefined;
  #length: Typed | undefined;
  #angle: Typed | undefined;

  constructor(private readonly context: ToolContext) {}

  prompt(): string {
    return this.#state.phase === 'start'
      ? 'Click to start a line.'
      : 'Click the next point, or type a length (Tab: angle). Esc ends the chain.';
  }

  anchor(): Vec2 | undefined {
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

  fields(): HeadsUpField[] {
    const s = this.#state;
    if (s.phase !== 'next') return [];
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
    const s = this.#state;
    const end = this.#end();
    if (s.phase !== 'next' || !end) return EMPTY_PREVIEW;
    return { lines: [[s.start.point, end.point]], points: [s.start.point, end.point] };
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
    if (Math.hypot(end.point[0] - sx, end.point[1] - sy) < 1e-9) return undefined;

    const ctx = this.context;
    const edit = emptyEdit();
    const start = ctx.newId() as SketchEntityId;
    const stop = ctx.newId() as SketchEntityId;
    const line = ctx.newId() as SketchEntityId;
    edit.entities[start] = { type: 'point', x: sx, y: sy };
    edit.entities[stop] = { type: 'point', x: end.point[0], y: end.point[1] };
    edit.entities[line] = { type: 'line', start, end: stop, construction: false };

    if (s.joinTo) constrain(edit, ctx, [{ type: 'coincident', a: start, b: s.joinTo }], false);
    else {
      constrain(edit, ctx, snapConstraints(s.start.snap, start), true);
      constrain(edit, ctx, alignmentConstraints(s.start.alignments, start), true);
    }
    const snap = end.inference?.snap;
    constrain(edit, ctx, snapConstraints(snap, stop), true);
    constrain(
      edit,
      ctx,
      alignmentConstraints(end.inference?.alignments ?? [], stop, { line }),
      true,
    );
    if (end.axis) constrain(edit, ctx, [{ type: end.axis, a: line }], true);
    if (this.#length) {
      edit.dimensions[ctx.newId() as DimensionId] = {
        type: 'distance',
        orientation: 'aligned',
        a: line,
        expr: this.#length.expr,
        driven: false,
      };
    }

    const first = s.first ?? start;
    const closed = snap?.kind === 'endpoint' && snap.ids[0] === first;
    this.#length = undefined;
    this.#angle = undefined;
    this.#state = closed
      ? { phase: 'start' }
      : {
          phase: 'next',
          start: { point: end.point, cursor: end.point, snap: undefined, alignments: [] },
          joinTo: stop,
          first: s.first ?? start,
        };
    return edit;
  }
}
