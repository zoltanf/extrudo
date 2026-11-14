/**
 * `importFcstd`: a FreeCAD file as a new Extrudo design (P6-25, ADR-0144).
 * Each PartDesign body comes in with its history as far as it can be rebuilt
 * and proven equal to what the file stores (S5, `bodies.ts`); every other
 * final shape, and a body whose history stopped before its last feature,
 * comes in as a STEP attachment on an `import` feature (S3, `shapes.ts`),
 * with one Remove taking out what was rebuilt of such a body.
 */
import { Design } from '@extrudo/api';
import type { AttachmentId } from '@extrudo/core';
import type { SketchSolver } from '@extrudo/sketch';
import { type BodyHistory, bodyChain, importBodies } from './bodies';
import { KernelBudget } from './budget';
import { finalShapes, linkArrayProblem } from './final-shapes';
import type { ImportKernel } from './import-kernel';
import { readFcstd } from './model';
import { cleanName } from './names';
import { type ImportedShape, importShapes, type LeftOutShape, setBodies } from './shapes';

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
  /** Vets the sketches' constraints (planegcs, which the caller loads); without one no constraint is imported. */
  readonly solver?: SketchSolver;
  readonly onProgress?: (done: number, total: number) => void;
  readonly now?: () => number;
  /** The history walk's limits (`MAX_BODY_FEATURES`, `MAX_FILE_FEATURES`), for tests. */
  readonly maxBodyFeatures?: number;
  readonly maxFileFeatures?: number;
  /** A transform's reference prefers a coinciding origin axis or plane (default); tests turn it off (S7). */
  readonly originFirst?: boolean;
  /** Hears how far each other body moved between two rebuilds (tests and the library run). */
  readonly onUntouched?: (d: import('./check').Drift) => void;
}

/** What happened to one PartDesign body: its history, and whether its final shape came in (S3's way). */
export interface BodyImport extends BodyHistory {
  /**
   * `history`: every feature came in, no `import`. `shape`: the final shape
   * came in as an `import` (a Remove took out what was rebuilt). `left-out`:
   * the history stopped and the final shape couldn't come in (`leftOut` says
   * why); what was rebuilt stays.
   */
  readonly outcome: 'history' | 'shape' | 'left-out';
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
  /** Each PartDesign body, in document order: what came in with its history and where it stopped. */
  readonly bodies: readonly BodyImport[];
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
  const budget = new KernelBudget(options.kernel, options);
  // Progress: each feature the walk takes, then each shape converted.
  const steps = shapes.reduce((n, s) => {
    if (s.kind !== 'body') return n;
    const chain = bodyChain(doc, s.object);
    return n + ('features' in chain ? chain.features.length : 0);
  }, 0);
  let walked = 0;
  const histories = await importBodies(doc, shapes, design, {
    budget,
    ...(options.solver ? { solver: options.solver } : {}),
    ...(options.maxBodyFeatures !== undefined ? { maxBodyFeatures: options.maxBodyFeatures } : {}),
    ...(options.maxFileFeatures !== undefined ? { maxFileFeatures: options.maxFileFeatures } : {}),
    ...(options.originFirst === false ? { originFirst: false } : {}),
    ...(options.onUntouched ? { onUntouched: options.onUntouched } : {}),
    onStep: () => options.onProgress?.(++walked, steps + shapes.length),
  });
  const complete = new Set(histories.filter((h) => !h.stop).map((h) => h.object));
  const rest = shapes.filter((s) => !(s.kind === 'body' && complete.has(s.object.name)));
  const removesAt = design.doc.features.length;
  const result = await importShapes(doc, rest, design, {
    ...options,
    budget,
    onProgress: (done, total) => options.onProgress?.(walked + done, walked + total),
  });
  const came = new Set(result.imported.map((s) => s.object));
  const byObject = new Map(rest.map((s) => [s.object.name, s]));
  const bodies: BodyImport[] = histories.map((h) => ({
    ...h,
    outcome: !h.stop ? 'history' : came.has(h.object) ? 'shape' : 'left-out',
  }));
  design.transaction('Take out the rebuilt bodies', () => {
    let index = removesAt;
    for (const b of bodies) {
      if (b.bodies.length === 0) continue;
      if (b.outcome === 'shape')
        design.add(
          'remove',
          { bodies: b.bodies.map((id) => ({ kind: 'body', id })) },
          { name: `Remove ${b.name}`, index: index++ },
        );
      else if (b.outcome === 'left-out') {
        // The file's shape couldn't come in: what was rebuilt stands in for it, named as the file names it.
        const shape = byObject.get(b.object);
        if (shape) setBodies(design, b.bodies, shape, b.name);
      }
    }
  });
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
      restarts: budget.restarts,
      bodies,
    },
  };
}
