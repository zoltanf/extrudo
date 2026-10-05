/**
 * The `import` feature in the kernel (P4-06, ADR-0066 §2 and §3, FR-IO-05
 * and FR-IO-06): a file of the design becomes one body per solid (STEP) or
 * per piece of a mesh (STL, 3MF, OBJ), where a primitive makes a body from
 * nothing (ADR-0032) and every later feature treats the bodies like any other
 * (Move, Combine, patterns of bodies, a fillet on a solid's faces).
 *
 * **No facade change:** the STEP branch is the facade's `readStep` (P2-12,
 * ADR-0034: `STEPControl_Reader`, converted to mm, one compound of the file's
 * roots), the mesh branch is manifold-3d (`meshFrom`, ADR-0066 §3), the `up`
 * turn is `transform` (ADR-0044) for both, and one body per piece is
 * `splitSolids` (ADR-0030) for a solid and `Manifold.decompose()` for a mesh.
 *
 * **Names:** a STEP file's face `n` (1-based, in the order `TopExp` lists the
 * file's faces before splitting) is `import:<id>:face:<n>`; a mesh body's one
 * face is `mesh:<id>`, numbered `#n` for the bodies after the first, so two
 * bodies' faces can tell each other apart (ADR-0005). The file never changes,
 * so a recompute names the same face the same way; there is no history, since
 * nothing here is built from other geometry.
 *
 * What fails, worded for the user: a file that isn't a model at all, one the
 * worker doesn't have (ADR-0066 §0), one OCCT can't read (the facade's own
 * message), one with no solids in it, a mesh that isn't closed or has more
 * triangles than Extrudo reads, and a mesh file our readers can't read (the
 * reader's message).
 *
 * **An OpenSCAD file** (P5-04, ADR-0071) is compiled first, in `prepare`: the
 * OpenSCAD compiler runs in a worker of its own, so the compile is awaited
 * there, with the overrides' values as `-D` definitions; the 3MF it writes then
 * takes the mesh path above unchanged. OpenSCAD's errors are the feature's
 * error and its echoes and warnings the feature's warnings, worded by
 * `@extrudo/openscad`.
 */
import {
  type AttachmentId,
  type BodyId,
  type IMPORT_UNITS,
  type ImportInputs,
  importFeature,
  importSettings,
  isMeshMediaType,
  isScadMediaType,
  scadOverrides,
  UNIT_FACTORS,
} from '@extrudo/core';
import {
  read3mf,
  readObj,
  readStl,
  stlTriangleCount,
  type ThreeMfModel,
  type ThreeMfObject,
  type TriangleMesh,
} from '@extrudo/io';
import type { ScadCompiler, ScadDefine, ScadRequest, ScadResult } from '@extrudo/openscad';
import { KernelError, MeshError, type ShapeHandle, type Vec3 } from '../kernel';
import { compareGeometry, deriveNames, type TopoNames } from '../naming/names';
import { splitName } from '../naming/topo-id';
import type {
  EvalContext,
  FeatureOutput,
  KernelFeatureDefinition,
  PrepareContext,
} from '../recompute/types';
import { splitSolids } from './bodies';
import { rotation } from './matrix';

/** The units an `import` reads a mesh file's numbers in. */
type MeshUnits = (typeof IMPORT_UNITS)[number];

/** More triangles than this is refused (ADR-0066 §3): a mesh body is not a model. */
export const MAX_MESH_TRIANGLES = 1_000_000;

/** The millimetres a 3MF `unit` attribute is worth (the core specification's). */
const THREE_MF_UNITS: Readonly<Record<string, number>> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

export const kernelImport: KernelFeatureDefinition<ImportInputs> = {
  ...importFeature,
  bodyAccess: () => 'write',
  prepare: prepareImport,
  evaluate: evaluateImport,
};

