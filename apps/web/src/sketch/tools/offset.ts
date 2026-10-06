/**
 * Sketch Offset (P1-10, FR-SK-10): pick a curve and its whole chain (the
 * lines and arcs joined end to end with it) is offset; the pointer sets the
 * side and the distance, which a typed value locks. A click places it; the
 * distance becomes a driving dimension. Esc picks another chain.
 */
import type { SketchEntityId, Vec2 } from '@extrudo/core';
import type { Inference } from '@extrudo/sketch/inference';
import {
  type Chain,
  chainOf,
  ModifyError,
  offset,
  offsetPreview,
  offsetTo,
} from '@extrudo/sketch/modify';
import { toEdit } from './split';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  lengthExpr,
  roundLength,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
  type Typed,
} from './tool';

export const OFFSET_TOOL = 'sketchOffset';

export class OffsetTool implements SketchTool {
  readonly id = OFFSET_TOOL;
  readonly picks = true;
  #chain: Chain | undefined;
  #cursor: Vec2 | undefined;
  #hover: SketchEntityId | undefined;
  #locked: Typed | undefined;

  constructor(private readonly context: ToolContext) {}

  prompt(): string {
    return this.#chain
      ? 'Move to the side to offset to, and click. Type a distance to set it.'
      : 'Pick a curve to offset (its joined curves come too).';
  }

  anchor(): Vec2 | undefined {
    return undefined;
  }

  move(pointer: Inference): void {
    this.#cursor = pointer.cursor;
    this.#hover = this.#chain ? undefined : this.#pick(pointer.cursor);
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#cursor = pointer.cursor;
    const sketch = this.context.sketch();
    if (!this.#chain) {
      const id = this.#pick(pointer.cursor);
      if (!id) return undefined;
      this.#chain = chainOf(sketch, id);
      this.#hover = undefined;
      return this.#chain
        ? undefined
        : { ...emptyEdit(), error: 'Offset works on lines, circles, arcs and splines.' };
    }
    return this.#place();
  }

  enter(): SketchEdit | undefined {
    return this.#chain && this.#cursor ? this.#place() : undefined;
  }

  fields(): HeadsUpField[] {
    if (!this.#chain) return [];
    return [
      {
        name: 'distance',
        label: 'Distance',
        kind: 'length',
        value: Math.abs(this.#distance() ?? 0),
        ...(this.#locked ? { locked: this.#locked } : {}),
      },
    ];
  }

  lock(_name: string, typed: Typed | undefined): void {
    this.#locked = typed;
  }

  escape(): boolean {
    if (!this.#chain) return true;
    this.#chain = undefined;
    return false;
  }

  preview(): ToolPreview {
    const chain = this.#chain;
    if (!chain) return this.#hover ? { ...EMPTY_PREVIEW, hover: this.#hover } : EMPTY_PREVIEW;
    const picked = chain.links.map((l) => l.id);
    const d = this.#distance();
    if (d === undefined || d === 0) return { ...EMPTY_PREVIEW, picked };
    try {
      return { ...EMPTY_PREVIEW, picked, accent: offsetPreview(this.context.sketch(), chain, d) };
    } catch (error) {
      if (!(error instanceof ModifyError)) throw error;
      return { ...EMPTY_PREVIEW, picked };
    }
  }

  /** The signed distance: to the pointer's side, as far as the pointer or the typed value. */
  #distance(): number | undefined {
    const chain = this.#chain;
    const cursor = this.#cursor;
    if (!chain || !cursor) return undefined;
    const measured = offsetTo(this.context.sketch(), chain, cursor);
    const size = this.#locked?.value ?? roundLength(this.context, Math.abs(measured));
    return (measured < 0 ? -1 : 1) * Math.abs(size);
  }

  #place(): SketchEdit | undefined {
    const chain = this.#chain;
    const d = this.#distance();
    if (!chain || d === undefined) return undefined;
    const expr = this.#locked?.expr ?? lengthExpr(this.context, Math.abs(d));
    try {
      const result = offset(
        this.context.sketch(),
        chain,
        d,
        { expr, format: (mm) => lengthExpr(this.context, mm) },
        () => this.context.newId(),
      );
      this.#chain = undefined;
      return toEdit(result, 'Offset');
    } catch (error) {
      if (!(error instanceof ModifyError)) throw error;
      return { ...emptyEdit(), error: error.message };
    }
  }

  #pick(cursor: Vec2): SketchEntityId | undefined {
    return this.context.pick(
      cursor,
      (e) => e.type === 'line' || e.type === 'arc' || e.type === 'circle' || e.type === 'spline',
    );
  }
}
