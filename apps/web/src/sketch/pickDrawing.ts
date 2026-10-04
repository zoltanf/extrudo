/**
 * Picking a drawing to import (P4-06, ADR-0066 §1): the tool's file dialog and
 * what comes of the file. The reader is chosen by the file's extension (the
 * picker asks for `.svg,.dxf`), its text is read in the UI thread (a drawing is
 * small), and the result goes into `importDraft`'s store, which the panel and
 * the tool read. A file that isn't a drawing, or one with more curves than the
 * limit, opens the panel with the reason in it: the user sees what happened and
 * OK stays disabled.
 */
import { type DrawingImport, readDxf, readSvg } from '@extrudo/io';
import type { FileAccess } from '../platform';
import {
  DRAWING_ACCEPT,
  draftFromImport,
  importDrawingStore,
  resetImportDrawingDraft,
} from './importDraft';
import type { ToolHost } from './tools/host';
import { IMPORT_DRAWING_TOOL } from './tools/importDrawing';

export interface DrawingPicker {
  /** Picks one file; only `pick` of the platform's file access is needed. */
  files: Pick<FileAccess, 'pick'>;
  /** The tool host, which the tool runs on once the file is in. */
  host: ToolHost;
  /** Tells the user what happened, as any other refused edit is told. */
  notify(tone: 'info' | 'error', message: string): void;
}

/** What a drawing file's extension says it is; anything else isn't one. */
export function drawingFormat(fileName: string): 'svg' | 'dxf' | undefined {
  if (/\.svg$/i.test(fileName)) return 'svg';
  if (/\.dxf$/i.test(fileName)) return 'dxf';
  return undefined;
}

/**
 * Reads a drawing file: its geometry in millimetres, or the reason it couldn't
 * be read. The reader never throws for a file it doesn't like — the panel shows
 * the message and refuses the import.
 */
export function readDrawing(
  fileName: string,
  text: string,
): {
  read?: DrawingImport;
  error?: string;
} {
  const format = drawingFormat(fileName);
  if (!format) return { error: 'Extrudo imports SVG and DXF drawings.' };
  try {
    return { read: format === 'svg' ? readSvg(text) : readDxf(text) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: reason };
  }
}

/**
 * The tool's start: it picks a file, reads it and runs the tool with the result
 * in the draft. `false` when the user cancelled, so no tool runs and no panel
 * opens; a file that couldn't be read still opens the panel, with its reason.
 */
export async function pickDrawing(deps: DrawingPicker): Promise<boolean> {
  const file = await deps.files.pick(DRAWING_ACCEPT);
  if (!file) {
    resetImportDrawingDraft();
    return false;
  }
  let read: ReturnType<typeof readDrawing>;
  try {
    read = readDrawing(file.name, await file.text());
  } catch (error) {
    // A file that can't even be read as text (or a file reader that refuses).
    read = {
      error: `This file couldn't be read: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }
  const draft = draftFromImport(file.name, read.read, read.error);
  importDrawingStore.setState(draft);
  if (draft.error) deps.notify('error', `${file.name}: ${draft.error}`);
  deps.host.start(IMPORT_DRAWING_TOOL);
  return true;
}