/** A turn of +90° about X: a Y-up file becomes Z-up (ADR-0066 §2). */
const UP_Y = rotation([0, 0, 0], [1, 0, 0], Math.PI / 2);

function evaluateImport(ctx: EvalContext<ImportInputs>): FeatureOutput {
  const settings = importSettings(ctx.inputs);
  const mediaType = ctx.fileType(settings.file);
  if (isScadMediaType(mediaType)) {
    return evaluateScadImport(ctx, settings.file, settings.units, settings.up);
  }
  if (isMeshMediaType(mediaType)) {
    return evaluateMeshImport(ctx, settings.file, settings.units, settings.up);
  }
  if (mediaType !== 'model/step') {
    throw new KernelError(
      'This file is not a model Extrudo reads: it wants a STEP file (.step, .stp) or a mesh (.stl, .3mf, .obj).',
    );
  }
  const text = new TextDecoder().decode(ctx.file(settings.file));
  using scope = ctx.kernel.scope();
  const read = scope.track(ctx.kernel.readStep(text));
  // A surface model has solids to count, and we only want to know whether it
  // has any: the handles go straight back.
  const solids = ctx.kernel.solids(read);
  ctx.kernel.release(...solids);
  if (solids.length === 0) {
    throw new KernelError(
      'The STEP file has no solids: Extrudo imports solid bodies, not surfaces.',
    );
  }
  // The turn rebuilds the shape with the same sub-shape order, so the faces
  // are numbered the file's own either way.
  const placed = settings.up === 'y' ? scope.track(ctx.kernel.transform(read, UP_Y).shape) : read;
  const id = ctx.bodyId(0);
  const bodies = new Map(ctx.bodies);
  // The names before the keep: a shape kept and then lost to a throw would
  // leak (ADR-0024).
  const names = new Map<BodyId, TopoNames>([[id, importNames(ctx, placed)]]);
  bodies.set(id, scope.keep(placed));
  return splitSolids(ctx, scope, { bodies, names });
}

/**
 * Every face of the file's shape named `import:<feature>:face:<n>`, its edges
 * and vertices derived from those faces (ADR-0005).
 */
function importNames(ctx: EvalContext, shape: ShapeHandle): TopoNames {
  const description = ctx.describe(shape);
  return deriveNames(
    description.faces.map((_, i) => `import:${ctx.feature.id}:face:${i + 1}`),
    description,
  );
}

/**
 * The mesh branch (P4-06, ADR-0066 §3): `@extrudo/io` reads the file, `units`
 * and `up` are applied, `meshFrom` makes a body of each object and
 * `decompose()` splits it into its connected pieces, so a file of several
 * parts is one body each. The pieces are numbered as `splitSolids` numbers a
 * solid's (ADR-0030): the largest keeps the feature's first body ID.
 */
function evaluateMeshImport(
  ctx: EvalContext<ImportInputs>,
  file: AttachmentId,
  units: MeshUnits,
  up: 'z' | 'y',
): FeatureOutput {
  return meshBodies(ctx, ctx.fileName(file), readMeshFile(ctx, file, units), up);
}

