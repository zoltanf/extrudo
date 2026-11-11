/**
 * The shapes-only import over a folder of real `.FCStd` files, when one is
 * given (P6-25 S3): every file through `importFcstd` with the kernel in Node.
 * The files are other people's designs, so none are checked in.
 *
 * - `FCSTD_SAMPLES=<dir>`: the files (searched recursively).
 * - `FCSTD_REPORT=<file>` (outside the repository): per file and per shape,
 *   what came in, what was left out and why, times, sizes, drifts.
 * - `FCSTD_GT=<dir>`: FreeCAD's own numbers, one JSON per file
 *   (`{ file, stored: [{ name, shape: { volume, bbox, solids } }] }`);
 *   `FCSTD_GT_PREFIX=<old>=<new>` rewrites the `file` paths in them.
 *
 * Only totals go to the console.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finalShapes, linkedObjects } from './final-shapes';
import { NO_HISTORY } from './fixtures';
import { importFcstd } from './import';
import type { ImportKernel } from './import-kernel';
import { type FcDocument, type FcPlacement, readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';

const root = process.env.FCSTD_SAMPLES;
const reportFile = process.env.FCSTD_REPORT;
const gtDir = process.env.FCSTD_GT;
const gtPrefix = process.env.FCSTD_GT_PREFIX;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.toLowerCase().endsWith('.fcstd')) yield path;
  }
}

interface GtShape {
  solids?: number;
  volume?: number;
  bbox?: number[];
}
type Gt = Map<string, GtShape>;

function loadGt(): Map<string, Gt> {
  const out = new Map<string, Gt>();
  if (!gtDir) return out;
  const [from, to] = (gtPrefix ?? '=').split('=') as [string, string];
  for (const name of readdirSync(gtDir)) {
    if (!name.endsWith('.json')) continue;
    const d = JSON.parse(readFileSync(join(gtDir, name), 'utf8')) as {
      file: string;
      stored?: { name: string; shape?: GtShape }[];
    };
    let file = d.file;
    if (from && file.startsWith(from)) file = to.replace(/^~/, homedir()) + file.slice(from.length);
    out.set(resolve(file), new Map((d.stored ?? []).map((o) => [o.name, o.shape ?? {}])));
  }
  return out;
}

type M = number[];
const quatMat = ({ position: [px, py, pz], rotation }: FcPlacement): M => {
  const n = Math.hypot(...rotation) || 1;
  const [x, y, z, w] = rotation.map((v) => v / n) as [number, number, number, number];
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    px,
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    py,
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
    pz,
  ];
};
const compose = (a: M, b: M): M => {
  const out: M = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      let s = c === 3 ? (a[4 * r + 3] as number) : 0;
      for (let k = 0; k < 3; k++) s += (a[4 * r + k] as number) * (b[4 * k + c] as number);
      out.push(s);
    }
  return out;
};
const IDENT: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
/** Whether the 3 × 3 part only swaps and flips axes (a box then maps onto a box exactly). */
const axisAligned = (m: M) =>
  [0, 1, 2].every(
    (r) => [0, 1, 2].filter((c) => Math.abs(m[4 * r + c] as number) > 1e-9).length === 1,
  );
/** The box around a box's corners after `m`. */
function moveBox(m: M, b: number[]): number[] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = [b[i & 1 ? 3 : 0], b[i & 2 ? 4 : 1], b[i & 4 ? 5 : 2]] as number[];
    for (let r = 0; r < 3; r++) {
      const v =
        (m[4 * r] as number) * (p[0] as number) +
        (m[4 * r + 1] as number) * (p[1] as number) +
        (m[4 * r + 2] as number) * (p[2] as number) +
        (m[4 * r + 3] as number);
      min[r] = Math.min(min[r] as number, v);
      max[r] = Math.max(max[r] as number, v);
    }
  }
  return [...min, ...max];
}

/** How many of a link's chain entries are the links' own (the rest are its containers). */
function linkEntries(doc: FcDocument, name: string): number {
  let n = 0;
  let o = doc.byName.get(name);
  for (let hop = 0; o && hop < 32; hop++) {
    if (o.type !== 'App::Link' && o.type !== 'App::LinkElement') break;
    const keep = o.properties.LinkTransform?.value;
    n += keep?.kind === 'bool' && keep.value ? 1 : 2;
    const v = o.properties.LinkedObject?.value;
    const target = v ? linkedObjects(v)[0] : undefined;
    o = target === undefined ? undefined : doc.byName.get(target);
  }
  return n;
}

const percentile = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
};

