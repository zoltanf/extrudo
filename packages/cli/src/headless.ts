/**
 * Headless computing of a design in Node (P5-03, ADR-0069): what the app does
 * around the kernel, in a script.
 *
 * ```ts
 * const job = await openDesign('bracket.extrudo');        // or the bytes
 * await job.setParameters({ width: '60 mm', wall: '3 mm' });  // re-solves the sketches that read them
 * await job.applyConfiguration('Large');
 * const result = await job.compute();                     // statuses, bodies, volumes, timings
 * const files = await job.export({ format: '3mf' });      // @extrudo/io's writers
 * await job.save('bracket-large.extrudo');                // the changes, with the file's attachments
 * await job.dispose();                                    // frees the kernel
 * ```
 *
 * Everything underneath already runs in Node (ADR-0024's engine, ADR-0001's
 * WASM, ADR-0011's solver), so this is the one place that ties them together:
 *
 * - **The sketch solves.** A parameter a driving dimension reads moves the
 *   sketch, and `settleSketches` (`@extrudo/sketch`, the app's rule since
 *   ADR-0016) solves it in steps and reports what moved. Without it an export
 *   would hold the old shape with no error. This side asks for the scope
 *   `'all'`: every sketch is repaired, so a design whose stored geometry was
 *   pulled out of shape by something else can't be exported stale (the app
 *   keeps the default `'changed'`, which only solves what a change moves).
 * - **The kernel's resources.** The fonts of the design's texts (the bundled
 *   files from `@extrudo/fonts`, or its own attachments) and the files its
 *   `import` features name go to the kernel the way the app's `Recomputer`
 *   sends them (ADR-0058 §4, ADR-0066 §0), and a mesh import loads
 *   manifold-3d before the first compute that needs it.
 * - **The export** is the app's own (`@extrudo/kernel`'s `model-export`), so a
 *   file written here holds what the Export dialog holds: the same presets,
 *   the same names, colours and metadata.
 *
 * Messages are the app's wording: a parameter that isn't there, an expression
 * that doesn't evaluate, a sketch that can't take the change. `HeadlessError`
 * carries them.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Design } from '@extrudo/api';
import {
  type AttachmentId,
  type BodyId,
  type BodyMeta,
  type ExtrudoDocument,
  evaluateParameters,
  type FeatureId,
  importFileOf,
  isMeshMediaType,
  newBodyNames,
  type ReferenceIssue,
  setSketchGeometry,
  updateSketchDimension,
  usedFonts,
} from '@extrudo/core';
import { BUNDLED_FONTS } from '@extrudo/fonts';
import type {
  BodyMesh,
  ExportBody,
  ExportProgress,
  MeshedBodies,
  MeshOptions,
  ModelExporter,
  ModelFormat,
  RecomputeResult,
  Resolution,
} from '@extrudo/kernel';
import { meshBodies, meshBytes, modelFileName, RESOLUTIONS } from '@extrudo/kernel';
import { KernelService, loadOcct } from '@extrudo/kernel/node';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import {
  type SketchSettleChange,
  SketchSettleError,
  settleSketches,
} from '@extrudo/sketch/inference';
import { attachmentNotices, readArchive, type StoredVersion, writeArchive } from '@extrudo/storage';

/** The version the CLI writes into file headers and `info` (the package's own). */
export const EXTRUDO_VERSION = packageJson().version;

/** Anything a design or a call to this library got wrong, in the app's words. */
export class HeadlessError extends Error {
  override name = 'HeadlessError';
}

/**
 * A value a design can't be given: a parameter it doesn't have, or an
 * expression that doesn't evaluate. The CLI's exit codes read these apart
 * from the rest (usage, not a broken design).
 */
export class ParameterError extends HeadlessError {
  override name = 'ParameterError';
}

/** A file that can't be read or written. */
export class FileError extends HeadlessError {
  override name = 'FileError';
}

