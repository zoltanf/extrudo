// The display mesh's fingerprint over the benchmark fixtures (P4-12 heap item):
// node and triangle counts plus the first 100 positions of every body, so a
// change to meshing (a cure for the warm-cache heap growth, say) shows exactly
// what it changed. The engine's own tessellation is used, as the view takes it.
// Rewrite with `pnpm vitest run -u packages/kernel/src/mesh-golden`; review the
// diff: a cure that changes not one number is the one to keep.
import { type ExtrudoDocument, loadDocument, readSketch } from '@extrudo/core';
import { DEFAULT_FONT } from '@extrudo/fonts';
import { loadFont } from '@extrudo/sketch/text';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b1 from '../../../fixtures/benchmarks/b1-plate.extrudo?url&inline';
import b2 from '../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b3 from '../../../fixtures/benchmarks/b3-phone-stand.extrudo?url&inline';
import b4 from '../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import b6 from '../../../fixtures/benchmarks/b6-wall-hook.extrudo?url&inline';
import b7 from '../../../fixtures/benchmarks/b7-knurled-knob.extrudo?url&inline';
import b8 from '../../../fixtures/benchmarks/b8-name-tag.extrudo?url&inline';
import b9 from '../../../fixtures/benchmarks/b9-bottle-cap.extrudo?url&inline';
import b10 from '../../../fixtures/benchmarks/b10-chain-link.extrudo?url&inline';
import p401 from '../../../fixtures/benchmarks/p4-01-sweep-loft-coil.extrudo?url&inline';
import interRegular from '../../fonts/fonts/inter-regular.ttf?url&inline';
import { kernelFeatures } from './features';
import { Kernel } from './kernel';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';

function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function load(dataUrl: string): ExtrudoDocument {
  const files = unzipSync(bytesOf(dataUrl));
  const json = files['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

/** `[nodes, triangles, first positions (rounded to 1 µm)]` per body. */
function fingerprint(mesh: { positions: Float32Array; indices: Uint32Array } | undefined) {
  if (!mesh) return null;
  const positions = Array.from(mesh.positions.slice(0, 300), (v) => Number(v.toFixed(6)));
  return { nodes: mesh.positions.length / 3, triangles: mesh.indices.length / 3, positions };
}

const FIXTURES: [string, string][] = [
  ['B1', b1],
  ['B2', b2],
  ['B3', b3],
  ['B4', b4],
  ['B5', b5],
  ['B6', b6],
  ['B7', b7],
  ['B8', b8],
  ['B9', b9],
  ['B10', b10],
  ['P4-01', p401],
];

describe('display mesh golden', () => {
  let kernel: Kernel;
  beforeAll(async () => {
    kernel = new Kernel(await loadOcct());
    loadFont(DEFAULT_FONT, bytesOf(interRegular));
  });
  afterAll(() => kernel?.dispose());

  it('fingerprints every fixture body', { timeout: 600_000 }, async () => {
    const table: Record<string, unknown> = {};
    for (const [name, dataUrl] of FIXTURES) {
      const doc = load(dataUrl);
      const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
      const result = await engine.recompute({ doc });
      if (result.status !== 'done') throw new Error(`${name}: ${result.status}`);
      const bodies: Record<string, unknown> = {};
      for (const [index, body] of result.bodies.entries()) {
        const bodyName = doc.bodies[body.id]?.name ?? `Body${index + 1}`;
        bodies[bodyName] = fingerprint(body.mesh);
      }
      // A document with no body still lists its sketch's entity count, so the
      // fixture is not silently empty.
      table[name] = {
        features: doc.features.length,
        sketches: doc.features.filter((f) => readSketch(f) !== undefined).length,
        bodies,
      };
      engine.clear();
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/mesh-golden.json',
    );
  });
});