describe.skipIf(!root)('a folder of real .FCStd files through importFcstd', () => {
  it('imports every file', async () => {
    const files = [...walk(root as string)];
    const gt = loadGt();
    const failures: string[] = [];
    const lines: string[] = [];
    const totals = { files: 0, final: 0, in: 0, solidsIn: 0, gtSolids: 0, restarts: 0 };
    const reasons: Record<string, number> = {};
    const drifts: number[] = [];
    const gtVolume: number[] = [];
    const gtBox: number[] = [];
    const gtSlack: number[] = [];
    const placed = { moved: 0, link: 0, movedAgree: 0, linkAgree: 0, rotated: 0 };
    const disagree: string[] = [];
    const colours: Record<string, number> = {};
    let slowest = { ms: 0, file: '' };
    let slowestShape = 0;
    const times: number[] = [];
    let largestStep = 0;
    let largestDesign = 0;
    // One kernel for the run (a restart replaces it); a kernel per file would hold 60 WASM heaps.
    const base = nodeImportKernel();
    for (const file of files) {
      const bytes = new Uint8Array(readFileSync(file));
      let shapeMs = 0;
      const kernel: ImportKernel = {
        storedShapeToStep: async (text, chain) => {
          const t = performance.now();
          try {
            return await base.storedShapeToStep(text, chain);
          } finally {
            shapeMs = Math.max(shapeMs, performance.now() - t);
          }
        },
        ...NO_HISTORY,
        restart: () => base.restart(),
      };
      const t = performance.now();
      try {
        const doc = readFcstd(bytes);
        const shapes = finalShapes(doc);
        // S3's numbers: no history walked (S5's own corpus test walks it).
        const {
          design,
          files: attached,
          report,
        } = await importFcstd(bytes, 'X', {
          kernel,
          maxFileFeatures: 0,
        });
        const ms = performance.now() - t;
        times.push(ms);
        if (ms > slowest.ms) slowest = { ms, file };
        slowestShape = Math.max(slowestShape, shapeMs);
        totals.files++;
        totals.final += report.finalShapes;
        totals.in += report.shapes.length;
        totals.restarts += report.restarts;
        for (const s of report.shapes) totals.solidsIn += s.solids;
        for (const l of report.leftOut) reasons[l.reason] = (reasons[l.reason] ?? 0) + 1;
        const sizes = [...attached.values()].map((b) => b.length);
        const designBytes = sizes.reduce((a, b) => a + b, 0);
        largestStep = Math.max(largestStep, ...sizes, 0);
        largestDesign = Math.max(largestDesign, designBytes);
        lines.push(
          [
            file,
            `final ${report.finalShapes}`,
            `in ${report.shapes.length}`,
            `left out ${report.leftOut.map((l) => l.reason).join(',')}`,
            `${Math.round(ms)} ms (slowest shape ${Math.round(shapeMs)} ms)`,
            `STEP ${designBytes} bytes in ${sizes.length} files, largest ${Math.max(0, ...sizes)}`,
          ].join('\t'),
        );
        for (const l of report.leftOut)
          lines.push(`\tleft out\t${l.name}\t${l.reason}\t${l.detail ?? ''}`);
        const doc2 = design.toJSON();
        const fileGt = gt.get(resolve(file));
        // Each final shape against FreeCAD's own numbers for the chosen object.
        for (const s of shapes) {
          const imp = report.shapes.find((x) => x.object === s.object.name);
          if (s.colour) {
            const key = s.colour.map((c) => Math.round(c * 255)).join(',');
            colours[key] = (colours[key] ?? 0) + 1;
          }
          const g = fileGt?.get(s.object.name);
          if (g?.solids !== undefined && s.format === 'brep') totals.gtSolids += g.solids;
          if (!imp || !fileGt) continue;
          const f = doc2.features.find((x) => x.id === imp.feature);
          const att = (f?.inputs.file as { id: string } | undefined)?.id;
          const stepBytes = att ? attached.get(att as never) : undefined;
          if (!stepBytes || !g?.bbox || g.volume === undefined) continue;
          lines.push(
            `\tshape\t${s.name}\tsolids ${imp.solids}/${g.solids}\tdrift ${imp.drift.toExponential(2)}`,
          );
          drifts.push(imp.drift);
          // FreeCAD's `Shape` is in its container's frame; a link's already carries the link's placement.
          const isLink = s.kind === 'link';
          const containerChain = isLink
            ? s.chain.slice(0, s.chain.length - linkEntries(doc, s.object.name))
            : s.chain;
          const m = containerChain.reduce((a, p) => compose(a, quatMat(p)), IDENT);
          const moved =
            containerChain.length > 0 &&
            m.some((v, k) => Math.abs(v - (IDENT[k] as number)) > 1e-12);
          if (moved) placed.moved++;
          if (isLink) placed.link++;
          const expected = moveBox(m, g.bbox);
          const measured = stepMeasure.get(stepBytes);
          if (!measured) continue;
          const dv = Math.abs(measured.volume - g.volume) / Math.max(Math.abs(g.volume), 1e-12);
          gtVolume.push(g.volume === 0 ? 0 : dv);
          if (!axisAligned(m)) {
            placed.rotated++;
            continue;
          }
          const diag = Math.hypot(
            (g.bbox[3] as number) - (g.bbox[0] as number),
            (g.bbox[4] as number) - (g.bbox[1] as number),
            (g.bbox[5] as number) - (g.bbox[2] as number),
          );
          // FreeCAD's BoundBox may be looser than the tight one Extrudo measures:
          // ours must sit inside it (`outside`), and `slack` says how much looser it is.
          const box = measured.box as number[];
          const outside = Math.max(
            ...[0, 1, 2].map((k) => (expected[k] as number) - (box[k] as number)),
            ...[3, 4, 5].map((k) => (box[k] as number) - (expected[k] as number)),
          );
          const slack = Math.max(...expected.map((v, k) => Math.abs(v - (box[k] as number))));
          const rel = Math.max(0, outside) / Math.max(diag, 1e-9);
          gtBox.push(rel);
          gtSlack.push(slack / Math.max(diag, 1e-9));
          const ok = rel <= 1e-4 && dv <= 1e-3;
          if (moved && ok) placed.movedAgree++;
          if (isLink && ok) placed.linkAgree++;
          if (!ok)
            disagree.push(
              `${file}\t${s.name}\tvolume ${dv.toExponential(2)} box outside ${rel.toExponential(2)}`,
            );
        }
      } catch (error) {
        failures.push(`${file}: ${(error as Error).message}`);
      }
    }
    const summary = [
      `totals ${JSON.stringify(totals)}`,
      `left out by reason ${JSON.stringify(reasons)}`,
      `placements ${JSON.stringify(placed)}`,
      `drift through STEP: n ${drifts.length}, >1e-6 ${drifts.filter((d) => d > 1e-6).length}, >1e-5 ${drifts.filter((d) => d > 1e-5).length}, >1e-4 ${drifts.filter((d) => d > 1e-4).length}, max ${Math.max(0, ...drifts).toExponential(2)}, p99 ${percentile(drifts, 0.99).toExponential(2)}`,
      `volume vs FreeCAD: n ${gtVolume.length}, >1e-6 ${gtVolume.filter((d) => d > 1e-6).length}, >1e-4 ${gtVolume.filter((d) => d > 1e-4).length}, max ${Math.max(0, ...gtVolume).toExponential(2)}`,
      `box outside FreeCAD's (relative to diagonal): n ${gtBox.length}, >1e-6 ${gtBox.filter((d) => d > 1e-6).length}, >1e-4 ${gtBox.filter((d) => d > 1e-4).length}, >1e-3 ${gtBox.filter((d) => d > 1e-3).length}, max ${Math.max(0, ...gtBox).toExponential(2)}`,
      `FreeCAD's box looser than ours (relative to diagonal): >1e-6 ${gtSlack.filter((d) => d > 1e-6).length}, >1e-4 ${gtSlack.filter((d) => d > 1e-4).length}, >1e-2 ${gtSlack.filter((d) => d > 1e-2).length}, p50 ${percentile(gtSlack, 0.5).toExponential(2)}, max ${Math.max(0, ...gtSlack).toExponential(2)}`,
      `disagreeing with FreeCAD: ${disagree.length}`,
      `time per file: median ${Math.round(percentile(times, 0.5))} ms, p95 ${Math.round(percentile(times, 0.95))} ms, slowest ${Math.round(slowest.ms)} ms; slowest shape ${Math.round(slowestShape)} ms`,
      `STEP: largest attachment ${largestStep} bytes, largest design ${largestDesign} bytes`,
      `colours of final shapes (rgb 0-255 → count): ${JSON.stringify(
        Object.entries(colours)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12),
      )}`,
    ];
    if (reportFile)
      writeFileSync(
        reportFile,
        `${[...summary, `slowest file ${slowest.file}`, ...disagree.map((d) => `disagree\t${d}`), ...lines].join('\n')}\n`,
      );
    console.log(summary.join('\n'));
    expect(failures).toEqual([]);
  }, 3_600_000);
});

/** The measures of a STEP attachment, read with one kernel for the whole run. */
const stepMeasure = {
  kernel: undefined as undefined | import('@extrudo/kernel').Kernel,
  get(bytes: Uint8Array): { volume: number; box: number[] } | undefined {
    const k = this.kernel;
    if (!k) return undefined;
    using scope = k.scope();
    const shape = scope.track(k.readStep(new TextDecoder('latin1').decode(bytes)));
    const { volume, bbox } = k.properties(shape);
    return { volume, box: [...bbox.min, ...bbox.max] };
  },
};

if (root) {
  const { Kernel } = await import('@extrudo/kernel');
  const { loadOcct } = await import('@extrudo/kernel/node');
  stepMeasure.kernel = new Kernel(await loadOcct());
}