/** One feature's status after a compute (ADR-0024's `FeatureStatus`). */
export interface FeatureReport {
  id: FeatureId;
  name: string;
  type: string;
  status: 'ok' | 'warning' | 'error';
  message?: string;
  /** References the kernel couldn't follow exactly (ADR-0033). */
  refs?: ReferenceIssue[];
}

/** A body after a compute: what the app's browser shows and the viewport draws. */
export interface BodyReport {
  id: BodyId;
  name: string;
  /** mm³, from the kernel's mass properties (ADR-0067 §H3). */
  volume: number;
  /** The display mesh's box, mm: its min corner and its size. */
  min: [number, number, number];
  size: [number, number, number];
  faces: number;
  /** The body is an imported mesh, not a solid (ADR-0066 §3). */
  mesh: boolean;
}

/** One parameter, as `info` prints it and `--param` names it. */
export interface ParameterReport {
  name: string;
  expression: string;
  value: number | undefined;
  unit: string;
  /** What owns it: a person, a driving dimension or a feature input. */
  owner: 'user' | 'dimension' | 'feature';
  /** For a model parameter: whose it is ("Box1's length"). */
  of?: string;
}

export interface ComputeResult {
  features: FeatureReport[];
  /** The bodies at the timeline marker, in creation order. */
  bodies: BodyReport[];
  /** How many features have an error, and how many a warning. */
  errors: number;
  warnings: number;
  /** The kernel's own timing for the recompute, ms. */
  ms: number;
  /** Features the engine evaluated (cache misses); a cold compute evaluates all. */
  evaluated: number;
}

/** What `status` (and `check`) reads out of a recompute. */
export interface StatusResult {
  features: FeatureReport[];
  /** The bodies at the timeline marker, by name. */
  bodies: { id: BodyId; name: string }[];
  errors: number;
  warnings: number;
  /** The kernel's own timing, ms. */
  ms: number;
}

export interface ExportOptions {
  format: ModelFormat;
  /**
   * The bodies to export, by name or ID (`--bodies`); every live body when
   * left out. A name the design doesn't have is an error.
   */
  bodies?: readonly string[];
  /** A preset or a linear deflection in mm. Medium is the app's default. */
  resolution?: Exclude<Resolution, 'custom'> | number;
  /**
   * One file for every body even when the format is an STL, which otherwise
   * writes one file per body (`--out`).
   */
  singleFile?: boolean;
  onProgress?: ExportProgress;
}

/** One exported file: what `extrudo export` writes. */
export interface ExportedFile {
  name: string;
  bytes: Uint8Array;
  /** The bodies it holds, in the order they were meshed. */
  bodies: string[];
  triangles: number;
  /** Whether every mesh in it is closed and manifold. */
  closed: boolean;
}

export interface OpenDesignOptions {
  /** The tessellation a compute's display meshes use (the kernel's default otherwise). */
  tessellation?: MeshOptions;
}

/** What an archive said about itself (ADR-0050's `loadNotice`, ADR-0061 §2). */
export interface OpenDesignResult {
  job: DesignJob;
  notices: string[];
}

/** Where the bundled fonts' files are (Node): `@extrudo/fonts`' entry, up one. */
const bundledFont = (file: string): string =>
  fileURLToPath(new URL(`../fonts/${file}`, import.meta.resolve('@extrudo/fonts')));

/** This package's own package.json, for the version in file headers. */
function packageJson(): { version: string } {
  const require = createRequire(import.meta.url);
  return require('../package.json') as { version: string };
}

/** A design open in Node: its document, the kernel that computes it, the solver. */
export class DesignJob {
  /** The document and its undo history (`@extrudo/api`). */
  readonly design: Design;
  /** What the archive said about itself: a newer file format, a missing font. */
  readonly notices: readonly string[];
  /** The archive's thumbnail (a PNG), if it had one. */
  readonly thumbnail: Uint8Array<ArrayBuffer> | undefined;

