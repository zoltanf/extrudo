// Candidate C: brepjs 20 on occt-wasm 5.3 (OCCT 8.0.1 behind a C++ facade with
// arena handles). occt-wasm does not bind OCCT classes, so there is no raw
// BRepBuilderAPI_MakeShape to query; history comes from the facade's
// *WithHistory methods, surfaced by brepjs as *WithEvolution. Faces only:
// face hash → result face hashes.

import {
  box,
  cut,
  cutWithEvolution,
  cylinder,
  edgeFinder,
  exportSTEP,
  exportSTL,
  fillet,
  findFacesByTag,
  filletWithEvolution,
  getEdges,
  getFaces,
  getHashCode,
  HASH_CODE_MAX,
  importSTEP,
  isValid,
  measureArea,
  measureVolume,
  mesh as meshShape,
  meshEdges,
  registerKernel,
  tagFaces,
  OcctWasmAdapter,
  unwrap,
} from 'brepjs';
import { OcctKernel } from 'occt-wasm';
import { checkStl, timer } from '../shared/checks.ts';
import type { HistoryReport, LoadResult, MeshData, ScenarioResult, Timings } from '../shared/types.ts';
import { expectedVolume, SCENARIO } from '../shared/types.ts';

let kernel: OcctKernel | undefined;

export async function load(wasmUrl?: string): Promise<LoadResult> {
  const t = performance.now();
  kernel = await OcctKernel.init(wasmUrl ? { wasm: wasmUrl } : {});
  registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));
  return { candidate: 'brepjs', initMs: performance.now() - t, heapBytes: heapBytes() };
}

export function heapBytes(): number {
  // biome-ignore lint/suspicious/noExplicitAny: HEAP32 view is on the raw module
  return (kernel?.getRawModule() as any).HEAP32.buffer.byteLength;
}

const [X, Y, Z] = SCENARIO.box;
const makeTool = () =>
  cylinder(SCENARIO.holeDiameter / 2, Z + 2, { at: [X / 2, Y / 2, -1] });

/** Geometry only, for the timing/memory loops. */
export function buildPart() {
  const b = box(X, Y, Z);
  const edges = edgeFinder().inDirection('Z').findAll(b);
  const f = unwrap(fillet(b, edges, SCENARIO.filletRadius));
  const tool = makeTool();
  const result = unwrap(cut(f, tool));
  return { result, dispose: () => [b, f, tool, result].forEach((s) => s.delete()) };
}

export async function run(): Promise<ScenarioResult> {
  const lap = timer();
  const tStart = performance.now();
  const timings = {} as Timings;

  const b = box(X, Y, Z);
  timings.box = lap();
  const vEdges = edgeFinder().inDirection('Z').findAll(b);
  const filleted = unwrap(fillet(b, vEdges, SCENARIO.filletRadius));
  timings.fillet = lap();
  const tool = makeTool();
  const result = unwrap(cut(filleted, tool));
  timings.cut = lap();

  const opts = { tolerance: SCENARIO.linDefl, angularTolerance: SCENARIO.angDefl };
  const m = meshShape(result, opts);
  const em = meshEdges(result, opts);
  const mesh: MeshData = {
    positions: m.vertices,
    normals: m.normals,
    indices: m.triangles,
    faceRanges: new Uint32Array(m.faceGroups.flatMap((g) => [g.start / 3, g.count / 3])),
    edges: em.edgeGroups.map((g) => em.lines.slice(g.start * 3, (g.start + g.count) * 3)),
  };
  timings.tessellate = lap();

  const stl = new Uint8Array(await unwrap(exportSTL(result, { ...opts, binary: true })).arrayBuffer());
  timings.stl = lap();
  const step = new Uint8Array(await unwrap(exportSTEP(result)).arrayBuffer());
  timings.step = lap();
  const reimported = unwrap(await importSTEP(new Blob([step])));
  timings.stepReimport = lap();
  timings.total = performance.now() - tStart;

  const stlCheck = checkStl(stl);
  const checks = {
    valid: isValid(result),
    volume: unwrap(measureVolume(result)),
    expectedVolume: expectedVolume(),
    faces: getFaces(result).length,
    edges: getEdges(result).length,
    triangles: mesh.indices.length / 3,
    stlBytes: stl.length,
    stlWatertight: stlCheck.watertight,
    stlVolume: stlCheck.volume,
    stepBytes: step.length,
    stepSchema: 'brepjs default',
    stepReimportFaces: getFaces(reimported).length,
    stepReimportVolume: unwrap(measureVolume(reimported as never)),
  };

  const history = historyViaEvolution();
  for (const s of [b, filleted, tool, result, reimported]) s.delete();

  return { candidate: 'brepjs', layer: 'brepjs API + *WithEvolution', timings, checks, history, mesh, stl, step };
}

