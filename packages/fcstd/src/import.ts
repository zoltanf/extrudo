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
import { MAX_ATTACHMENTS_BYTES } from '@extrudo/storage';
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
import { type ComponentsReport, componentGroups, makeComponents } from './components';
import { type CompoundImport, type CompoundPlan, planCompounds } from './compounds';
import { type FinalShape, finalShapes, linkArrayProblem } from './final-shapes';
import type { ImportKernel } from './import-kernel';
import type { LinkImport } from './links';
import { type LooseChain, looseChains, loosePlanner } from './loose-chains';
import type { MeshImport } from './meshes';
import { type FcObject, readFcstd, storedShapeEntry } from './model';
import { cleanName } from './names';
import { type ParametersReport, parametersReport } from './parameters-report';
import { prepareParameters } from './params';
import { importTrees, type TreeImport } from './part-import';
import { MAX_IMPORT_TREE_NODES, partTrees } from './part-tree';
import { type ImportedShape, importShapes, type LeftOutShape, setBodies } from './shapes';
import { containerChain, forgetRemovedPlanes, releasePlane } from './sketch-place';
import { placeStructure } from './structure';
import { StructureBuild } from './structure-build';

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
  /** S12b's `MAX_MESH_FACETS` and `MAX_IMPORT_MESHES`, for tests. */
  readonly maxMeshFacets?: number;
  readonly maxMeshes?: number;
  /** S12b's `MAX_IMPORT_MESH_FACETS`, for tests. */
  readonly maxImportMeshFacets?: number;
  /** S12b's `MAX_ARRAY_ELEMENTS`, `MAX_LINK_COPIES`, `MAX_COMPOUND_OBJECTS` and `MAX_IMPORT_COMPONENTS`, for tests. */
  readonly maxArrayElements?: number;
  readonly maxLinkCopies?: number;
  readonly maxCompoundObjects?: number;
  /** S12b's `MAX_PART_MEMBERS`, for tests (the bodies one copy takes follow `maxOperandBodies`). */
  readonly maxPartMembers?: number;
  readonly maxComponents?: number;
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
  /** The labels of link arrays that couldn't be expanded, of which only the link itself was placed. */
  readonly linkArrays: readonly string[];
  /** How many times the import's kernel was replaced after a failure. */
  readonly restarts: number;
  /** Each PartDesign body, in document order: what came in with its history and where it stopped. */
  readonly bodies: readonly BodyImport[];
  /** The file's parameters and expressions (S10): what came in, and every expression's outcome. */
  readonly parameters: ParametersReport;
  /** The Part workbench's trees (S11), in document order of their tops: what each object became. */
  readonly trees: readonly TreeImport[];
  /** The meshes that are final shapes (S12b), each in or left out (the left out are in `leftOut` too). */
  readonly meshes: readonly MeshImport[];
  /** Each link that is a final shape (S12b): a copy of what its target became, as today, or left out. */
  readonly links: readonly LinkImport[];
  /** Each compound at the top (S12b): as its members, or as today with the reason. */
  readonly compounds: readonly CompoundImport[];
  /** The components made from parts, compounds and links to parts (S12b). */
  readonly components: ComponentsReport;
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
  const planner = loosePlanner(doc);
  // S12b: a compound at the top may come in as its members (after everything else, below).
  const compounds = planCompounds(
    doc,
    shapes,
    (o) => planner.isLoose(o),
    options.maxCompoundObjects,
  );
  const expandable = new Set(
    compounds.filter((c): c is CompoundPlan => 'members' in c).map((c) => c.compound.object.name),
  );
  // S11: the Part workbench's trees, planned from the file alone.
  const treeNodesMax = options.maxImportTreeNodes ?? MAX_IMPORT_TREE_NODES;
  const plan = partTrees(doc, shapes, {
    isLoose: planner.endsChain,
    ...(options.maxTreeNodes !== undefined ? { maxTreeNodes: options.maxTreeNodes } : {}),
    maxImportNodes: treeNodesMax,
  });
  let treeNodesUsed = plan.trees.reduce((n, t) => n + t.order.length, 0);
  const chainLimits = {
    maxFeatures: options.maxBodyFeatures ?? MAX_BODY_FEATURES,
    maxFile: options.maxFileFeatures ?? MAX_FILE_FEATURES,
    ...(options.maxLooseChains !== undefined ? { maxChains: options.maxLooseChains } : {}),
  };
  /** S12a: the PartDesign features in no body, as rows of features ending in a final shape. */
  const looseOf = (list: readonly FinalShape[]) =>
    new Map<string, LooseChain>(
      looseChains(
        doc,
        list.filter((s) => s.kind === 'chain-tip' && planner.isLoose(s.object)),
        chainLimits,
        planner,
      ).map((c) => [c.tip.name, c]),
    );
  const loose = looseOf(shapes);
  // Progress: each feature the walk takes, each tree node, then each shape converted.
  const steps =
    shapes.reduce((n, s) => {
      if (s.kind === 'chain-tip') return n + (loose.get(s.object.name)?.features.length ?? 0);
      if (s.kind !== 'body') return n;
      const chain = bodyChain(doc, s.object);
      return n + ('features' in chain ? chain.features.length : 0);
    }, 0) + treeNodesUsed;
  let done = 0;
  const total = () => steps + shapes.length;
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
    onStep: () => options.onProgress?.(++done, total()),
  };
  const treeOptions = (ids: string[], room?: number, quiet = false) => ({
    budget,
    binder,
    files: stepFiles,
    ...(room !== undefined
      ? { maxAttachmentsBytes: room }
      : options.maxAttachmentsBytes !== undefined
        ? { maxAttachmentsBytes: options.maxAttachmentsBytes }
        : {}),
    known: ids,
    ...(options.maxTreePasses !== undefined ? { maxPasses: options.maxTreePasses } : {}),
    ...(options.maxTreeFeatures !== undefined ? { maxFeatures: options.maxTreeFeatures } : {}),
    ...(options.maxOperandBodies !== undefined
      ? { maxOperandBodies: options.maxOperandBodies }
      : {}),
    markWalk: () => markWalkShared(shared),
    onStep: quiet ? () => {} : () => options.onProgress?.(++done, total()),
    // A PartDesign body a tree uses, or a loose chain ending at the feature it uses (S12a):
    // walked as any body is, from the design's bodies so far.
    walkBody: async (body: FcObject, bodyIds: readonly string[]) => {
      const at = { ids: [...bodyIds] };
      const isBody = body.type === 'PartDesign::Body';
      const operand = isBody
        ? undefined
        : planner.chain(
            body,
            {
              maxFeatures: options.maxBodyFeatures ?? MAX_BODY_FEATURES,
              maxFile: options.maxFileFeatures ?? MAX_FILE_FEATURES,
            },
            // Its own count: what a chain walks is counted by the walk, which a cancelled pass gives back.
            { features: 0 },
          );
      const [history] = await importBodies(
        doc,
        [
          {
            kind: isBody ? 'body' : 'chain-tip',
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
        {
          ...walkOptions,
          ...(room !== undefined ? { maxAttachmentsBytes: room } : {}),
          ...(quiet ? { onStep: () => {} } : {}),
          known: at,
          ...(operand ? { loose: new Map([[body.name, operand]]) } : {}),
        },
      );
      return { history: history as BodyHistory, known: at.ids };
    },
  });
  const histories = await importBodies(doc, shapes, design, { ...walkOptions, known, loose });
  const treeWalk = await importTrees(doc, plan, design, treeOptions(known.ids));
  const complete = new Set(histories.filter((h) => !h.stop).map((h) => h.object));
  const byTop = new Map(shapes.map((s) => [s.object.name, s]));
  for (const t of treeWalk.trees)
    if (t.outcome === 'history' || t.outcome === 'leaves') {
      complete.add(t.object);
      const shape = byTop.get(t.object);
      if (shape) setBodies(design, t.bodies, shape, t.name);
    }
  // Everything that came in before this slice is converted here, before any new attempt (S12b):
  // the links and the compounds that may come in another way are converted but not added yet.
  const rest = shapes.filter(
    (s) =>
      s.kind !== 'mesh' &&
      !(
        (s.kind === 'body' || s.kind === 'shape' || s.kind === 'chain-tip') &&
        complete.has(s.object.name)
      ),
  );
  const defer = new Set(
    rest
      .filter((s) => s.kind === 'link' || expandable.has(s.object.name))
      .map((s) => s.object.name),
  );
  const removesAt = design.doc.features.length;
  const result = await importShapes(doc, rest, design, {
    ...options,
    budget,
    defer,
    onProgress: (n, all) => options.onProgress?.(done + n, done + all),
  });
  done += rest.length;
  const came = new Set(result.imported.map((s) => s.object));
  const byObject = new Map(rest.map((s) => [s.object.name, s]));
  const asImports = (hs: readonly BodyHistory[], landed: ReadonlySet<string>): BodyImport[] =>
    hs.map((h) => ({
      ...h,
      outcome: !h.stop ? 'history' : landed.has(h.object) ? 'shape' : 'left-out',
    }));
  const bodies = asImports(histories, came);
  /** Takes out what was rebuilt of a body whose own shape came in, names what stands in for one that didn't. */
  const settleBodies = (
    list: readonly BodyImport[],
    shapeOf: ReadonlyMap<string, FinalShape>,
    at?: number,
  ) => {
    let index = at;
    design.transaction('Take out the rebuilt bodies', () => {
      for (const b of list) {
        if (b.bodies.length === 0) continue;
        if (b.outcome === 'shape')
          design.add(
            'remove',
            { bodies: b.bodies.map((id) => ({ kind: 'body', id })) },
            { name: `Remove ${b.name}`, ...(index !== undefined ? { index: index++ } : {}) },
          );
        else if (b.outcome === 'left-out') {
          // The file's shape couldn't come in: what was rebuilt stands in for it, named as the file names it.
          const shape = shapeOf.get(b.object);
          if (shape) setBodies(design, b.bodies, shape, b.name);
        }
      }
    });
  };
  settleBodies(bodies, byObject, removesAt);
  // Which bodies each final shape (or a compound's member) came in as (S12b).
  const cameAs = new Map<string, string[]>();
  const partial = new Map<string, string[]>();
  const noteWalk = (
    bs: readonly BodyImport[],
    ts: readonly TreeImport[],
    imported: readonly ImportedShape[],
    into: Map<string, string[]>,
    part: Map<string, string[]>,
  ) => {
    for (const b of bs)
      if (b.outcome === 'history') into.set(b.object, [...b.bodies]);
      else if (b.outcome === 'left-out' && b.bodies.length > 0) part.set(b.object, [...b.bodies]);
    for (const t of ts)
      if (t.outcome === 'history' || t.outcome === 'leaves') into.set(t.object, [...t.bodies]);
    for (const s of imported)
      into.set(
        s.object,
        Array.from({ length: s.solids }, (_, i) => `${s.feature}:${i}`),
      );
  };
  noteWalk(bodies, treeWalk.trees, result.imported, cameAs, partial);
  // S12b: compounds as their members, meshes, links as copies: each checked on its own.
  const build = new StructureBuild(design, budget, new Map([...stepFiles, ...result.files]));
  const structure = await placeStructure({
    doc,
    shapes,
    compounds,
    design,
    build,
    budget,
    bodies: cameAs,
    partial,
    held: result.deferred,
    options: {
      // Each mesh is one step (the links and compounds were converted in the shapes import).
      onStep: () => options.onProgress?.(++done, total()),
      ...(options.maxMeshFacets !== undefined ? { maxMeshFacets: options.maxMeshFacets } : {}),
      ...(options.maxMeshes !== undefined ? { maxMeshes: options.maxMeshes } : {}),
      ...(options.maxImportMeshFacets !== undefined
        ? { maxImportMeshFacets: options.maxImportMeshFacets }
        : {}),
      ...(options.maxArrayElements !== undefined
        ? { maxArrayElements: options.maxArrayElements }
        : {}),
      ...(options.maxLinkCopies !== undefined ? { maxLinkCopies: options.maxLinkCopies } : {}),
      ...(options.maxPartMembers !== undefined ? { maxPartMembers: options.maxPartMembers } : {}),
      ...(options.maxOperandBodies !== undefined
        ? { maxCopySources: options.maxOperandBodies }
        : {}),
      ...(options.maxAttachmentsBytes !== undefined
        ? { maxAttachmentsBytes: options.maxAttachmentsBytes }
        : {}),
    },
    hooks: {
      mark: () => {
        const binderBack = binder.mark();
        // What the members' walk notes about the file goes with it if it is cancelled.
        const problems = doc.problems.length;
        const walkBack = markWalkShared(shared);
        const stepKeys = new Set(stepFiles.keys());
        const buildKeys = new Set(build.files.keys());
        const used = treeNodesUsed;
        return () => {
          binderBack();
          walkBack();
          doc.problems.length = problems;
          // The planes the members' sketches made went with them.
          forgetRemovedPlanes(design);
          for (const id of [...stepFiles.keys()]) if (!stepKeys.has(id)) stepFiles.delete(id);
          for (const id of [...build.files.keys()]) if (!buildKeys.has(id)) build.files.delete(id);
          treeNodesUsed = used;
        };
      },
      walkMembers: async (members) => {
        const live = await build.live();
        if ('stop' in live) throw new Error(live.detail ?? live.stop);
        const at = { ids: [...live] };
        const stepsBefore = new Set(stepFiles.keys());
        // What the members may add beside the design: the limit less the bytes still held for
        // the links and compounds not settled yet (this compound's own among them).
        const room =
          (options.maxAttachmentsBytes ?? MAX_ATTACHMENTS_BYTES) - result.deferred.held();
        // The members' steps aren't counted in the import's progress (they weren't in its total).
        const hs = await importBodies(doc, members, design, {
          ...walkOptions,
          maxAttachmentsBytes: room,
          onStep: () => {},
          known: at,
          loose: looseOf(members),
        });
        const memberPlan = partTrees(doc, members, {
          isLoose: planner.endsChain,
          ...(options.maxTreeNodes !== undefined ? { maxTreeNodes: options.maxTreeNodes } : {}),
          // The import's tree nodes are one count, the members' trees included.
          maxImportNodes: Math.max(0, treeNodesMax - treeNodesUsed),
        });
        treeNodesUsed += memberPlan.trees.reduce((n, t) => n + t.order.length, 0);
        const tw = await importTrees(doc, memberPlan, design, treeOptions(at.ids, room, true));
        const whole = new Set(hs.filter((h) => !h.stop).map((h) => h.object));
        const byMember = new Map(members.map((m) => [m.object.name, m]));
        for (const t of tw.trees)
          if (t.outcome === 'history' || t.outcome === 'leaves') {
            whole.add(t.object);
            const shape = byMember.get(t.object);
            if (shape) setBodies(design, t.bodies, shape, t.name);
          }
        const left = members.filter((m) => !whole.has(m.object.name));
        const r = await importShapes(doc, left, design, {
          kernel: options.kernel,
          budget,
          maxAttachmentsBytes: room,
        });
        const memberBodies = asImports(hs, new Set(r.imported.map((s) => s.object)));
        settleBodies(memberBodies, byMember);
        const got = new Map<string, string[]>();
        const part = new Map<string, string[]>();
        noteWalk(memberBodies, tw.trees, r.imported, got, part);
        const files = new Map(r.files);
        for (const [id, b] of stepFiles) if (!stepsBefore.has(id)) files.set(id, b);
        // The check's rebuild needs them now; a cancel takes them back (`mark`).
        for (const [id, b] of files) build.files.set(id, b);
        const marked = new Set(r.imported.map((s) => s.object));
        return {
          bodies: got,
          partial: part,
          histories: memberBodies,
          trees: tw.trees.map((t) =>
            t.outcome === 'shape' && !marked.has(t.object) ? { ...t, outcome: 'left-out' } : t,
          ),
          imported: r.imported,
          leftOut: r.leftOut,
          files,
        };
      },
    },
  });
  binder.finish();
  // What didn't hold comes in as S3 brought it, from the STEP the shapes import made.
  const after = result.deferred.add(structure.fallback);
  noteWalk([], [], after.imported, cameAs, partial);
  for (const [id, bytes] of after.files) build.files.set(id, bytes);
  const linksToParts = new Set(structure.links.filter((l) => l.part).map((l) => l.object));
  const asMembers = new Set(
    structure.compounds.filter((c) => c.outcome === 'members').map((c) => c.object),
  );
  const components = makeComponents(
    design,
    doc,
    componentGroups(doc, shapes, cameAs, partial, linksToParts, asMembers),
    [...new Set([...build.ids, ...[...cameAs.values()].flat(), ...[...partial.values()].flat()])],
    options.maxComponents,
  );
  const members = structure.members;
  const meshes = structure.meshes;
  const shapesIn = [...result.imported, ...members.flatMap((m) => m.imported), ...after.imported];
  // Of the link arrays, the ones that came in as S3 brought them: one copy each.
  const landed = new Set(after.imported.map((s) => s.object));
  const arrays = doc.objects.filter((o) => {
    const count = o.properties.ElementCount?.value;
    return o.type === 'App::Link' && count?.kind === 'integer' && count.value > 0;
  });
  const linkArrays = arrays
    .filter((o) => landed.has(o.name))
    .map((o) => cleanName(o.label, o.name));
  // The reader notes each link array as a problem too; the report lists them on their own.
  const arrayLines = new Set(arrays.map((o) => linkArrayProblem(o.name)));
  return {
    design,
    files: build.files,
    report: {
      shapes: shapesIn,
      leftOut: [
        ...result.leftOut,
        ...members.flatMap((m) => m.leftOut),
        ...after.leftOut,
        ...structure.scaled.map(
          (l): LeftOutShape => ({
            object: l.object,
            name: l.name,
            reason: 'scaled',
            ...(l.detail ? { detail: l.detail } : {}),
          }),
        ),
        ...meshes.flatMap((m): LeftOutShape[] =>
          m.outcome === 'in'
            ? []
            : [
                {
                  object: m.object,
                  name: m.name,
                  reason: m.reason ?? 'kernel',
                  ...(m.detail ? { detail: m.detail } : {}),
                },
              ],
        ),
      ],
      finalShapes: shapes.length,
      problems: doc.problems.filter((p) => !arrayLines.has(p)),
      linkArrays,
      restarts: budget.restarts,
      bodies: [...bodies, ...members.flatMap((m) => m.histories)],
      parameters: parametersReport(prepared, binder, design.doc),
      trees: [
        ...treeWalk.trees.map((t) =>
          t.outcome === 'shape' && !came.has(t.object) ? { ...t, outcome: 'left-out' as const } : t,
        ),
        ...members.flatMap((m) => m.trees),
      ],
      meshes,
      links: structure.links,
      compounds: structure.compounds,
      components,
    },
  };
}