  readonly #attachments: Map<string, Uint8Array>;
  readonly #versions: readonly StoredVersion[];
  readonly #tessellation: MeshOptions | undefined;
  #service: KernelService | undefined;
  #sketchSolver: SketchSolver | undefined;
  #meshesEnabled = false;
  /** What the kernel has already been sent (a font ID, or `file:<id>`). */
  readonly #sent = new Set<string>();
  #disposed = false;

  constructor(
    archive: {
      doc: ExtrudoDocument;
      attachments: Map<string, Uint8Array>;
      versions: readonly StoredVersion[];
      thumbnail?: ArrayBuffer;
    },
    notices: readonly string[],
    options: OpenDesignOptions = {},
  ) {
    this.design = Design.from(archive.doc);
    this.#attachments = archive.attachments;
    this.#versions = archive.versions;
    this.thumbnail = archive.thumbnail ? new Uint8Array(archive.thumbnail) : undefined;
    this.notices = notices;
    this.#tessellation = options.tessellation;
  }

  /** The document as it is now. */
  get doc(): ExtrudoDocument {
    return this.design.doc;
  }

  /**
   * Every parameter the design holds with its value, as `extrudo info` lists
   * them and `--param` takes them: the parameters a person added first, then
   * the ones the model owns — a driving dimension's (`d1`, or the name it was
   * given) and a feature input's, which only the feature itself edits.
   */
  get parameters(): ParameterReport[] {
    const doc = this.doc;
    const evaluation = evaluateParameters(doc);
    const featureName = (id: FeatureId) => doc.features.find((f) => f.id === id)?.name ?? id;
    return [...evaluation.parameters.values()].map((parameter) => ({
      name: parameter.name,
      expression: parameter.expression,
      value: parameter.result.ok ? parameter.result.value : undefined,
      unit: parameter.unit,
      ...(parameter.owner.type === 'user'
        ? { owner: 'user' as const }
        : parameter.owner.type === 'dimension'
          ? {
              owner: 'dimension' as const,
              of: `${featureName(parameter.owner.featureId)}'s dimension`,
            }
          : {
              owner: 'feature' as const,
              of: `${featureName(parameter.owner.featureId)}'s ${parameter.owner.input}`,
            }),
    }));
  }

  /** The configurations the design holds, by name. */
  get configurations(): string[] {
    return (this.doc.configurations ?? []).map((c) => c.name);
  }

