/**
 * Sketch Fillet and Chamfer (P1-10, FR-SK-10): pick a corner (the point
 * where two lines end) or two lines, and the corner is rounded or cut. The
 * heads-up box shows the radius (distance), which a typed value locks, and
 * the preview follows the lines under the pointer. The new radius or
 * distance is a driving dimension, so a parameter can drive it later. The
 * tool stays on with the same size for the next corner.
 */
import type { SketchEntityId, Vec2 } from '@extrudo/core';
import type { Inference } from '@extrudo/sketch/inference';
import {
  type Corner,
  chamfer,
  chamferEnds,
  cornerAtPoint,
  cornerOf,
  fillet,
  filletPolyline,
  filletShape,
  ModifyError,
  maxChamfer,
  maxFilletRadius,
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

export const FILLET_TOOL = 'sketchFillet';
export const CHAMFER_TOOL = 'sketchChamfer';

type Mode = 'fillet' | 'chamfer';

interface LinePick {
  id: SketchEntityId;
  at: Vec2;
}

export class CornerTool implements SketchTool {
  readonly picks = true;
  readonly id: string;
  #first: LinePick | undefined;
  /** The corner under the pointer (with the first line, or at a point). */
  #corner: Corner | undefined;
  #hover: SketchEntityId | undefined;
  #locked: Typed | undefined;

  constructor(
    private readonly context: ToolContext,
    private readonly mode: Mode,
  ) {
    this.id = mode === 'fillet' ? FILLET_TOOL : CHAMFER_TOOL;
  }

  prompt(): string {
    if (this.#first) return 'Pick the second line.';
    return 'Pick a corner, or the first of two lines.';
  }

  anchor(): Vec2 | undefined {
    return undefined;
  }

  move(pointer: Inference): void {
    const hit = this.#pick(pointer.cursor);
    this.#hover = hit;
    this.#corner = hit ? this.#cornerFor(hit, pointer.cursor) : undefined;
  }

  click(pointer: Inference): SketchEdit | undefined {
    const hit = this.#pick(pointer.cursor);
    if (!hit) return undefined;
    const corner = this.#cornerFor(hit, pointer.cursor);
    const sketch = this.context.sketch();
    if (!corner) {
      if (sketch.entities[hit]?.type === 'line' && !this.#first) {
        this.#first = { id: hit, at: pointer.cursor };
        return undefined;
      }
      return { ...emptyEdit(), error: 'Those two lines make no corner to round.' };
    }
    this.#first = undefined;
    this.#corner = undefined;
    this.#hover = undefined;
    const size = this.#size(corner);
    const expr = this.#locked?.expr ?? lengthExpr(this.context, size);
    const newId = () => this.context.newId();
    try {
      return this.mode === 'fillet'
        ? toEdit(fillet(sketch, corner, size, expr, newId), 'Fillet')
        : toEdit(chamfer(sketch, corner, size, expr, newId), 'Chamfer');
    } catch (error) {
      if (!(error instanceof ModifyError)) throw error;
      return { ...emptyEdit(), error: error.message };
    }
  }

  enter(): undefined {
    return undefined;
  }

  fields(): HeadsUpField[] {
    const corner = this.#corner;
    const value = corner ? this.#size(corner) : (this.#locked?.value ?? 0);
    return [
      {
        name: 'size',
        label: this.mode === 'fillet' ? 'Radius' : 'Distance',
        kind: 'length',
        value,
        ...(this.#locked ? { locked: this.#locked } : {}),
      },
    ];
  }

  lock(_name: string, typed: Typed | undefined): void {
    this.#locked = typed;
  }

  escape(): boolean {
    if (!this.#first) return true;
    this.#first = undefined;
    this.#corner = undefined;
    return false;
  }

  preview(): ToolPreview {
    const corner = this.#corner;
    const picked = this.#first ? [this.#first.id] : [];
    if (!corner) return { ...EMPTY_PREVIEW, picked, hover: this.#hover };
    const size = this.#size(corner);
    const fits =
      size > 0 && size < (this.mode === 'fillet' ? maxFilletRadius(corner) : maxChamfer(corner));
    if (!fits) return { ...EMPTY_PREVIEW, picked, hover: this.#hover };
    if (this.mode === 'fillet') {
      const shape = filletShape(corner, size);
      return {
        ...EMPTY_PREVIEW,
        picked,
        accent: [filletPolyline(shape)],
        removed: [
          [shape.ta, corner.sharp],
          [corner.sharp, shape.tb],
        ],
      };
    }
    const [ca, cb] = chamferEnds(corner, size);
    return {
      ...EMPTY_PREVIEW,
      picked,
      accent: [[ca, cb]],
      removed: [
        [ca, corner.sharp],
        [corner.sharp, cb],
      ],
    };
  }

  /** The radius or distance: typed, or a quarter of what fits, rounded to the document's precision. */
  #size(corner: Corner): number {
    if (this.#locked) return this.#locked.value;
    const max = this.mode === 'fillet' ? maxFilletRadius(corner) : maxChamfer(corner);
    return roundLength(this.context, max / 4) || max / 4;
  }

  #cornerFor(hit: SketchEntityId, cursor: Vec2): Corner | undefined {
    const sketch = this.context.sketch();
    const e = sketch.entities[hit];
    if (e?.type === 'point') return this.#first ? undefined : cornerAtPoint(sketch, hit);
    if (!this.#first || e?.type !== 'line' || hit === this.#first.id) return undefined;
    return cornerOf(sketch, this.#first.id, hit, this.#first.at, cursor);
  }

  #pick(cursor: Vec2): SketchEntityId | undefined {
    const sketch = this.context.sketch();
    return this.context.pick(cursor, (e, id) => {
      if (e.type === 'line') return id !== this.#first?.id;
      return e.type === 'point' && !this.#first && cornerAtPoint(sketch, id) !== undefined;
    });
  }
}
