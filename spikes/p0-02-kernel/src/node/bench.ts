// Node benchmark for one candidate, run in a fresh process so cold-load time is
// real: `node src/node/bench.ts <libcascade|replicad|brepjs>`.
// Writes results/node-<candidate>.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import type { ScenarioResult, Timings } from '../shared/types.ts';

const candidate = process.argv[2] as 'libcascade' | 'replicad' | 'brepjs' | 'custom';
const WARM_RUNS = 10;
const MEM_ITERS = Number(process.env.MEM_ITERS ?? 1000);

// Silence OCCT's STEP writer banner (printed through Emscripten's stdout).
const realWrite = process.stdout.write.bind(process.stdout);
const quiet = <T>(fn: () => T): T => {
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return fn();
  } finally {
    process.stdout.write = realWrite;
  }
};
const quietAsync = async <T>(fn: () => Promise<T>): Promise<T> => {
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = realWrite;
  }
};

const tImport = performance.now();
// biome-ignore lint/suspicious/noExplicitAny: the three candidate modules differ slightly
const mod: any = await import(`../candidates/${candidate}.ts`);
const importMs = performance.now() - tImport;
const loaded = await mod.load();
const coldReadyMs = performance.now() - tImport;

const first: ScenarioResult = await quietAsync(() => mod.run());
const warm: Timings[] = [];
for (let i = 0; i < WARM_RUNS; i++) warm.push((await quietAsync<ScenarioResult>(() => mod.run())).timings);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const warmMedian = Object.fromEntries(
  Object.keys(first.timings).map((k) => [k, median(warm.map((t) => t[k as keyof Timings]))]),
) as unknown as Timings;

// --- memory: rebuild box → fillet → cut → mesh MEM_ITERS times with disposal.
// biome-ignore lint/suspicious/noExplicitAny: per-candidate raw instance
async function rawOc(): Promise<any> {
  if (candidate === 'libcascade' || candidate === 'custom') return mod.instance();
  if (candidate === 'replicad') return (await import('replicad')).getOC();
  return undefined;
}
const oc = await rawOc();
/** Address a 32 MB malloc lands at: rises if live allocations pile up below the top. */
const topProbe = (): number | null => {
  const m = oc?._emscripten_builtin_malloc;
  if (!m) return null;
  const p = m(32 * 1024 * 1024);
  oc._emscripten_builtin_free(p);
  return p;
};

async function oneBuild(dispose: boolean) {
  if (candidate === 'libcascade' || candidate === 'custom') {
    const { Scope, buildPart } = await import('../candidates/raw-occt.ts');
    const s = new Scope();
    const { result } = buildPart(oc, s);
    s.t(new oc.BRepMesh_IncrementalMesh(result, 0.05, false, 0.3, false));
    if (dispose) s[Symbol.dispose]();
  } else if (candidate === 'replicad') {
    const p = mod.buildPart();
    p.result.mesh({ tolerance: 0.05, angularTolerance: 0.3 });
    if (dispose) p.dispose();
  } else {
    const { mesh } = await import('brepjs');
    const p = mod.buildPart();
    mesh(p.result, { tolerance: 0.05, angularTolerance: 0.3 });
    if (dispose) p.dispose();
  }
}

const live = (): number | null => (mod.liveShapes ? mod.liveShapes() : null);
const every = MEM_ITERS / 10;
const samples: { iter: number; heapBytes: number; topProbe: number | null; liveShapes: number | null }[] = [
  { iter: 0, heapBytes: mod.heapBytes(), topProbe: topProbe(), liveShapes: live() },
];
const tMem = performance.now();
for (let i = 1; i <= MEM_ITERS; i++) {
  await oneBuild(true);
  if (i === 1 || i % every === 0) samples.push({ iter: i, heapBytes: mod.heapBytes(), topProbe: topProbe(), liveShapes: live() });
}
const memMs = performance.now() - tMem;

// Leak control: the same loop without disposal must visibly grow, or the
// measurement above proves nothing.
const leakSamples: typeof samples = [];
const LEAK_ITERS = 300;
for (let i = 1; i <= LEAK_ITERS; i++) {
  await oneBuild(false);
  if (i === 1 || i % 100 === 0) leakSamples.push({ iter: i, heapBytes: mod.heapBytes(), topProbe: topProbe(), liveShapes: live() });
}

const { mesh, stl, step, ...rest } = first;
const out = {
  candidate,
  node: process.version,
  importMs,
  initMs: loaded.initMs,
  coldReadyMs,
  heapAfterInit: loaded.heapBytes,
  first: rest.timings,
  warmMedian,
  warmRuns: WARM_RUNS,
  checks: rest.checks,
  history: rest.history,
  layer: rest.layer,
  memory: {
    iterations: MEM_ITERS,
    msPerIter: memMs / MEM_ITERS,
    /** Heap growth per rebuild over the whole disposed loop (0 = no growth at all). */
    kbPerIter: ((samples.at(-1)?.heapBytes ?? 0) - samples[0].heapBytes) / 1024 / MEM_ITERS,
    samples,
    leakControl: leakSamples,
  },
  meshSummary: {
    triangles: mesh.indices.length / 3,
    faceRanges: mesh.faceRanges.length / 2,
    edgePolylines: mesh.edges.length,
    emptyEdgePolylines: mesh.edges.filter((e: Float32Array) => e.length === 0).length,
  },
};
mkdirSync('results', { recursive: true });
writeFileSync(`results/node-${candidate}.json`, `${JSON.stringify(out, null, 2)}\n`);
writeFileSync(`results/scenario-${candidate}.stl`, stl);
writeFileSync(`results/scenario-${candidate}.step`, step);
quiet(() => realWrite(`${candidate}: cold ${coldReadyMs.toFixed(0)} ms, warm total ${warmMedian.total.toFixed(1)} ms\n`));
