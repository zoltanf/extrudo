/**
 * The Import Drawing tool (P4-06, FR-SK-14, ADR-0066 §1). It takes no pointer
 * input at all: the file is picked when the tool starts (`pickDrawing`), and the
 * panel beside the view (`ImportDrawingPanel`, `panels.tsx`) asks for the unit,
 * the scale, where the drawing goes and whether its curves are fixed. The tool
 * draws what the import would put in the sketch, and OK (or Enter) commits it
 * through `ToolHost` as one undo step named after the file.
 */

import type { Vec2 } from '@extrudo/core';
import { type Contour, flattenContour } from '@extrudo/io';
import {
  importChange,
  importDrawingStore,
  importOffset,
  importReady,
  importScale,
  resetImportDrawingDraft,
} from '../importDraft';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
} from './tool';

export const IMPORT_DRAWING_TOOL = 'importDrawing';

/** How finely the preview follows the drawing's curves, in sketch mm. */
const PREVIEW_TOLERANCE = 0.01;

export class ImportDrawingTool implements SketchTool {
  readonly id = IMPORT_DRAWING_TOOL;

  constructor(private readonly context: ToolContext) {}

  prompt(): string {
    return 'Check the drawing in the panel, then OK. Esc cancels.';
  }

  /** The drawing's own origin, where the panel would put it. */
  anchor(): Vec2 | undefined {
    return undefined;
  }

  move(): void {}

  click(): SketchEdit | undefined {
    // The panel's OK (or Enter) commits; a click in the view changes nothing.
    return undefined;
  }

  enter(): SketchEdit | undefined {
    return this.#commit();
  }

  fields(): [] {
    return [];
  }

  lock(): void {}

  escape(): boolean {
    resetImportDrawingDraft();
    return true;
  }

  preview(): ToolPreview {
    const draft = importDrawingStore.getState();
    const drawing = draft.drawing;
    if (!drawing || !importReady(draft)) return EMPTY_PREVIEW;
    const scale = importScale(draft);
    const offset = importOffset(draft);
    const tolerance = PREVIEW_TOLERANCE / Math.max(Math.abs(scale), 1e-9);
    const polylines: Vec2[][] = [];
    for (const shape of drawing.shapes) {
      for (const contour of shape.contours) {
        const points = flattenContour(contour as Contour, tolerance).map(
          (p): Vec2 => [p[0] * scale + offset[0], p[1] * scale + offset[1]],
        );
        if (points.length > 1) polylines.push(points);
      }
    }
    return { lines: [], points: [], polylines };
  }

  /** The panel's OK: the drawing, as one undo step. */
  #commit(): SketchEdit | undefined {
    const draft = importDrawingStore.getState();
    if (!draft.open) return undefined;
    if (draft.error) return { ...emptyEdit(), error: draft.error };
    const change = importChange(draft, this.context.newId);
    if (!change) {
      return { ...emptyEdit(), error: "This drawing can't be imported." };
    }
    resetImportDrawingDraft();
    return {
      ...emptyEdit(),
      entities: change.entities ?? {},
      constraints: change.constraints ?? {},
      dimensions: change.dimensions ?? {},
      label: `Import ${draft.fileName}`,
    };
  }
}