  /**
   * Sets parameters by name to new expressions (the app's expression grammar,
   * units and all: `width=60mm`, `tilt=30deg`) and re-solves every sketch
   * whose driving dimensions read them, directly or through other parameters —
   * one change, as the app's shell `apply` does it (ADR-0016). Returns what
   * the solves moved.
   *
   * Throws a `ParameterError` for a parameter the design doesn't have or an
   * expression that doesn't evaluate, and a `HeadlessError` for a sketch that
   * can't take the change; the design is left as it was either way.
   */
  async setParameters(values: Readonly<Record<string, string>>): Promise<SketchSettleChange[]> {
    const names = Object.keys(values);
    this.#requireParameters(names);
    return this.#change('Change parameters', (before, solver) => {
      for (const name of names) this.#setValue(name, values[name] as string);
      this.#requireValues(names);
      return this.#settle(before, solver);
    });
  }

  /**
   * Puts a named configuration's values on the parameters (ADR-0059) and
   * re-solves the sketches they drive, as one change. A configuration the
   * design doesn't have is a `ParameterError`, and nothing changes.
   */
  async applyConfiguration(name: string): Promise<SketchSettleChange[]> {
    if (!this.configurations.includes(name)) {
      const have = list(this.configurations);
      throw new ParameterError(
        have
          ? `There is no configuration "${name}" in this design. It has: ${have}.`
          : `This design has no configurations.`,
      );
    }
    return this.#change(`Apply configuration ${name}`, (before, solver) => {
      this.design.applyConfiguration(name);
      this.#requireValues(this.doc.parameters.map((p) => p.name));
      return this.#settle(before, solver);
    });
  }

  /**
   * Computes the document in the kernel, once, and reports every feature's
   * status and every body (its name, volume, box and face count) with the
   * kernel's timing. A feature that failed is in `features` with its message
   * and in `errors`.
   */
  async compute(): Promise<ComputeResult> {
    const service = await this.#kernel();
    const { result, names } = await this.#recompute();
    const features = featureReports(this.doc, result);
    const bodies = await this.#bodies(service, result.bodies, names);
    return {
      features,
      bodies,
      errors: features.filter((f) => f.status === 'error').length,
      warnings: features.filter((f) => f.status === 'warning').length,
      ms: result.stats.ms,
      evaluated: result.stats.evaluated.length,
    };
  }

  /**
   * Every feature's status and every body's name, with no measuring: what
   * `check` wants, and what a caller reads when the volumes would cost more
   * than the recompute (ADR-0067 §H3's exact mass properties on a body with
   * modelled threads).
   */
  async status(): Promise<StatusResult> {
    const { result, names } = await this.#recompute();
    const features = featureReports(this.doc, result);
    return {
      features,
      bodies: result.bodies.map(({ id }) => ({ id, name: names[id] as string })),
      errors: features.filter((f) => f.status === 'error').length,
      warnings: features.filter((f) => f.status === 'warning').length,
      ms: result.stats.ms,
    };
  }

  /**
   * The recompute itself, with the resources the design needs and the names its
   * bodies have. An export needs no more: the volumes are the kernel's exact
   * mass properties, and on a body with modelled threads they cost more than
   * the recompute does (ADR-0067 §H3), which a file of triangles has no use for.
   */
  async #recompute(): Promise<{
    result: Extract<RecomputeResult, { status: 'done' }>;
    names: Record<BodyId, string>;
  }> {
    const service = await this.#kernel();
    await this.#sendResources();
    const doc = this.doc;
    const result = await service.recompute({
      doc,
      ...(this.#tessellation ? { tessellation: this.#tessellation } : {}),
    });
    if (result.status !== 'done') {
      throw new HeadlessError('The kernel stopped before it finished the design.');
    }
    return {
      result,
      names: bodyNames(
        doc,
        result.bodies.map(({ id }) => id),
      ),
    };
  }

  /**
   * Exports the design's bodies as an STL or a 3MF (one object per body, named
   * and coloured as the app's export writes them) or as a STEP file: one file,
   * with a mesh body left out (ADR-0066 §3).
   */
  async export(options: ExportOptions): Promise<ExportedFile[]> {
    const service = await this.#kernel();
    const { result, names } = await this.#recompute();
    const bodies: ExportBodyChoice[] = result.bodies.map(({ id, mesh }) => ({
      id,
      name: names[id] as string,
      mesh: mesh?.mesh === true,
    }));
    const chosen = pickBodies(bodies, options.bodies);
    if (chosen.length === 0) {
      throw new HeadlessError('This design has no bodies to export.');
    }
    if (options.format === 'step') {
      const solids = chosen.filter((body) => !body.mesh);
      if (solids.length === 0) {
        throw new HeadlessError(
          'A STEP file holds exact solid geometry: every body of this design is a mesh (imported, or combined with a mesh).',
        );
      }
      const text = await service.exportStep(solids.map((b) => ({ id: b.id, name: b.name })));
      return [
        {
          name: modelFileName(this.doc.name, solids.map(exportBody), 'step'),
          bytes: new TextEncoder().encode(text),
          bodies: solids.map((b) => b.name),
          triangles: 0,
          closed: true,
        },
      ];
    }
    const meshed = await meshBodies(
      service,
      chosen.map(exportBody),
      tessellationOf(options.resolution),
      options.onProgress,
    );
    return meshFiles(meshed, options.format, this.doc.name, {
      ...(options.singleFile ? { singleFile: true } : {}),
    });
  }

  /**
   * Writes the design as an `.extrudo` file: the document as it is now, with
   * the archive's thumbnail, its saved versions and the attachment bytes it
   * names (ADR-0061 §2, ADR-0069 §3). Returns the bytes.
   */
  async save(path: string): Promise<Uint8Array> {
    const bytes = this.toFile();
    try {
      await writeFile(path, bytes);
    } catch (error) {
      throw new FileError(`Couldn't write ${path}: ${(error as Error).message}`);
    }
    return bytes;
  }

  /** The `.extrudo` bytes for the design as it is now, without writing them. */
  toFile(): Uint8Array {
    return writeArchive(this.doc, this.thumbnail, this.#versions, this.#usedAttachments());
  }

  /**
   * Frees the kernel — every shape it holds and the OCCT instance — and the
   * solver; the job can't compute after this. Returns what the kernel still
   * held as it went, which is 0 when nothing leaked (ADR-0024's `strictLeaks`
   * asserts the same in the kernel's tests).
   */
  async dispose(): Promise<{ liveShapes: number }> {
    if (this.#disposed) return { liveShapes: 0 };
    this.#disposed = true;
    this.#sketchSolver?.dispose();
    this.#sketchSolver = undefined;
    const liveShapes = this.#service ? (await this.#service.dispose()).liveShapes : 0;
    this.#service = undefined;
    return { liveShapes };
  }

  // ----------------------------------------------------------------- internal

  /** The kernel, started once per job (ADR-0069 §4: one per process). */
  async #kernel(): Promise<KernelService> {
    if (this.#disposed) throw new HeadlessError('This design job is disposed.');
    this.#service ??= new KernelService(() => loadOcct());
    await this.#service.init();
    return this.#service;
  }

  /** The solver, loaded the first time a change has to re-solve a sketch. */
  async #solverInstance(): Promise<SketchSolver> {
    this.#sketchSolver ??= new SketchSolver(await loadPlanegcs());
    return this.#sketchSolver;
  }

  /**
   * One undo step: the commands, the re-solves of the sketches they move and
   * the geometry those solves produced. A throw rolls the whole step back.
   */
  async #change(
    label: string,
    body: (before: ExtrudoDocument, solver: SketchSolver) => SketchSettleChange[],
  ): Promise<SketchSettleChange[]> {
    const before = this.doc;
    // Loaded before the step starts: the step itself is synchronous, so a
    // transaction covers the commands and the geometry the solves move.
    const solver = await this.#solverInstance();
    let changes: SketchSettleChange[] = [];
    this.design.transaction(label, () => {
      changes = body(before, solver);
      for (const change of changes) {
        this.design.state.dispatch(
          setSketchGeometry({
            feature: change.feature,
            points: change.points,
            radii: change.radii,
          }),
        );
      }
    });
    return changes;
  }

  /**
   * The app's re-solve rule on the document as the change has it so far, with
   * the app's message for a sketch that can't take the change — and with the
   * scope `'all'`, which is the CLI's half of ADR-0069: a design loaded from a
   * file can hold a sketch something else moved out of shape, so every sketch
   * is solved and repaired rather than exported stale. The app keeps the
   * default `'changed'`, which costs a solve only in the sketches a change
   * moves.
   */
  #settle(before: ExtrudoDocument, solver: SketchSolver): SketchSettleChange[] {
    try {
      return settleSketches({ solver, before, after: this.doc, scope: 'all' });
    } catch (error) {
      if (error instanceof SketchSettleError) throw new HeadlessError(error.message);
      throw error;
    }
  }

  /**
   * Every name that isn't a parameter of this design is an error, before
   * anything changes. A driving dimension's own parameter (`d1`, or the name
   * it was given) counts: expressions use those as well (ADR-0016).
   */
  #requireParameters(names: readonly string[]): void {
    const have = [...evaluateParameters(this.doc).parameters.keys()];
    for (const name of names) {
      if (have.includes(name)) continue;
      throw new ParameterError(
        have.length === 0
          ? `This design has no parameters, so there is no "${name}".`
          : `There is no parameter "${name}" in this design. It has: ${list(have)}.`,
      );
    }
  }

  /**
   * One parameter's new expression, as the app edits it: a user parameter
   * through the API, a driving dimension through its own command (ADR-0016:
   * a dimension's value is edited through the dimension). A feature input's
   * own parameter (`d3` of an extrude's distance) is not a parameter a person
   * edits — the feature dialog is — and says so.
   */
  #setValue(name: string, expression: string): void {
    const owner = evaluateParameters(this.doc).parameters.get(name)?.owner;
    if (owner?.type === 'dimension') {
      this.design.state.dispatch(
        updateSketchDimension({
          feature: owner.featureId,
          id: owner.dimension,
          changes: { expr: expression },
          points: {},
          radii: {},
        }),
      );
      return;
    }
    if (owner?.type === 'model') {
      const feature = this.doc.features.find((f) => f.id === owner.featureId);
      throw new ParameterError(
        `"${name}" is the ${feature?.name ?? 'feature'}'s own parameter for "${owner.input}"; change it in the feature, not from here.`,
      );
    }
    this.design.setParameter(name, expression);
  }

  /** A parameter whose new expression doesn't evaluate is an error, naming it. */
  #requireValues(names: readonly string[]): void {
    const evaluation = evaluateParameters(this.doc);
    for (const name of names) {
      const result = evaluation.parameters.get(name)?.result;
      if (result && !result.ok) {
        throw new ParameterError(`${name}: ${result.error.message}`);
      }
    }
  }

  /**
   * Sends the kernel what the design's texts and imports need, once each
   * (ADR-0058 §4, ADR-0066 §0): the bundled fonts from `@extrudo/fonts` and
   * the design's own attachments from the archive, and manifold-3d when one of
   * the files is a mesh.
   */
  async #sendResources(): Promise<void> {
    const service = await this.#kernel();
    const doc = this.doc;
    for (const id of usedFonts(doc)) {
      if (this.#sent.has(id)) continue;
      const bytes = await this.#fontBytes(id);
      if (!bytes) continue;
      await service.addFont(id, bytes);
      this.#sent.add(id);
    }
    const files: { id: AttachmentId; mesh: boolean }[] = [];
    for (const feature of doc.features) {
      const id = importFileOf(feature);
      if (!id || this.#sent.has(`file:${id}`)) continue;
      const attachment = doc.attachments?.[id];
      if (!attachment) continue;
      const bytes = this.#attachments.get(attachment.sha256);
      files.push({ id, mesh: isMeshMediaType(attachment.mediaType) });
      if (!bytes) continue;
      await service.addFile(id, ownBuffer(bytes), attachment.mediaType, attachment.fileName);
      this.#sent.add(`file:${id}`);
    }
    if (!this.#meshesEnabled && files.some(({ mesh }) => mesh)) {
      await service.enableMeshes();
      this.#meshesEnabled = true;
    }
  }

  /** A text font's bytes: a bundled file from `@extrudo/fonts`, or an attachment. */
  async #fontBytes(id: string): Promise<ArrayBuffer | undefined> {
    const attachment = /^attachment:(.+)$/.exec(id);
    const record =
      attachment && this.doc.attachments?.[attachment[1] as AttachmentId]
        ? this.doc.attachments[attachment[1] as AttachmentId]
        : undefined;
    if (record) {
      const bytes = this.#attachments.get(record.sha256);
      return bytes ? ownBuffer(bytes) : undefined;
    }
    const font = BUNDLED_FONTS.find((f) => f.id === id);
    if (!font) return undefined;
    try {
      return ownBuffer(new Uint8Array(await readFile(bundledFont(font.file))));
    } catch {
      return undefined;
    }
  }

  /** The attachment bytes the document (or a saved version) still names. */
  #usedAttachments(): Map<string, Uint8Array> {
    const wanted = new Set<string>();
    const collect = (doc: ExtrudoDocument) => {
      for (const attachment of Object.values(doc.attachments ?? {})) wanted.add(attachment.sha256);
    };
    collect(this.doc);
    for (const version of this.#versions) collect(version.doc);
    return new Map([...this.#attachments].filter(([hash]) => wanted.has(hash)));
  }

  /** The bodies of a compute: the display mesh's box and face count, the kernel's volume. */
  async #bodies(
    service: ModelExporter & {
      inspect(
        targets: readonly { kind: 'body'; body: BodyId; index: number }[],
      ): Promise<{ items: unknown[] }>;
    },
    results: readonly { id: BodyId; mesh?: BodyMesh }[],
    names: Record<BodyId, string>,
  ): Promise<BodyReport[]> {
    if (results.length === 0) return [];
    const inspection = await service.inspect(
      results.map(({ id }) => ({ kind: 'body' as const, body: id, index: 0 })),
    );
    return results.map(({ id, mesh }, i) => {
      const item = inspection.items[i] as { kind: string; volume?: number } | undefined;
      const box = meshBox(mesh);
      return {
        id,
        name: names[id] as string,
        volume: item?.kind === 'body' ? (item.volume ?? 0) : 0,
        min: box.min,
        size: box.size,
        faces: mesh ? Math.floor(mesh.faceRanges.length / 2) : 0,
        mesh: mesh?.mesh === true,
      };
    });
  }
}