/** Meshes as bodies: `meshFrom`, the `up` turn, one body per connected piece. */
function meshBodies(
  ctx: EvalContext<ImportInputs>,
  name: string,
  meshes: readonly TriangleMesh[],
  up: 'z' | 'y',
): FeatureOutput {
  const { kernel } = ctx;
  using scope = kernel.scope();
  const pieces: { shape: ShapeHandle; center: Vec3; volume: number }[] = [];
  for (const mesh of meshes) {
    let whole: ShapeHandle;
    try {
      whole = scope.track(kernel.meshFrom(mesh));
    } catch (error) {
      // What is wrong with the mesh is worth more than what went wrong
      // building it: the count of open edges is what a user can act on.
      if (error instanceof MeshError && error.problem) {
        throw new KernelError(notClosed(name, error));
      }
      throw error;
    }
    // The turn: (x, y, z) → (x, −z, y), so a Y-up file stands up in Z.
    const turned = up === 'y' ? scope.track(kernel.transform(whole, UP_Y).shape) : whole;
    for (const piece of kernel.solids(turned)) {
      scope.track(piece);
      const { volume, bbox } = kernel.measure(piece);
      pieces.push({
        shape: piece,
        volume,
        center: [
          (bbox.min[0] + bbox.max[0]) / 2,
          (bbox.min[1] + bbox.max[1]) / 2,
          (bbox.min[2] + bbox.max[2]) / 2,
        ],
      });
    }
  }
  if (pieces.length === 0) {
    throw new KernelError(`The file ${name} has no triangles in it: there is nothing to import.`);
  }
  // The pieces in geometric order, then the largest moved to the front: it
  // keeps the feature's first body ID, as `splitSolids` does (ADR-0030).
  const ordered = [...pieces].sort((a, b) => compareGeometry(a.center, b.center));
  const largest = ordered.reduce((best, piece) => (piece.volume > best.volume ? piece : best));
  ordered.splice(ordered.indexOf(largest), 1);
  ordered.unshift(largest);
  const used = new Set(ctx.bodies.keys());
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  let next = 0;
  for (const [i, piece] of ordered.entries()) {
    let id = i === 0 ? ctx.bodyId(0) : ctx.bodyId(next++);
    while (used.has(id)) id = ctx.bodyId(next++);
    used.add(id);
    bodies.set(id, scope.keep(piece.shape));
    // One face of its own per body (ADR-0066 §3): `mesh:<feature>`, and the
    // bodies after the first are numbered (`#2`, `#3`…) so that a reference
    // can tell two bodies' faces apart, as `splitSolids` does.
    const face = `mesh:${ctx.feature.id}`;
    names.set(id, meshNames(ctx, piece.shape, i === 0 ? face : splitName(face, i + 1)));
  }
  return { bodies, names };
}

/** A mesh body's one face, and no edges or vertices (ADR-0066 §3). */
function meshNames(ctx: EvalContext, shape: ShapeHandle, face: string): TopoNames {
  return deriveNames([face], ctx.describe(shape));
}

/**
 * The meshes of a mesh file, in millimetres: one per 3MF build item or OBJ
 * object, and the STL's own triangles as one. `units` scales them: `auto`
 * takes a 3MF's own unit and reads STL and OBJ as millimetres (ADR-0066 §2).
 */
function readMeshFile(
  ctx: EvalContext<ImportInputs>,
  file: AttachmentId,
  units: MeshUnits,
): TriangleMesh[] {
  const bytes = ctx.file(file);
  const name = ctx.fileName(file);
  const mediaType = ctx.fileType(file);
  if (mediaType === 'model/3mf') return threeMfMeshes(read(read3mf, bytes, name), units, name);
  if (mediaType === 'model/obj') {
    const objects = read(readObj, new TextDecoder().decode(bytes), name);
    if (objects.length === 0) throw new KernelError(`The file ${name} has no faces in it.`);
    let triangles = 0;
    return objects.map((object) => {
      triangles += object.mesh.indices.length / 3;
      refuseTooMany(name, triangles);
      return scaled(object.mesh, UNIT_FACTORS[units] ?? 1);
    });
  }
  // STL, binary or ASCII. A binary file's triangle count is in its header, so
  // one over the limit is refused before it is read at all.
  const count = stlTriangleCount(bytes);
  if (count !== undefined) refuseTooMany(name, count);
  const stl = read(readStl, bytes, name);
  refuseTooMany(name, stl.mesh.indices.length / 3);
  return [scaled(stl.mesh, UNIT_FACTORS[units] ?? 1)];
}

/**
 * A 3MF's meshes in millimetres: one per object its build makes, in the
 * build's order. A file with no build items is read as its objects, which is
 * what it means.
 */
