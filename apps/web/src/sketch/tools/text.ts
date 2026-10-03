/**
 * The Text tool (P4-03, FR-SK-13, ADR-0058 §6). The click places the anchor
 * and opens the panel (`TextPanel`, `panels.tsx`), which asks for the string,
 * the font, the alignment and the height; the text previews at the anchor
 * while it is open. OK (or Enter) commits one undo step: the anchor and top
 * points, the `text` entity, a `vertical` constraint between them (delete it
 * to rotate the text) and a driving distance dimension whose expression is
 * the height — a normal `dN` dimension, so the height is a parameter.
 *
 * The panel's values live in `../textDraft`'s store, which the tool reads when
 * it commits and its preview draws from; the tool doesn't know the panel.
 */
import {
  type ConstraintId,
  type DimensionId,
  type SketchData,
  type SketchEntityId,
  textPolylines,
  type Vec2,
} from '@extrudo/core';
import type { Inference } from '@extrudo/sketch/inference';
import { ensureUiFonts, hasUiFont } from '../fonts';
import {
  DEFAULT_TEXT_DRAFT,
  resetTextDraft,
  setTextDraft,
  type TextDraft,
  textDraftStore,
} from '../textDraft';
import { addPoint, place } from './build';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
} from './tool';

export const TEXT_TOOL = 'text';

/** The draft entity's ID within the sketch the tool lays the text out in. */
const TEXT_ID = 'text' as SketchEntityId;

export class TextTool implements SketchTool {
  readonly id = TEXT_TOOL;
  /** The pointer, or the click that placed the anchor. */
  #pointer: Inference | undefined;
  #anchored = false;
  /** The sketch the preview draws from, and the draft it was laid out with. */
  #placed: { data: SketchData; draft: TextDraft } | undefined;

  constructor(private readonly context: ToolContext) {
    void ensureUiFonts([DEFAULT_TEXT_DRAFT.font]);
  }

  prompt(): string {
    if (this.#anchored) return 'Type the text, then OK. Esc cancels.';
    return 'Click where the first line’s baseline starts.';
  }

  anchor(): Vec2 | undefined {
    return this.#pointer?.point;
  }

  move(pointer: Inference): void {
    if (!this.#anchored) this.#pointer = pointer;
    this.#loadFont();
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    this.#anchored = true;
    this.#loadFont();
    setTextDraft({ open: true });
    return undefined;
  }

  enter(): SketchEdit | undefined {
    return this.#commit();
  }

  fields(): HeadsUpField[] {
    return [];
  }

  lock(): void {}

  escape(): boolean {
    // The open panel first, then the tool itself.
    if (textDraftStore.getState().open) {
      this.#close();
      return false;
    }
    return true;
  }

  preview(): ToolPreview {
    const draft = textDraftStore.getState();
    const at = this.#pointer?.point;
    if (!at) return EMPTY_PREVIEW;
    const points: Vec2[] = this.#anchored ? [at, [at[0], at[1] + draft.mm]] : [at];
    if (!draft.open || draft.text.length === 0) return { lines: [], points };
    // The glyph curves of the text as it would be stored (its font must be in).
    const polylines = [...textPolylines(this.#provisional(draft), TEXT_ID).values()];
    return { lines: [], polylines, points };
  }

  /** The panel's OK: the text, as one undo step. */
  #commit(): SketchEdit | undefined {
    const draft = textDraftStore.getState();
    const click = this.#pointer;
    if (!this.#anchored || !click) return undefined;
    if (draft.text.length === 0) return { ...emptyEdit(), error: 'Type some text first.' };
    const ctx = this.context;
    const edit = emptyEdit();
    const anchor = addPoint(edit, ctx, click.point);
    const top = addPoint(edit, ctx, [click.point[0], click.point[1] + draft.mm]);
    place(edit, ctx, click, anchor);
    const id = ctx.newId() as SketchEntityId;
    edit.entities[id] = {
      type: 'text',
      anchor,
      top,
      text: draft.text,
      font: draft.font,
      align: draft.align,
      construction: ctx.construction(),
    };
    // Upright text: delete the constraint to rotate it (ADR-0058 §1).
    const vertical = ctx.newId() as ConstraintId;
    edit.constraints[vertical] = { type: 'vertical', a: anchor, b: top };
    // The height is a dimension, so it is a parameter the customizer can drive.
    edit.dimensions[ctx.newId() as DimensionId] = {
      type: 'distance',
      orientation: 'aligned',
      a: anchor,
      b: top,
      expr: draft.expr,
      driven: false,
    };
    this.#close();
    return edit;
  }

  #close(): void {
    this.#anchored = false;
    this.#placed = undefined;
    resetTextDraft();
  }

  /**
   * A sketch holding the draft's text at the anchor, so `placeText` lays it
   * out as it will be stored. Rebuilt when the panel changes the draft.
   */
  #provisional(draft: TextDraft): SketchData {
    const same =
      this.#placed?.draft.text === draft.text &&
      this.#placed?.draft.font === draft.font &&
      this.#placed?.draft.align === draft.align &&
      this.#placed?.draft.mm === draft.mm;
    if (same) return this.#placed?.data as SketchData;
    const at = this.#pointer?.point ?? [0, 0];
    const data = {
      entities: {
        anchor: { type: 'point', x: at[0], y: at[1] },
        top: { type: 'point', x: at[0], y: at[1] + draft.mm },
        [TEXT_ID]: {
          type: 'text',
          anchor: 'anchor',
          top: 'top',
          text: draft.text,
          font: draft.font,
          align: draft.align,
          construction: false,
        },
      },
      constraints: {},
      dimensions: {},
    } as unknown as SketchData;
    this.#placed = { data, draft: { ...draft } };
    return data;
  }

  /** The preview is only drawn once its font is in (ADR-0058 §4). */
  #loadFont(): void {
    const font = textDraftStore.getState().font;
    if (!hasUiFont(font)) void ensureUiFonts([font]);
  }
}