/** Every active feature with the status the kernel gave it, in timeline order. */
function featureReports(
  doc: ExtrudoDocument,
  result: Extract<RecomputeResult, { status: 'done' }>,
): FeatureReport[] {
  return doc.features
    .filter((feature) => !feature.suppressed)
    .map((feature) => {
      const status = result.features[feature.id];
      return {
        id: feature.id,
        name: feature.name,
        type: feature.type,
        status: status?.status ?? 'ok',
        ...(status?.message ? { message: status.message } : {}),
        ...(status?.refs?.length ? { refs: status.refs } : {}),
      };
    });
}

/**
 * Opens a design from an `.extrudo` file (a path) or its bytes, with
 * everything that comes with it: the attachments its texts and imports name,
 * its thumbnail and its saved versions.
 */
export async function openDesign(
  source: string | Uint8Array,
  options: OpenDesignOptions = {},
): Promise<OpenDesignResult> {
  const bytes = typeof source === 'string' ? await readDesignFile(source) : source;
  let archive: ReturnType<typeof readArchive>;
  try {
    archive = readArchive(bytes);
  } catch (error) {
    throw new FileError(error instanceof Error ? error.message : String(error));
  }
  const job = new DesignJob(
    {
      doc: archive.doc,
      attachments: archive.attachments,
      versions: archive.versions,
      ...(archive.thumbnail ? { thumbnail: ownBuffer(archive.thumbnail) } : {}),
    },
    // What the document said about itself (ADR-0050) and what the file's
    // attachments say (ADR-0061 §2).
    [...Design.from(archive.doc).notices, ...attachmentNotices(archive)],
    options,
  );
  return { job, notices: [...job.notices] };
}