function threeMfMeshes(model: ThreeMfModel, units: MeshUnits, name: string): TriangleMesh[] {
  const factor = units === 'auto' ? (THREE_MF_UNITS[model.unit] ?? 1) : (UNIT_FACTORS[units] ?? 1);
  const byId = new Map(model.objects.map((object) => [object.id, object]));
  const ids = model.build.length > 0 ? model.build : model.objects.map((object) => object.id);
  const objects = ids
    .map((id) => byId.get(id))
    .filter((object): object is ThreeMfObject => !!object && object.mesh.indices.length > 0);
  if (objects.length === 0) throw new KernelError(`The file ${name} has no objects in it.`);
  let triangles = 0;
  return objects.map((object) => {
    triangles += object.mesh.indices.length / 3;
    refuseTooMany(name, triangles);
    return scaled(object.mesh, factor);
  });
}

/** What `prepare` hands an OpenSCAD import's `evaluate`: the compiled model and what was said. */
interface ScadCompiled {
  /** OpenSCAD's 3MF (ADR-0071 §1). */
  model: Uint8Array;
  warnings: string[];
}

/**
 * Compiles an OpenSCAD file (ADR-0071 §3): the overrides' values as `-D`
 * definitions, in the compiler's own worker. Anything else is left to
 * `evaluate`, which needs nothing from outside.
 */
async function prepareImport(ctx: PrepareContext<ImportInputs>): Promise<ScadCompiled | undefined> {
  const { file } = importSettings(ctx.inputs);
  if (!isScadMediaType(ctx.fileType(file))) return undefined;
  const name = ctx.fileName(file);
  const source = ctx.file(file);
  const { defines, warnings } = scadDefines(ctx, name, new TextDecoder().decode(source));
  const result = await compileOnce(ctx.openscad(), { fileName: name, source, defines });
  if (!result.ok) throw new KernelError(result.error);
  return { model: result.model, warnings: [...warnings, ...result.warnings] };
}

/**
 * The overrides as `-D` definitions (ADR-0071 §5), checked: both halves of
 * every pair, no variable twice, a finite value. A variable the file never
 * assigns is a warning, not an error — OpenSCAD takes it and nothing changes.
 */
function scadDefines(
  ctx: PrepareContext<ImportInputs>,
  name: string,
  source: string,
): { defines: ScadDefine[]; warnings: string[] } {
  const defines: ScadDefine[] = [];
  const warnings: string[] = [];
  for (const override of scadOverrides(ctx.inputs)) {
    if (override.name === undefined) {
      throw new KernelError(
        `Override ${override.n} has a value but no variable: name the variable of ${name} it sets.`,
      );
    }
    if (override.value === undefined) {
      throw new KernelError(`Override ${override.n} (${override.name}) has no value.`);
    }
    if (defines.some((define) => define.name === override.name)) {
      throw new KernelError(`${override.name} is overridden twice: keep one of the two.`);
    }
    const value = ctx.value(override.value);
    if (!Number.isFinite(value)) {
      throw new KernelError(`The value of ${override.name} isn't a number OpenSCAD can take.`);
    }
    defines.push({ name: override.name, value });
    if (!override.name.startsWith('$') && !assigns(source, override.name)) {
      warnings.push(`${name} has no variable ${override.name}: its override does nothing.`);
    }
  }
  return { defines, warnings };
}

