/**
 * `importFcstd`: a FreeCAD file as a new Extrudo design (P6-25, ADR-0144).
 * Each PartDesign body comes in with its history as far as it can be rebuilt
 * and proven equal to what the file stores (S5, `bodies.ts`), carrying on from
 * a stored shape where a feature can't be (S8); every other final shape, and
 * a body whose features up to its last couldn't be rebuilt, comes in as a STEP
 * attachment on an `import` feature (S3, `shapes.ts`), with one Remove taking
 * out what was rebuilt of such a body.
 */
import { Design } from '@extrudo/api';
import type { AttachmentId } from '@extrudo/core';
import type { SketchSolver } from '@extrudo/sketch';
import { Binder } from './bind';
import {
  type BodyHistory,
  bodyChain,
  importBodies,
  MAX_BODY_FEATURES,
  MAX_FILE_FEATURES,
  markWalkShared,
  newWalkShared,
} from './bodies';
import { KernelBudget } from './budget';
import { finalShapes, linkArrayProblem } from './final-shapes';
import type { ImportKernel } from './import-kernel';
import { type LooseChain, looseChains } from './loose-chains';
import { readFcstd, storedShapeEntry } from './model';
import { cleanName } from './names';
import { type ParametersReport, parametersReport } from './parameters-report';
import { prepareParameters } from './params';
import { importTrees, type TreeImport } from './part-import';
import { partTrees } from './part-tree';
import { type ImportedShape, importShapes, type LeftOutShape, setBodies } from './shapes';
import { containerChain, releasePlane } from './sketch-place';

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
  /** The stored-shape steps' caps (`MAX_BODY_STEPS`, `MAX_STEP_TEXT_BYTES`), for tests. */
  readonly maxSteps?: number;
  /** S9's `MAX_DATUMS` and `MAX_EXTERNAL_PER_FILE`, for tests. */
  readonly maxDatums?: number;
  readonly maxExternal?: number;
  readonly maxStepTextBytes?: number;
  /** ADR-0066's 100 MB of attachments per design, for tests (the steps and the shapes import alike). */
  readonly maxAttachmentsBytes?: number;
  /** S10's `MAX_IMPORT_PARAMETERS` and `MAX_IMPORT_EXPRESSIONS`, for tests. */
  readonly maxParameters?: number;
  readonly maxExpressions?: number;
  /** S11's limits (`MAX_TREE_NODES`, `MAX_IMPORT_TREE_NODES`, `MAX_TREE_PASSES`, `MAX_TREE_FEATURES`, `MAX_OPERAND_BODIES`), for tests. */
  readonly maxOperandBodies?: number;
  readonly maxTreeNodes?: number;
  readonly maxImportTreeNodes?: number;
  readonly maxTreePasses?: number;
  readonly maxTreeFeatures?: number;
  /** S12a's `MAX_LOOSE_CHAINS`, for tests. */
  readonly maxLooseChains?: number;
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
  /** The file's parameters and expressions (S10): what came in, and every expression's outcome. */
  readonly parameters: ParametersReport;
  /** The Part workbench's trees (S11), in document order of their tops: what each object became. */
  readonly trees: readonly TreeImport[];
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
  // S10: the file's parameters, before the first sketch or feature, in one undo step.
  const prepared = prepareParameters(doc, design, {
    ...(options.maxParameters !== undefined ? { maxParameters: options.maxParameters } : {}),
    ...(options.maxExpressions !== undefined ? { maxExpressions: options.maxExpressions } : {}),
  });
  const binder = new Binder(design, prepared, (plane) => releasePlane(design, plane));
  const budget = new KernelBudget(options.kernel, options);
  // S11: the Part workbench's trees, planned from the file alone.
  const plan = partTrees(doc, shapes, {
    ...(options.maxTreeNodes !== undefined ? { maxTreeNodes: options.maxTreeNodes } : {}),
    ...(options.maxImportTreeNodes !== undefined
      ? { maxImportNodes: options.maxImportTreeNodes }
      : {}),
  });
  // S12a: the PartDesign features in no body, as rows of features ending in a final shape.
  const loose = new Map<string, LooseChain>(
    looseChains(
      doc,
      shapes.filter((s) => s.kind === 'chain-tip'),
      {
        maxFeatures: options.maxBodyFeatures ?? MAX_BODY_FEATURES,
        maxFile: options.maxFileFeatures ?? MAX_FILE_FEATURES,
        ...(options.maxLooseChains !== undefined ? { maxChains: options.maxLooseChains } : {}),
      },
    ).map((c) => [c.tip.name, c]),
  );
  // Progress: each feature the walk takes, each tree node, then each shape converted.
  const steps =
    shapes.reduce((n, s) => {
      if (s.kind === 'chain-tip') return n + (loose.get(s.object.name)?.features.length ?? 0);
      if (s.kind !== 'body') return n;
      const chain = bodyChain(doc, s.object);
      return n + ('features' in chain ? chain.features.length : 0);
    }, 0) + plan.trees.reduce((n, t) => n + t.order.length, 0);
  let walked = 0;
  // The stored-shape steps' STEP bytes (S8), then the shapes import's.
  const stepFiles = new Map<AttachmentId, Uint8Array>();
  const known = { ids: [] as string[] };
  // One set of counters for the body walk and every body a tree uses (S11).
  const shared = newWalkShared(options.maxExternal);
  const walkOptions = {
    shared,
    files: stepFiles,
    ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
    ...(options.maxDatums !== undefined ? { maxDatums: options.maxDatums } : {}),
    ...(options.maxExternal !== undefined ? { maxExternal: options.maxExternal } : {}),
    ...(options.maxStepTextBytes !== undefined
      ? { maxStepTextBytes: options.maxStepTextBytes }
      : {}),
    ...(options.maxAttachmentsBytes !== undefined
      ? { maxAttachmentsBytes: options.maxAttachmentsBytes }
      : {}),
    budget,
    binder,
    ...(options.solver ? { solver: options.solver } : {}),
    ...(options.maxBodyFeatures !== undefined ? { maxBodyFeatures: options.maxBodyFeatures } : {}),
    ...(options.maxFileFeatures !== undefined ? { maxFileFeatures: options.maxFileFeatures } : {}),
    ...(options.originFirst === false ? { originFirst: false } : {}),
    ...(options.onUntouched ? { onUntouched: options.onUntouched } : {}),
    onStep: () => options.onProgress?.(++walked, steps + shapes.length),
  };
  const histories = await importBodies(doc, shapes, design, { ...walkOptions, known, loose });
  const treeWalk = await importTrees(doc, plan, design, {
    budget,
    binder,
    files: stepFiles,
    ...(options.maxAttachmentsBytes !== undefined
      ? { maxAttachmentsBytes: options.maxAttachmentsBytes }
      : {}),
    known: known.ids,
    ...(options.maxTreePasses !== undefined ? { maxPasses: options.maxTreePasses } : {}),
    ...(options.maxTreeFeatures !== undefined ? { maxFeatures: options.maxTreeFeatures } : {}),
    ...(options.maxOperandBodies !== undefined
      ? { maxOperandBodies: options.maxOperandBodies }
      : {}),
    markWalk: () => markWalkShared(shared),
    onStep: () => options.onProgress?.(++walked, steps + shapes.length),
    // A PartDesign body a tree uses: walked as any body is, from the design's bodies so far.
    walkBody: async (body, ids) => {
      const at = { ids: [...ids] };
      const [history] = await importBodies(
        doc,
        [
          {
            kind: 'body',
            object: body,
            source: body,
            entry: storedShapeEntry(doc, body),
            format: 'brep',
            name: body.label,
            visible: true,
            chain: containerChain(doc, body)?.chain ?? [],
          },
        ],
        design,
        { ...walkOptions, known: at },
      );
      return { history: history as BodyHistory, known: at.ids };
    },
  });
  binder.finish();
  const complete = new Set(histories.filter((h) => !h.stop).map((h) => h.object));
  const byTop = new Map(shapes.map((s) => [s.object.name, s]));
  for (const t of treeWalk.trees)
    if (t.outcome === 'history' || t.outcome === 'leaves') {
      complete.add(t.object);
      const shape = byTop.get(t.object);
      if (shape) setBodies(design, t.bodies, shape, t.name);
    }
  const rest = shapes.filter(
    (s) =>
      !(
        (s.kind === 'body' || s.kind === 'shape' || s.kind === 'chain-tip') &&
        complete.has(s.object.name)
      ),
  );
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
    files: new Map([...stepFiles, ...result.files]),
    report: {
      shapes: result.imported,
      leftOut: result.leftOut,
      finalShapes: shapes.length,
      problems: doc.problems.filter((p) => !arrayLines.has(p)),
      linkArrays,
      restarts: budget.restarts,
      bodies,
      parameters: parametersReport(prepared, binder, design.doc),
      trees: treeWalk.trees.map((t) =>
        t.outcome === 'shape' && !came.has(t.object) ? { ...t, outcome: 'left-out' } : t,
      ),
    },
  };
}