/** Same naming experiment as raw-occt.ts, using face-hash evolution maps. */
function historyViaEvolution(): HistoryReport {
  const lines: string[] = [];
  const notes: string[] = [];
  const b = box(X, Y, Z);
  // Tag box faces by position; names live in a hash → names map.
  let names = new Map<number, string[]>();
  const centroidOf = (f: Parameters<typeof measureArea>[0]) => {
    // brepjs has no public face centroid on this path; use its mesh bbox centre.
    const mm = meshShape(f, { tolerance: 0.5, angularTolerance: 1 });
    const v = mm.vertices;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], v[i + k]);
        hi[k] = Math.max(hi[k], v[i + k]);
      }
    return lo.map((l, k) => (l + hi[k]) / 2);
  };
  const side = (c: number[]) =>
    c
      .map((v, i) => (Math.abs(v) < 1e-6 ? `${'xyz'[i]}-` : Math.abs(v - [X, Y, Z][i]) < 1e-6 ? `${'xyz'[i]}+` : ''))
      .join('');
  // brepjs only sends input face hashes to the kernel when the input carries
  // metadata (tags, origins, colours), so tag every face the brepjs way too.
  const tags: string[] = [];
  for (const f of getFaces(b)) {
    const n = `box:${side(centroidOf(f))}`;
    names.set(getHashCode(f), [n]);
    tagFaces(b, [f], n);
    tags.push(n);
  }

  const step = (
    op: string,
    ev: { modified: ReadonlyMap<number, readonly number[]>; generated: ReadonlyMap<number, readonly number[]>; deleted: ReadonlySet<number> },
    inputNames: Map<number, string[]>,
    resultFaces: number[],
  ) => {
    const out = new Map<number, string[]>();
    const add = (h: number, n: string) => out.set(h, [...(out.get(h) ?? []), n]);
    for (const [h, ns] of inputNames) {
      for (const n of ns) {
        if (ev.deleted.has(h)) lines.push(`${op}: ${n} → deleted`);
        const mod = ev.modified.get(h) ?? [];
        const gen = ev.generated.get(h) ?? [];
        if (!mod.length && !ev.deleted.has(h)) {
          if (resultFaces.includes(h)) {
            add(h, n);
            lines.push(`${op}: ${n} → unchanged`);
          } else lines.push(`${op}: ${n} → (not in result, no history)`);
        }
        mod.forEach((r, i) => add(r, mod.length > 1 ? `${n}#${i + 1}` : n));
        if (mod.length) lines.push(`${op}: ${n} → modified into ${mod.length} face(s)`);
        gen.forEach((r, i) => {
          add(r, `${op}(${n})${gen.length > 1 ? `#${i + 1}` : ''}`);
          lines.push(`${op}: ${n} → generated shape hash (type not reported) ${op}(${n})`);
        });
      }
    }
    // Generated entries keyed by hashes we did not name (e.g. edges) are invisible to us.
    const unknownKeys = [...ev.generated.keys()].filter((k) => !inputNames.has(k));
    if (unknownKeys.length) notes.push(`${op}: ${unknownKeys.length} generated entries keyed by unnamed inputs`);
    return out;
  };

  const vEdges = edgeFinder().inDirection('Z').findAll(b);
  const fr = unwrap(filletWithEvolution(b, vEdges, SCENARIO.filletRadius));
  const filFaces = getFaces(fr.shape).map(getHashCode);
  names = step('fillet', fr.evolution, names, filFaces);

  const tool = makeTool();
  const toolNames = new Map<number, string[]>();
  for (const f of getFaces(tool)) {
    const c = centroidOf(f);
    const n = `hole:${Math.abs(c[2] + 1) < 1e-6 ? 'bottom' : Math.abs(c[2] - (Z + 1)) < 1e-6 ? 'top' : 'side'}`;
    toolNames.set(getHashCode(f), [n]);
    tagFaces(tool, [f], n);
    tags.push(n);
  }
  const cr = unwrap(cutWithEvolution(fr.shape, tool));
  const finalFacesH = getFaces(cr.shape);
  const finalHashes = finalFacesH.map(getHashCode);
  names = step('cut', cr.evolution, new Map([...names, ...toolNames]), finalHashes);

  const finalFaces = finalFacesH.map((f, i) => ({
    index: i + 1,
    area: unwrap(measureArea(f)),
    names: names.get(finalHashes[i]) ?? [],
  }));
  // brepjs's own tag propagation, for comparison with our hash-map walk.
  const tagHits = tags.map((t) => `${t}→${findFacesByTag(cr.shape, t).length}`);
  notes.push(`brepjs findFacesByTag on the final solid: ${tagHits.join(', ')}`);
  const dupHashes = finalHashes.length - new Set(finalHashes).size;
  if (dupHashes) notes.push(`${dupHashes} final faces share a hash code (collision)`);
  notes.push(
    `Hashes are TopoDS_Shape hash codes bounded by HASH_CODE_MAX=${HASH_CODE_MAX}; they identify faces only within one kernel session.`,
    'Edges have no history in occt-wasm; brepjs names edges by their two adjacent face roles (EdgeRef), which is the "derived" approach.',
    'The fillet surfaces are Generated from the filleted edges, and edges carry no hash in the request, so fillet faces arrive unnamed unless generated is keyed by a face.',
  );
  const namedF = finalFaces.filter((f) => f.names.length).length;
  const edgesTotal = getEdges(cr.shape).length;
  for (const s of [b, fr.shape, tool, cr.shape]) s.delete();
  return {
    available: true,
    tracks: { faces: true, edges: false },
    lines,
    coverage: {
      faces: { total: finalFaces.length, named: namedF, ambiguous: finalFaces.filter((f) => f.names.length > 1).length },
      edges: { total: edgesTotal, named: 0, derived: edgesTotal, multiNamed: 0 },
    },
    finalFaces,
    notes,
  };
}

/** Live shapes in occt-wasm's arena: the exact leak metric for this candidate. */
export function liveShapes(): number {
  return kernel?.shapeCount ?? -1;
}