/** The design alone (`openDesign(...).job`), for callers that want one value. */
export async function design(source: string | Uint8Array): Promise<DesignJob> {
  return (await openDesign(source)).job;
}

/** The mesh options of a preset name or a linear deflection in mm. */
export function tessellationOf(resolution?: Exclude<Resolution, 'custom'> | number): MeshOptions {
  if (resolution === undefined) return RESOLUTIONS.medium;
  if (typeof resolution === 'number') {
    return { ...RESOLUTIONS.medium, linearDeflection: resolution };
  }
  const preset = RESOLUTIONS[resolution];
  if (!preset) throw new HeadlessError(`There is no resolution "${resolution}".`);
  return preset;
}

/** The files an export writes: one for a 3MF or a STEP, one per body for an STL. */
function meshFiles(
  meshed: MeshedBodies,
  format: 'stl' | '3mf',
  project: string,
  options: { singleFile?: boolean } = {},
): ExportedFile[] {
  const application = `Extrudo ${EXTRUDO_VERSION}`;
  const file = (bodies: MeshedBodies): ExportedFile => ({
    name: modelFileName(project, bodies.bodies, format),
    bytes: meshBytes(bodies, format, { application, project }),
    bodies: bodies.bodies.map((b) => b.meta.name),
    triangles: bodies.triangles,
    closed: bodies.reports.every((r) => r.ok),
  });
  if (format !== 'stl' || options.singleFile || meshed.bodies.length < 2) return [file(meshed)];
  // An STL holds one solid, so several bodies are several files.
  return meshed.bodies.map((body, i) =>
    file({
      bodies: [body],
      meshes: [meshed.meshes[i] as (typeof meshed.meshes)[number]],
      reports: [meshed.reports[i] as (typeof meshed.reports)[number]],
      triangles: meshed.reports[i]?.triangles ?? 0,
    }),
  );
}