/** Whether a file assigns a variable somewhere (`width = …`, not `width == …`). */
function assigns(source: string, variable: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_$.])${variable.replace(/\$/g, '\\$')}\\s*=(?!=)`, 'm').test(
    source,
  );
}

/**
 * The compiles a compiler has done lately, by file and definitions, so that
 * moving an import in the timeline, or a preview and a recompute of the same
 * values, compile once (the engine's cache key also has the bodies before the
 * feature in it). A few, since a result is a small 3MF.
 */
const compiles = new WeakMap<ScadCompiler, Map<string, Promise<ScadResult>>>();
const COMPILES_KEPT = 16;

function compileOnce(compiler: ScadCompiler, request: ScadRequest): Promise<ScadResult> {
  const kept = compiles.get(compiler) ?? new Map<string, Promise<ScadResult>>();
  compiles.set(compiler, kept);
  const key = `${request.fileName}\n${digest(request.source)}\n${JSON.stringify(request.defines)}`;
  const known = kept.get(key);
  if (known) {
    kept.delete(key);
    kept.set(key, known);
    return known;
  }
  const result = compiler.compile(request);
  kept.set(key, result);
  // A compile that was stopped (its time, a crash) or found no WASM (offline)
  // may do better another time.
  void result.then((r) => {
    if (!r.ok && /stopped|isn't downloaded/.test(r.error)) kept.delete(key);
  });
  while (kept.size > COMPILES_KEPT) kept.delete(kept.keys().next().value as string);
  return result;
}

/** A 64-bit FNV-1a of the bytes, as hex: enough to tell two sources apart. */
function digest(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16);
}

/**
 * An OpenSCAD import's bodies (ADR-0071 §2): the 3MF `prepare` compiled read
 * like any 3MF, then ADR-0066's mesh path. OpenSCAD's own unit is the
 * millimetre (its 3MF says so), and `units` scales it like a mesh's.
 */
function evaluateScadImport(
  ctx: EvalContext<ImportInputs>,
  file: AttachmentId,
  units: MeshUnits,
  up: 'z' | 'y',
): FeatureOutput {
  const compiled = ctx.prepared as ScadCompiled | undefined;
  const name = ctx.fileName(file);
  if (!compiled) throw new KernelError(`${name} wasn't compiled: OpenSCAD isn't loaded here.`);
  const meshes = threeMfMeshes(read(read3mf, compiled.model, name), units, name);
  const output = meshBodies(ctx, name, meshes, up);
  for (const warning of compiled.warnings) ctx.warn(warning);
  return output;
}

/** Reads a file, with the reader's own message when it can't. */
function read<T, I>(reader: (input: I) => T, input: I, name: string): T {
  try {
    return reader(input);
  } catch (error) {
    throw new KernelError(`Extrudo can't read ${name}: ${message(error)}`);
  }
}

/** A mesh's nodes in millimetres: the file's unit times every coordinate. */
function scaled(mesh: TriangleMesh, factor: number): TriangleMesh {
  if (factor === 1) return mesh;
  const positions = new Float64Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i++) {
    positions[i] = (mesh.positions[i] as number) * factor;
  }
  return { positions, indices: mesh.indices };
}

/** Refuses a file with more triangles than Extrudo reads (ADR-0066 §3). */
function refuseTooMany(name: string, triangles: number): void {
  if (triangles <= MAX_MESH_TRIANGLES) return;
  const count = (n: number) => Math.round(n).toLocaleString('en-US');
  throw new KernelError(
    `${name} has ${count(triangles)} triangles; Extrudo imports up to ${count(MAX_MESH_TRIANGLES)}.`,
  );
}

/** What a mesh isn't solid about, worded with the file's own name. */
function notClosed(name: string, error: MeshError): string {
  const problem = error.problem;
  const what = [
    problem && problem.openEdges > 0 ? `${problem.openEdges} open edges` : '',
    problem && problem.nonManifoldEdges > 0
      ? `${problem.nonManifoldEdges} edges used by more than two triangles`
      : '',
    problem && problem.misorientedEdges > 0
      ? `${problem.misorientedEdges} faces facing the wrong way`
      : '',
    problem && problem.badTriangles > 0
      ? `${problem.badTriangles} faces of fewer than three corners`
      : '',
    problem && problem.badNodes > 0 ? `${problem.badNodes} points that aren't numbers` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return `${name} isn't a closed solid (${what || error.message}): repair it in your slicer or a mesh tool and import it again.`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
