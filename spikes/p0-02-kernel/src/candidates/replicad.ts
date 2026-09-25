// Candidate B: replicad 1.1 on replicad-opencascadejs (a trimmed OCCT build).
// The scenario runs twice: once through replicad's own API (ergonomics and
// timings), once through the raw OCCT instance underneath (getOC()), because
// replicad's fillet()/cut() return only the result shape and drop the builder,
// so its history is not reachable through the high-level API.

import opencascade from 'replicad-opencascadejs';
import { getOC, importSTEP, makeBox, makeCylinder, measureVolume, setOC } from 'replicad';
import { checkStl, timer } from '../shared/checks.ts';
import type { LoadResult, MeshData, ScenarioResult, Timings } from '../shared/types.ts';
import { expectedVolume, SCENARIO } from '../shared/types.ts';
import { runRaw } from './raw-occt.ts';

export async function load(wasmUrl?: string): Promise<LoadResult> {
  const t = performance.now();
  const oc = await opencascade(wasmUrl ? { locateFile: () => wasmUrl } : {});
  setOC(oc);
  return { candidate: 'replicad', initMs: performance.now() - t, heapBytes: heapBytes() };
}

export function heapBytes(): number {
  // biome-ignore lint/suspicious/noExplicitAny: wasmMemory is not in the published types
  return (getOC() as any).wasmMemory.buffer.byteLength;
}

/** The scenario through replicad's own API. Returns the shapes for disposal. */
export function buildPart() {
  const [X, Y, Z] = SCENARIO.box;
  const box = makeBox([0, 0, 0], [X, Y, Z]);
  const filleted = box.fillet(SCENARIO.filletRadius, (e) => e.inDirection('Z'));
  const cyl = makeCylinder(SCENARIO.holeDiameter / 2, Z + 2, [X / 2, Y / 2, -1], [0, 0, 1]);
  const result = filleted.cut(cyl);
  return { box, filleted, cyl, result, dispose: () => [box, filleted, cyl, result].forEach((s) => s.delete()) };
}

export async function run(): Promise<ScenarioResult> {
  const lap = timer();
  const tStart = performance.now();
  const timings = {} as Timings;
  const [X, Y, Z] = SCENARIO.box;

  const box = makeBox([0, 0, 0], [X, Y, Z]);
  timings.box = lap();
  const filleted = box.fillet(SCENARIO.filletRadius, (e) => e.inDirection('Z'));
  timings.fillet = lap();
  const cyl = makeCylinder(SCENARIO.holeDiameter / 2, Z + 2, [X / 2, Y / 2, -1], [0, 0, 1]);
  const result = filleted.cut(cyl);
  timings.cut = lap();

  const m = result.mesh({ tolerance: SCENARIO.linDefl, angularTolerance: SCENARIO.angDefl });
  const em = result.meshEdges({ tolerance: SCENARIO.linDefl, angularTolerance: SCENARIO.angDefl });
  const mesh: MeshData = {
    positions: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    indices: new Uint32Array(m.triangles),
    faceRanges: new Uint32Array(m.faceGroups.flatMap((g) => [g.start / 3, g.count / 3])),
    edges: em.edgeGroups.map((g) => new Float32Array(em.lines.slice(g.start * 3, (g.start + g.count) * 3))),
  };
  timings.tessellate = lap();

  const stl = new Uint8Array(await result.blobSTL({ binary: true }).arrayBuffer());
  timings.stl = lap();
  const step = new Uint8Array(await result.blobSTEP().arrayBuffer());
  timings.step = lap();
  const reimported = await importSTEP(new Blob([step]));
  timings.stepReimport = lap();
  timings.total = performance.now() - tStart;

  const oc = getOC();
  const analyzer = new oc.BRepCheck_Analyzer(result.wrapped, true, false);
  const stlCheck = checkStl(stl);
  const checks = {
    valid: analyzer.IsValid(),
    volume: measureVolume(result),
    expectedVolume: expectedVolume(),
    faces: result.faces.length,
    edges: result.edges.length,
    triangles: mesh.indices.length / 3,
    stlBytes: stl.length,
    stlWatertight: stlCheck.watertight,
    stlVolume: stlCheck.volume,
    stepBytes: step.length,
    stepSchema: 'replicad default',
    stepReimportFaces: reimported.faces.length,
    stepReimportVolume: measureVolume(reimported as never),
  };
  analyzer.delete();
  for (const s of [box, filleted, cyl, result, reimported]) s.delete();

  // History: only reachable by dropping to raw OCCT on replicad's instance.
  const raw = runRaw(oc, 'replicad', 'raw OCCT via replicad getOC()');
  raw.history.notes.unshift(
    'replicad API: fillet()/cut() return only the new shape; the BRepFilletAPI_MakeFillet / BRepAlgoAPI_Cut builders (and their history) are discarded. History came from building the same ops with getOC().',
  );
  return {
    candidate: 'replicad',
    layer: 'replicad API (history via getOC())',
    timings,
    checks,
    history: raw.history,
    mesh,
    stl,
    step,
  };
}
