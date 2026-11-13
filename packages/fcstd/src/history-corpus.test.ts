/**
 * The history import over a folder of real `.FCStd` files, when one is given
 * (P6-25 S5): every file through `importFcstd` with the kernel in Node and
 * the real solver, as numbers only. The files are other people's designs, so
 * none are checked in; `FCSTD_REPORT=<file>` writes a line per stop (file,
 * feature, why, the measures) to look into, outside the repository.
 *
 *   FCSTD_SAMPLES=<dir> pnpm vitest run packages/fcstd/src/history-corpus.test.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { describe, expect, it } from 'vitest';
import { bodyChain } from './bodies';
import { decodeFeature, FEATURE_TYPES } from './features';
import { finalShapes } from './final-shapes';
import { importFcstd } from './import';
import { readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import { containerChain } from './sketch-place';

const root = process.env.FCSTD_SAMPLES;
const reportFile = process.env.FCSTD_REPORT;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.toLowerCase().endsWith('.fcstd')) yield path;
  }
}

const kindOf = (type: string) => FEATURE_TYPES[type] ?? 'other';
const bump = (r: Record<string, number>, k: string, by = 1) => {
  r[k] = (r[k] ?? 0) + by;
};
/** The counts of `kind`, made when first needed. */
const of = (r: Record<string, Record<string, number>>, kind: string) => {
  r[kind] ??= {};
  return r[kind];
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.min(s.length - 1, Math.floor(q * s.length))] as number);
};

