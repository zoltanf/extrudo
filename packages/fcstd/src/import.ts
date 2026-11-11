/**
 * `importFcstd`: a FreeCAD file as a new Extrudo design (P6-25 S3, ADR-0144).
 * This slice brings the file's final shapes as STEP attachments on `import`
 * features; later slices add sketches and features on top.
 */
import { Design } from '@extrudo/api';
import type { AttachmentId } from '@extrudo/core';
import { finalShapes, linkArrayProblem } from './final-shapes';
import type { ImportKernel } from './import-kernel';
import { readFcstd } from './model';
import { cleanName } from './names';
import { type ImportedShape, importShapes, type LeftOutShape } from './shapes';

/**
 * The most a `.FCStd` file may be before it is read: the import holds the
 * bytes, the entries it inflates and the XML tree at once (the library's
 * largest file is 25 MB).
 */
export const MAX_FCSTD_BYTES = 100 * 1024 * 1024;

export interface FcstdImportOptions {
  readonly kernel: ImportKernel;
  /** The design's own ID and the app's version, as `Design.create` takes them. */
  readonly id?: string;
  readonly appVersion?: string;
  readonly shapeTimeoutMs?: number;
  readonly importTimeoutMs?: number;
  readonly maxRestarts?: number;
  readonly onProgress?: (done: number, total: number) => void;
  readonly now?: () => number;
}

/** What the import did, as plain data: the app words it. */
export interface FcstdImportReport {
  /** The final shapes that came in, in document order. */
  readonly shapes: readonly ImportedShape[];
  /** The final shapes left out, each with why. */
  readonly leftOut: readonly LeftOutShape[];
  /** How many final shapes the file has. */
  readonly finalShapes: number;
  /** What the reader couldn't read or left out, one line each. */
  readonly problems: readonly string[];
  /** The labels of link arrays, of which only the link itself was placed. */
  readonly linkArrays: readonly string[];
  /** How many times the import's kernel was replaced after a failure. */
  readonly restarts: number;
}

export interface FcstdImportResult {
  readonly design: Design;
  /** The attachments' bytes, by attachment ID: write them before the document. */
  readonly files: ReadonlyMap<AttachmentId, Uint8Array>;
  readonly report: FcstdImportReport;
}

/**
 * Reads a `.FCStd` file and makes a design named `name` from its final
 * shapes. Throws `FcstdFormatError` when the file can't be read at all; a
 * file with no shape gives an empty design and a report that says so.
 */
export async function importFcstd(
  bytes: Uint8Array,
  name: string,
  options: FcstdImportOptions,
): Promise<FcstdImportResult> {
  const doc = readFcstd(bytes);
  const shapes = finalShapes(doc);
  const design = Design.create({
    name,
    units: 'mm',
    ...(options.id ? { id: options.id as never } : {}),
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
  });
  const result = await importShapes(doc, shapes, design, options);
  const arrays = doc.objects.filter((o) => {
    const count = o.properties.ElementCount?.value;
    return o.type === 'App::Link' && count?.kind === 'integer' && count.value > 0;
  });
  const linkArrays = arrays.map((o) => cleanName(o.label, o.name));
  // The reader notes each link array as a problem too; the report lists them on their own.
  const arrayLines = new Set(arrays.map((o) => linkArrayProblem(o.name)));
  return {
    design,
    files: result.files,
    report: {
      shapes: result.imported,
      leftOut: result.leftOut,
      finalShapes: shapes.length,
      problems: doc.problems.filter((p) => !arrayLines.has(p)),
      linkArrays,
      restarts: result.restarts,
    },
  };
}