/**
 * The names in a message: the first dozen and how many more there are, so a
 * design with thirty driving dimensions doesn't print all of them.
 */
function list(names: readonly string[]): string {
  const shown = names.slice(0, 12);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

/** The names the bodies have: stored metadata, or the names they will get. */
function bodyNames(doc: ExtrudoDocument, ids: readonly BodyId[]): Record<BodyId, string> {
  const names = newBodyNames(
    doc,
    ids.filter((id) => !doc.bodies[id]),
  );
  return Object.fromEntries(ids.map((id) => [id, doc.bodies[id]?.name ?? names[id] ?? id]));
}

/** What an export needs of a body: which one it is and what it is called. */
export interface ExportBodyChoice {
  id: BodyId;
  name: string;
  /** An imported mesh, which a STEP file leaves out (ADR-0066 §3). */
  mesh: boolean;
}

/** The bodies an export takes, by name or ID, in the order asked or the model's. */
function pickBodies(
  bodies: readonly ExportBodyChoice[],
  wanted: readonly string[] | undefined,
): ExportBodyChoice[] {
  if (!wanted || wanted.length === 0) return [...bodies];
  const chosen: ExportBodyChoice[] = [];
  for (const ask of wanted) {
    const body = bodies.find((b) => b.id === ask || b.name === ask);
    if (!body) {
      throw new HeadlessError(
        `There is no body "${ask}" in this design. It has: ${list(bodies.map((b) => b.name))}.`,
      );
    }
    if (!chosen.includes(body)) chosen.push(body);
  }
  return chosen;
}

function exportBody(body: ExportBodyChoice): ExportBody {
  const meta: BodyMeta = { name: body.name, visible: true };
  return { id: body.id, meta, ...(body.mesh && { mesh: true }) };
}

/** The display mesh's box: its min corner and its size, mm. */
function meshBox(mesh: BodyMesh | undefined): {
  min: [number, number, number];
  size: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const positions = mesh?.positions ?? [];
  for (let i = 0; i < positions.length; i++) {
    const k = i % 3;
    const value = positions[i] as number;
    if (value < (min[k] as number)) min[k] = value;
    if (value > (max[k] as number)) max[k] = value;
  }
  if (positions.length === 0) return { min: [0, 0, 0], size: [0, 0, 0] };
  return {
    min: min.map(round3) as [number, number, number],
    size: max.map((value, k) => round3(value - (min[k] as number))) as [number, number, number],
  };
}

const round3 = (value: number) => Number(value.toFixed(3)) + 0;

/** A copy in its own buffer: the kernel keeps what `addFont`/`addFile` are given. */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

async function readDesignFile(path: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new FileError(
      code === 'ENOENT'
        ? `There is no file at ${path}.`
        : `Couldn't read ${path}: ${(error as Error).message}`,
    );
  }
}

export type { SketchSettleChange };
