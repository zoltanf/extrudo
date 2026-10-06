/**
 * Trim, Extend and Break (P1-10, FR-SK-10): picking tools that change the
 * curve under the pointer. Hovering shows what a click would do (the part
 * Trim takes away in red, Extend's extension and Break's piece in the
 * accent colour); the click does it, as one undo step, and the tool stays
 * on for the next curve. The geometry is `@extrudo/sketch/modify`.
 */
import type { SketchEntityId, Vec2 } from '@extrudo/core';
import type { Inference } from '@extrudo/sketch/inference';
import {
  breakCurve,
  breakPreview,
  extend,
  extendPreview,
  ModifyError,
  type ModifyResult,
  trim,
  trimPreview,
} from '@extrudo/sketch/modify';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
} from './tool';

export const TRIM_TOOL = 'trim';
export const EXTEND_TOOL = 'extend';
export const BREAK_TOOL = 'break';

type Mode = 'trim' | 'extend' | 'break';

const PROMPTS: Record<Mode, string> = {
  trim: 'Click the part of a curve to cut away.',
  extend: 'Click near the end of a line or an arc to extend it.',
  break: 'Click a curve where it should break off.',
};

const LABELS: Record<Mode, string> = { trim: 'Trim', extend: 'Extend', break: 'Break' };

export class SplitTool implements SketchTool {
  readonly picks = true;
  readonly id: string;
  #hover: { id: SketchEntityId; cursor: Vec2 } | undefined;

  constructor(
    private readonly context: ToolContext,
    private readonly mode: Mode,
  ) {
    this.id = { trim: TRIM_TOOL, extend: EXTEND_TOOL, break: BREAK_TOOL }[mode];
  }

  prompt(): string {
    return PROMPTS[this.mode];
  }

  anchor(): Vec2 | undefined {
    return undefined;
  }

  move(pointer: Inference): void {
    const id = this.#pick(pointer.cursor);
    this.#hover = id && { id, cursor: pointer.cursor };
  }

  click(pointer: Inference): SketchEdit | undefined {
    const id = this.#pick(pointer.cursor);
    if (!id) return undefined;
    this.#hover = undefined;
    const sketch = this.context.sketch();
    const newId = () => this.context.newId();
    try {
      const result =
        this.mode === 'trim'
          ? trim(sketch, id, pointer.cursor, newId)
          : this.mode === 'extend'
            ? extend(sketch, id, pointer.cursor, newId)
            : breakCurve(sketch, id, pointer.cursor, newId);
      return toEdit(result, LABELS[this.mode]);
    } catch (error) {
      if (!(error instanceof ModifyError)) throw error;
      return { ...emptyEdit(), error: error.message };
    }
  }

  enter(): undefined {
    return undefined;
  }

  fields(): HeadsUpField[] {
    return [];
  }

  lock(): void {}

  escape(): boolean {
    return true;
  }

  preview(): ToolPreview {
    const hover = this.#hover;
    if (!hover) return EMPTY_PREVIEW;
    const sketch = this.context.sketch();
    if (!(hover.id in sketch.entities)) return EMPTY_PREVIEW;
    if (this.mode === 'trim') {
      return { ...EMPTY_PREVIEW, removed: trimPreview(sketch, hover.id, hover.cursor) };
    }
    const accent =
      this.mode === 'extend'
        ? extendPreview(sketch, hover.id, hover.cursor)
        : breakPreview(sketch, hover.id, hover.cursor);
    return { ...EMPTY_PREVIEW, hover: hover.id, accent };
  }

  #pick(cursor: Vec2): SketchEntityId | undefined {
    const kinds =
      this.mode === 'extend'
        ? ['line', 'arc']
        : this.mode === 'break'
          ? ['line', 'circle', 'arc', 'spline']
          : undefined;
    return this.context.pick(cursor, (e) => (kinds ? kinds.includes(e.type) : e.type !== 'point'));
  }
}

/** A modify operation's result as the host's edit, one undo step named `label`. */
export function toEdit(result: ModifyResult, label: string): SketchEdit {
  return {
    entities: result.entities ?? {},
    constraints: result.constraints ?? {},
    dimensions: result.dimensions ?? {},
    auto: result.auto ?? [],
    ...(result.update ? { update: result.update } : {}),
    ...(result.replace ? { replace: result.replace } : {}),
    ...(result.remove ? { remove: result.remove } : {}),
    ...(result.exprs ? { exprs: result.exprs } : {}),
    ...(result.links ? { links: result.links } : {}),
    label,
  };
}
