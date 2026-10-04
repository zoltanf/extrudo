/**
 * The Import Drawing tool's draft (P4-06, ADR-0066 §1): the file that was
 * picked and read, the unit it was in, and the panel's scale, position and
 * fixed choice. It lives apart from the tool so the panel (in the main chunk)
 * can reach it without pulling the drawing tools' chunk in with it, exactly as
 * `textDraft` does for the Text tool.
 */
import type { SketchChange, Vec2 } from '@extrudo/core';
import type { Drawing, DrawingImport, DrawingUnit } from '@extrudo/io';
import {
  drawingBounds,
  drawingCurves,
  drawingToSketch,
  importLimitMessage,
  MAX_IMPORT_CURVES,
  UNIT_MM,
} from '@extrudo/sketch/import';
import { createStore } from 'zustand/vanilla';

/** What the platform's file picker is asked for. */
export const DRAWING_ACCEPT = '.svg,.dxf';

/** The units the panel offers, in the order it shows them. */
export const DRAWING_UNITS: readonly DrawingUnit[] = ['mm', 'cm', 'm', 'in', 'ft', 'px'];

/** Where the drawing's own origin goes (ADR-0066 §1). */
export type ImportPosition = 'origin' | 'centre';

export interface ImportDrawingDraft {
  /** A file was picked and the panel is open. */
  open: boolean;
  /** The file's name, as the panel shows it. */
  fileName: string;
  /** What the reader made of the file, in millimetres; absent when it failed. */
  drawing?: Drawing;
  /** The unit the reader found, which the panel preselects. */
  fileUnits: DrawingUnit;
  /** The unit the panel is using now, the file's own or another. */
  units: DrawingUnit;
  /** The Scale field's expression, as typed, and its value. */
  expr: string;
  scale: number;
  position: ImportPosition;
  /** Fix every new curve, so the solver treats them as constants (on). */
  fixed: boolean;
  /** What the reader left out, by kind: `{ text: 4, image: 1 }`. */
  skipped: Record<string, number>;
  /** Why the file couldn't be read, or the curve limit refused it. */
  error?: string;
}

/** The draft a new import starts from. */
export const DEFAULT_IMPORT_DRAFT: ImportDrawingDraft = {
  open: false,
  fileName: '',
  drawing: undefined,
  fileUnits: 'mm',
  units: 'mm',
  expr: '1',
  scale: 1,
  position: 'origin',
  fixed: true,
  skipped: {},
  error: undefined,
};

export const importDrawingStore = createStore<ImportDrawingDraft>()(() => ({
  ...DEFAULT_IMPORT_DRAFT,
}));

/** The panel's edits (or the picker and the tool opening and closing it). */
export function setImportDrawingDraft(patch: Partial<ImportDrawingDraft>): void {
  importDrawingStore.setState(patch);
}

/** The panel closed: the next import starts from the defaults again. */
export function resetImportDrawingDraft(): void {
  importDrawingStore.setState({ ...DEFAULT_IMPORT_DRAFT });
}

/**
 * Millimetres per drawing unit: the unit the panel is using now over the one the
 * reader found, times the Scale field. The reader already gave millimetres for
 * the unit it found, so only a changed unit moves the drawing.
 */
export function importScale(draft: ImportDrawingDraft): number {
  return (UNIT_MM[draft.units] / UNIT_MM[draft.fileUnits]) * draft.scale;
}

/** Where the drawing goes in sketch mm: its origin, or its box's middle. */
export function importOffset(draft: ImportDrawingDraft): Vec2 {
  const scale = importScale(draft);
  if (draft.position !== 'centre' || !draft.drawing) return [0, 0];
  const box = drawingBounds(draft.drawing);
  if (!box) return [0, 0];
  return [(-(box.minX + box.maxX) / 2) * scale, (-(box.minY + box.maxY) / 2) * scale];
}

/** How many curves the drawing brings in, before duplicates are left out. */
export function importCurveCount(draft: ImportDrawingDraft): number {
  return draft.drawing ? drawingCurves(draft.drawing) : 0;
}

/** Whether the draft can be imported as it stands. */
export function importReady(draft: ImportDrawingDraft): boolean {
  return draft.open && !!draft.drawing && !draft.error && draft.scale !== 0;
}

/**
 * The draft as a change to the open sketch, or `undefined` when it can't be
 * imported. The IDs come from the caller (`newId` of the tool host), so the same
 * draft gives the same change every time (ADR-0003).
 */
export function importChange(
  draft: ImportDrawingDraft,
  newId: () => string,
): SketchChange | undefined {
  if (!importReady(draft) || !draft.drawing) return undefined;
  return drawingToSketch(
    draft.drawing,
    { entities: {}, constraints: {}, dimensions: {} },
    {
      scale: importScale(draft),
      offset: importOffset(draft),
      fixed: draft.fixed,
      ids: newId,
    },
  );
}

/** "312 curves · skipped 4 texts, 1 image", or why it can't be imported. */
export function importSummary(draft: ImportDrawingDraft): string {
  if (draft.error) return draft.error;
  if (!draft.drawing) return 'No drawing loaded.';
  const count = importCurveCount(draft);
  const skipped = Object.entries(draft.skipped)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${kind}${n === 1 ? '' : 's'}`);
  const curves = `${count.toLocaleString('en-US')} curve${count === 1 ? '' : 's'}`;
  return skipped.length > 0 ? `${curves} · skipped ${skipped.join(', ')}` : curves;
}

/** The draft a picked file starts from, with its error when it had one. */
export function draftFromImport(
  fileName: string,
  read: DrawingImport | undefined,
  error?: string,
): ImportDrawingDraft {
  if (!read) {
    return {
      ...DEFAULT_IMPORT_DRAFT,
      open: true,
      fileName,
      error: error ?? "This file isn't an SVG or DXF drawing Extrudo can read.",
    };
  }
  const units = DRAWING_UNITS.includes(read.units) ? read.units : 'unitless';
  const curves = drawingCurves(read.drawing);
  return {
    ...DEFAULT_IMPORT_DRAFT,
    open: true,
    fileName,
    drawing: read.drawing,
    fileUnits: units,
    units,
    skipped: read.skipped,
    ...(curves > MAX_IMPORT_CURVES && { error: importLimitMessage(curves) }),
  };
}
