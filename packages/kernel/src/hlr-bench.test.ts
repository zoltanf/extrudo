// Measurement (P6-24 S0, ADR-0143's amendment): what OCCT's hidden-line removal
// costs per view direction on the benchmark fixtures, through the facade's
// `edgeVisibility` (HLRBRep_Algo: Update + Hide, then a walk of the visible
// spans). The bodies go through STEP into one fresh kernel per case, so each
// heap figure is that case's own and not the recompute's (whose mesher alone
// raises the heap top by 16 MB blocks). Gated, as heap-bound.test.ts is:
//   HLR_BENCH=1 pnpm vitest run packages/kernel/src/hlr-bench
// It prints the table as a soft failure (the numbers are the point).
// HLR_ONLY=B7,B9 limits it to some cases; HLR_METHODS=1 adds hlrSpans,
// hlrPolySpans and hlrToShapeCount per view.
import type { BodyId, ExtrudoDocument } from '@extrudo/core';
import { loadDocument } from '@extrudo/core';
import { DEFAULT_FONT } from '@extrudo/fonts';
import { loadFont } from '@extrudo/sketch/text';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
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
import hinge from '../../../fixtures/components/hinge.extrudo?url&inline';
import lidBox from '../../../fixtures/components/lid-box.extrudo?url&inline';
import interRegular from '../../fonts/fonts/inter-regular.ttf?url&inline';
import { kernelFeatures } from './features';
import { Kernel, type ShapeHandle, type Vec3 } from './kernel';
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

const ENV =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

// B1's fixture is the plate's sketch alone (its e2e spec makes the body), so it adds nothing here.
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
  ['hinge', hinge],
  ['lid-box', lidBox],
];

const s = 1 / Math.sqrt(3);
const DIRECTIONS: [string, Vec3][] = [
  ['+X', [1, 0, 0]],
  ['-X', [-1, 0, 0]],
  ['+Y', [0, 1, 0]],
  ['-Y', [0, -1, 0]],
  ['+Z', [0, 0, 1]],
  ['-Z', [0, 0, -1]],
  ['iso', [s, -s, s]],
];

const mb = (bytes: number) => (bytes / 2 ** 20).toFixed(1);

/** The bodies of a fixture at its marker, as one STEP text (so a fresh kernel can read them). */
async function stepOf(kernel: Kernel, dataUrl: string): Promise<string> {
  const doc = load(dataUrl);
  const engine = new RecomputeEngine(kernel, kernelFeatures());
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error(result.status);
  const held = engine.hold(result.bodies.map((b) => b.id as BodyId));
  try {
    const shapes = held.shapes.filter(
      (x): x is ShapeHandle => x !== undefined && !kernel.isMesh(x),
    );
    if (shapes.length === 0) return '';
    return kernel.writeStep(shapes.map((shape, i) => ({ shape, name: `body ${i}` })));
  } finally {
    held.release();
    engine.clear();
  }
}