describe.skipIf(!root)('the history import over a library (FCSTD_SAMPLES)', () => {
  it('reports, as numbers, what came in with its history and where it stopped', async () => {
    const files = [...walk(root as string)];
    const solver = new SketchSolver(await loadPlanegcs());
    const kernel = nodeImportKernel();
    const byKind: Record<string, Record<string, number>> = {};
    const bodies: Record<string, number> = {};
    const fellBackAt: Record<string, number> = {};
    const equal: { volume: number[]; area: number[]; box: number[] } = {
      volume: [],
      area: [],
      box: [],
    };
    const differed: { volume: number; area: number; box: number; solids: boolean }[] = [];
    const times: number[] = [];
    let restarts = 0;
    let longestChain = 0;
    let mostFeatures = 0;
    let importsS3 = 0;
    let importsS5 = 0;
    let otherSame = 0;
    let otherDiffer = 0;
    const lines: string[] = [];
    const census: Record<string, number> = {};
    for (const file of files) {
      const bytes = new Uint8Array(readFileSync(file));
      const doc = readFcstd(bytes);
      let walked = 0;
      for (const o of doc.objects)
        if (FEATURE_TYPES[o.type]) bump(census, `${kindOf(o.type)} in the file`);
      for (const s of finalShapes(doc)) {
        if (s.kind !== 'body') continue;
        const chain = bodyChain(doc, s.object);
        for (const f of 'features' in chain ? chain.features : [])
          if (FEATURE_TYPES[f.type]) bump(census, `${kindOf(f.type)} in a body's chain`);
        const n = 'features' in chain ? chain.features.length : 0;
        longestChain = Math.max(longestChain, n);
        walked += n;
      }
      mostFeatures = Math.max(mostFeatures, walked);
      // S3's way first, for what is not a body.
      const s3 = await importFcstd(bytes, 'X', { kernel, maxFileFeatures: 0 });
      const t = performance.now();
      const { report } = await importFcstd(bytes, 'X', { kernel, solver });
      times.push(performance.now() - t);
      restarts += report.restarts;
      importsS3 += s3.report.shapes.length;
      importsS5 += report.shapes.length;
      const bodyNames = new Set(report.bodies.map((b) => b.object));
      const outcome = (r: typeof report) =>
        new Map([
          ...r.shapes.map((x) => [x.object, `in ${x.solids} ${x.drift.toPrecision(3)}`] as const),
          ...r.leftOut.map((x) => [x.object, `out ${x.reason}`] as const),
        ]);
      const before = outcome(s3.report);
      const after = outcome(report);
      for (const [object, o] of before) {
        if (bodyNames.has(object)) continue;
        if (after.get(object) === o) otherSame++;
        else otherDiffer++;
      }
      for (const b of report.bodies) {
        bump(bodies, b.outcome);
        const body = doc.byName.get(b.object);
        const chain = body ? bodyChain(doc, body) : { broken: '' };
        const features = 'features' in chain ? chain.features : [];
        for (const m of b.mapped) {
          bump(of(byKind, m.kind), 'equal');
          equal.volume.push(m.drift.volume);
          equal.area.push(m.drift.area);
          equal.box.push(m.drift.diagonal > 0 ? m.drift.corner / m.drift.diagonal : m.drift.corner);
        }
        if (!b.stop) continue;
        const at = features.findIndex((f) => f.name === b.stop?.object);
        const kind = kindOf(b.stop.type);
        bump(fellBackAt, `${kind} (${b.stop.reason})`);
        bump(of(byKind, kind), b.stop.reason === 'differs' ? 'differed' : `stop:${b.stop.reason}`);
        for (const f of features.slice(at + 1)) bump(of(byKind, kindOf(f.type)), 'not reached');
        if (b.stop.drift)
          differed.push({
            volume: b.stop.drift.volume,
            area: b.stop.drift.area,
            box:
              b.stop.drift.diagonal > 0
                ? b.stop.drift.corner / b.stop.drift.diagonal
                : b.stop.drift.corner,
            solids: /solid/.test(b.stop.detail ?? ''),
          });
        const f = features[at];
        const frame = f ? containerChain(doc, f) : undefined;
        const decoded =
          f && body ? decodeFeature(doc, f, { body, moved: frame?.moved ?? false }) : undefined;
        lines.push(
          JSON.stringify({
            file,
            body: b.object,
            feature: b.stop.object,
            type: b.stop.type,
            reason: b.stop.reason,
            detail: b.stop.detail,
            drift: b.stop.drift,
            mapped: b.mapped.length,
            decoded: decoded?.ok ? decoded.feature : decoded,
          }),
        );
      }
    }
    const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
    const min = (xs: number[]) => xs.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
    const summary = {
      files: files.length,
      census,
      byKind,
      bodies,
      fellBackAt,
      equalDrift: {
        volume: {
          max: max(equal.volume),
          p99: quantile(equal.volume, 0.99),
          p50: quantile(equal.volume, 0.5),
        },
        area: {
          max: max(equal.area),
          p99: quantile(equal.area, 0.99),
          p50: quantile(equal.area, 0.5),
        },
        box: { max: max(equal.box), p99: quantile(equal.box, 0.99), p50: quantile(equal.box, 0.5) },
      },
      nearestDiffered: {
        sameSolids: differed.filter((d) => !d.solids).length,
        volume: min(differed.filter((d) => !d.solids).map((d) => d.volume)),
        area: min(differed.filter((d) => !d.solids).map((d) => d.area)),
        box: min(differed.filter((d) => !d.solids).map((d) => d.box)),
        largestOfThree: min(
          differed.filter((d) => !d.solids).map((d) => Math.max(d.volume, d.area, d.box)),
        ),
      },
      timeMs: { median: Math.round(quantile(times, 0.5)), slowest: Math.round(max(times)) },
      restarts,
      longestChain,
      mostFeaturesInAFile: mostFeatures,
      imports: { s3: importsS3, s5: importsS5 },
      notBodies: { same: otherSame, differ: otherDiffer },
    };
    console.log(JSON.stringify(summary, null, 1));
    if (reportFile) writeFileSync(reportFile, `${JSON.stringify(summary)}\n${lines.join('\n')}\n`);
    expect(otherDiffer).toBe(0);
  }, 3_600_000);
});
