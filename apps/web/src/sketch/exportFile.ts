/**
 * A sketch as an SVG or DXF file (P1-13, ADR-0022): its curves, all its
 * profiles, or the profiles the user selected. The geometry comes from
 * `@extrudo/sketch/export`, the file text from `@extrudo/io`; the export
 * dialog shows the size and saves the file through the platform.
 */
import type { SketchData } from '@extrudo/core';
import { type Bounds, type Drawing, drawingBounds, writeDxf, writeSvg } from '@extrudo/io';
import { profileDrawing, sketchDrawing } from '@extrudo/sketch/export';
import { safeFileName } from '../platform/files';
import { sketchProfiles } from './profiles';

export type ExportFormat = 'svg' | 'dxf';

/** All curves, every profile, or the selected profiles. */
export type ExportContent = 'curves' | 'profiles' | 'selected';

export interface SketchExportOptions {
  format: ExportFormat;
  content: ExportContent;
  /** With `curves`: construction geometry too, on its own layer. */
  construction: boolean;
  /** With `selected`: the region IDs within the sketch. */
  selected?: readonly string[];
}

export interface SketchExport {
  drawing: Drawing;
  /** Undefined when there's nothing to export. */
  bounds: Bounds | undefined;
  /** Curves or profiles in the file. */
  count: number;
}

/** What an export of `data` would contain, for the dialog's summary and the file. */
export function sketchExport(
  data: SketchData,
  title: string,
  options: Omit<SketchExportOptions, 'format'>,
): SketchExport {
  let drawing: Drawing;
  if (options.content === 'curves') {
    drawing = sketchDrawing(data, { title, construction: options.construction });
  } else {
    const wanted = options.content === 'selected' ? new Set(options.selected) : undefined;
    const profiles = sketchProfiles(data).filter((p) => !wanted || wanted.has(p.id));
    drawing = profileDrawing(data, profiles, { title });
  }
  return { drawing, bounds: drawingBounds(drawing), count: drawing.shapes.length };
}

const TYPES: Record<ExportFormat, string> = {
  svg: 'image/svg+xml',
  dxf: 'application/dxf',
};

/** The file: its text as a blob and a name from the project and the sketch. */
export function sketchExportFile(
  exported: SketchExport,
  format: ExportFormat,
  names: { project: string; sketch: string },
): { blob: Blob; name: string } {
  const text = format === 'svg' ? writeSvg(exported.drawing) : writeDxf(exported.drawing);
  return {
    blob: new Blob([text], { type: TYPES[format] }),
    name: safeFileName(`${names.project} - ${names.sketch}`, `.${format}`),
  };
}