describe.runIf(ENV.HLR_BENCH)('hidden-line removal cost', () => {
  beforeAll(() => loadFont(DEFAULT_FONT, bytesOf(interRegular)));

  it('times edgeVisibility in seven directions per fixture', { timeout: 3_600_000 }, async () => {
    // Each fixture's bodies as STEP, made in one kernel.
    const steps = new Map<string, string>();
    const maker = new Kernel(await loadOcct());
    try {
      for (const [name, dataUrl] of FIXTURES) steps.set(name, await stepOf(maker, dataUrl));
      // STEP_OUT=<dir> also writes them, for a native harness.
      if (ENV.STEP_OUT) {
        const fs = (
          globalThis as {
            process?: {
              getBuiltinModule(id: string): { writeFileSync(p: string, d: string): void };
            };
          }
        ).process?.getBuiltinModule('node:fs');
        const writeFileSync = (p: string, d: string) => fs?.writeFileSync(p, d);
        for (const [name, text] of steps)
          if (text) writeFileSync(`${ENV.STEP_OUT}/${name}.step`, text);
        return;
      }
    } finally {
      maker.dispose();
    }
    // An assembly of about 200 faces: seven fixtures side by side, 150 mm apart along x.
    const ASSEMBLY = ['B2', 'B3', 'B4', 'B5', 'B6', 'B10', 'hinge'];
    const cases: [string, string[]][] = [
      ...[...steps.keys()].map((name): [string, string[]] => [name, [name]]),
      ['assembly', ASSEMBLY],
    ];

    const rows: string[] = [
      'model | solids | faces | edges | 6 ortho, 1st pass (ms) | 6 ortho, 2nd pass (ms) | iso (ms) | slowest view (ms) | heap top: read → after HLR → after 3 more passes (MB)',
    ];
    const only = ENV.HLR_ONLY?.split(',');
    for (const [name, parts] of cases) {
      if (only && !only.includes(name)) continue;
      const kernel = new Kernel(await loadOcct());
      try {
        const shapes: ShapeHandle[] = [];
        parts.forEach((part, i) => {
          if (!steps.get(part)) return;
          const read = kernel.readStep(steps.get(part) ?? '');
          if (parts.length === 1) {
            shapes.push(read);
            return;
          }
          const moved = kernel.transform(read, [1, 0, 0, 150 * i, 0, 1, 0, 0, 0, 0, 1, 0]);
          kernel.release(read);
          shapes.push(moved.shape);
        });
        if (shapes.length === 0) {
          rows.push(`${name} | 0 | 0 | 0 | (no B-rep bodies) | | | |`);
          continue;
        }
        const all = kernel.compound(shapes);
        const solids = kernel.solids(all);
        const faces = kernel.count(all, 'face');
        const edges = kernel.count(all, 'edge');
        const read = kernel.heap().top;
        const pass = () =>
          DIRECTIONS.map(([, d]) => {
            const t = performance.now();
            kernel.edgeVisibility(all, d);
            return performance.now() - t;
          });
        const first = pass();
        const afterHlr = kernel.heap().top;
        const second = pass();
        pass();
        pass();
        const afterMore = kernel.heap().top;
        const sum = (xs: number[]) => xs.slice(0, 6).reduce((a, b) => a + b, 0);
        const slowest = Math.max(...first, ...second);
        const slowDir = DIRECTIONS[[...first, ...second].indexOf(slowest) % 7]?.[0];
        rows.push(
          `${name} | ${solids.length} | ${faces} | ${edges} | ${sum(first).toFixed(0)} | ${sum(second).toFixed(0)} | ${Math.min(first[6] ?? 0, second[6] ?? 0).toFixed(0)} | ${slowest.toFixed(0)} (${slowDir}) | ${mb(read)} → ${mb(afterHlr)} → ${mb(afterMore)}`,
        );
        // A slow case gets its views one by one (the second pass).
        if (sum(second) > 1000) {
          rows.push(
            `  ${name} per view: ${DIRECTIONS.map(([d], i) => `${d} ${second[i]?.toFixed(0)}`).join(', ')}`,
          );
        }
        // HLR_METHODS=1: per view, the spans walk (exact), the polygonal run on the
        // display-like mesh made first, and OCCT's HLRToShape after the exact run.
        if (ENV.HLR_METHODS) {
          const t = performance.now();
          kernel.mesh(all, { linearDeflection: 0.02, angularDeflection: (15 * Math.PI) / 180 });
          const meshed = performance.now() - t;
          const cells = DIRECTIONS.map(([dir, d]) => {
            const time = (run: () => number) => {
              const t0 = performance.now();
              const n = run();
              return [performance.now() - t0, n] as const;
            };
            const [te, ne] = time(() => kernel.hlrSpans(all, d).length);
            const [tp, np] = time(() => kernel.hlrPolySpans(all, d, 0.02).length);
            const [ts, ns] = time(() => kernel.hlrToShapeCount(all, d));
            return `${dir} ${te.toFixed(0)}/${tp.toFixed(1)}/${ts.toFixed(0)} (${ne}/${np}/${ns})`;
          });
          rows.push(
            `  ${name} spans/poly/toShape ms (records/pieces/edges), mesh ${meshed.toFixed(0)} ms: ${cells.join(', ')}`,
          );
        }
        kernel.release(...solids, all, ...shapes);
      } finally {
        kernel.dispose();
      }
    }
    expect.soft(rows.join('\n')).toBeUndefined();
  });
});
