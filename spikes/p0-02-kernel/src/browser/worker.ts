// Runs one candidate in a Web Worker: load (fetch + compile + init), then the
// scenario once cold and a few times warm. Mesh buffers are transferred back.

import brepjsWasm from 'occt-wasm/dist/occt-wasm.wasm?url';
import libcascadeWasm from 'libcascade/single/wasm?url';
import replicadWasm from 'replicad-opencascadejs/wasm?url';
import type { CandidateId, ScenarioResult, Timings } from '../shared/types.ts';

const WARM_RUNS = 5;

async function candidateModule(c: CandidateId) {
  if (c === 'libcascade') return { mod: await import('../candidates/libcascade.ts'), wasm: libcascadeWasm };
  if (c === 'replicad') return { mod: await import('../candidates/replicad.ts'), wasm: replicadWasm };
  return { mod: await import('../candidates/brepjs.ts'), wasm: brepjsWasm };
}

self.onmessage = async (e: MessageEvent<{ candidate: CandidateId; t0: number }>) => {
  try {
    const { candidate } = e.data;
    const tImport = performance.now();
    const { mod, wasm } = await candidateModule(candidate);
    const importMs = performance.now() - tImport;
    const loaded = await mod.load(new URL(wasm, import.meta.url).href);
    const readyAt = performance.timeOrigin + performance.now();
    const first: ScenarioResult = await mod.run();
    const warm: Timings[] = [];
    for (let i = 0; i < WARM_RUNS; i++) warm.push((await mod.run()).timings);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const warmMedian = Object.fromEntries(
      Object.keys(first.timings).map((k) => [k, median(warm.map((t) => t[k as keyof Timings]))]),
    );
    const { mesh } = first;
    const transfer = [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer, mesh.faceRanges.buffer];
    self.postMessage(
      {
        ok: true,
        importMs,
        load: loaded,
        readyAt,
        crossOriginIsolated: self.crossOriginIsolated,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        result: { ...first, stl: undefined, step: undefined },
        warmMedian,
        warmRuns: WARM_RUNS,
      },
      { transfer },
    );
  } catch (err) {
    self.postMessage({ ok: false, error: String((err as Error)?.stack ?? err) });
  }
};
