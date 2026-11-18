/**
 * The loose chains of a folder of real `.FCStd` files, when one is given (P6-25 S12a): every file
 * through `importFcstd` with the kernel in Node and the real solver, as numbers only. The files
 * are other people's designs, so none are checked in; `FCSTD_REPORT=<file>` writes a line per
 * chain that didn't come in whole, outside the repository.
 *
 *   FCSTD_SAMPLES=<dir> pnpm vitest run packages/fcstd/src/chain-corpus.test.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { describe, expect, it } from 'vitest';
import { MAX_BODY_FEATURES, MAX_FILE_FEATURES } from './bodies';
import { asOldFile, chainDocuments, OLD_PROPERTIES } from './chain-parts';
import { finalShapes } from './final-shapes';
import { importFcstd } from './import';
import { looseChains } from './loose-chains';
import { readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import { parameterCounts } from './parameters-report';

const root = process.env.FCSTD_SAMPLES;
const reportFile = process.env.FCSTD_REPORT;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.toLowerCase().endsWith('.fcstd')) yield path;
  }
}

const bump = (r: Record<string, number>, k: string, by = 1) => {
  r[k] = (r[k] ?? 0) + by;
};

describe.skipIf(!root)('the loose chains of a library (FCSTD_SAMPLES)', () => {
  it('the old grammar the tests write is the one old files have', { timeout: 300_000 }, () => {
    /** `type.property` → the declared types the library's files before 0.17 use for it. */
    const library = new Map<string, Set<string>>();
    const types = new Set<string>();
    for (const path of walk(root as string)) {
      const doc = readFcstd(new Uint8Array(readFileSync(path)));
      const [major, minor] = doc.version ?? [1, 0];
      if (major !== 0 || minor < 14 || minor > 16) continue;
      for (const o of doc.objects) {
        if (!Object.hasOwn(OLD_PROPERTIES, o.type)) continue;
        types.add(o.type);
        for (const p of Object.values(o.properties)) {
          const key = `${o.type}.${p.name}`;
          library.set(key, (library.get(key) ?? new Set()).add(p.type));
        }
      }
    }
    let written = 0;
    const strange: string[] = [];
    for (const name of chainDocuments())
      for (const version of ['0.14', '0.16'] as const) {
        const doc = readFcstd(asOldFile(name, version));
        for (const o of doc.objects) {
          // The library's old files hold no groove and no mirror: nothing to compare them with.
          if (!types.has(o.type)) continue;
          for (const p of Object.values(o.properties)) {
            // Every object has one from 0.16; the library's 0.16 files just don't hold every type.
            if (p.name === 'ExpressionEngine') continue;
            written++;
            if (!library.get(`${o.type}.${p.name}`)?.has(p.type))
              strange.push(`${o.type}.${p.name}: ${p.type}`);
          }
        }
      }
    console.log(JSON.stringify({ libraryProperties: library.size, written }));
    expect([...new Set(strange)].sort()).toEqual([]);
    expect(written).toBeGreaterThan(0);
  });

  it('reports, as numbers, how each chain came in', { timeout: 3_600_000 }, async () => {
    const solver = new SketchSolver(await loadPlanegcs());
    const kernel = nodeImportKernel();
    const chains: Record<string, number> = {};
    const today: Record<string, number> = {};
    const features: Record<string, number> = {};
    const planes: Record<string, number> = {};
    const rules: Record<string, number> = {};
    const lengths: Record<string, number> = {};
    const steps: Record<string, number> = {};
    const bodies: Record<string, number> = {};
    const parameters: Record<string, number> = {};
    const imports = { finalShapes: 0, chainSteps: 0, bodySteps: 0, all: 0 };
    const references = { found: 0, none: 0, several: 0 };
    const times: number[] = [];
    const lines: string[] = [];
    let finals = 0;
    let conflicts = 0;
    let foreign = 0;
    let restarts = 0;
    let filesWithChains = 0;
    for (const path of walk(root as string)) {
      const bytes = new Uint8Array(readFileSync(path));
      const doc = readFcstd(bytes);
      const planned = looseChains(
        doc,
        finalShapes(doc).filter((s) => s.kind === 'chain-tip'),
        { maxFeatures: MAX_BODY_FEATURES, maxFile: MAX_FILE_FEATURES },
      );
      if (planned.length > 0) filesWithChains++;
      for (const c of planned) {
        bump(lengths, String(c.features.length));
        for (const r of c.rules) bump(rules, r);
        conflicts += c.conflicts;
        if (c.foreignBase) foreign++;
      }
      const t = performance.now();
      const { report, design } = await importFcstd(bytes, 'Library', { kernel, solver });
      times.push(performance.now() - t);
      finals += report.finalShapes;
      restarts += report.restarts;
      imports.all += design.doc.features.filter((f) => f.type === 'import').length;
      imports.finalShapes += report.shapes.length;
      const counts = parameterCounts(report.parameters) as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(counts))
        if (typeof v === 'number') bump(parameters, k, v);
      for (const b of report.bodies) {
        if (!b.loose) {
          bump(bodies, b.outcome === 'history' ? 'history' : b.outcome);
          imports.bodySteps += b.steps.length;
          continue;
        }
        imports.chainSteps += b.steps.length;
        const whole = b.outcome === 'history' && b.steps.length === 0;
        const kind = whole ? 'whole history' : b.outcome === 'history' ? 'with steps' : 'as today';
        bump(chains, kind);
        if (b.loose.foreignBase) bump(chains, `${kind}, foreign base`);
        for (const s of b.steps) bump(steps, s.reason);
        for (const m of b.mapped) {
          bump(features, `${m.kind} held`);
          references.found += m.references?.found ?? 0;
          references.none += m.references?.none ?? 0;
          references.several += m.references?.several ?? 0;
        }
        for (const s of b.sketches) bump(planes, s.plane ?? 'none');
        if (kind === 'as today') bump(today, b.stop?.reason ?? 'none');
        if (!whole)
          lines.push(
            JSON.stringify({
              file: path,
              tip: b.object,
              kind,
              features: b.features,
              held: b.mapped.length,
              stop: b.stop,
              steps: b.steps.map((s) => ({ reason: s.reason, detail: s.detail, at: s.shape })),
            }),
          );
      }
    }
    const sorted = [...times].sort((a, b) => a - b);
    const summary = {
      filesWithChains,
      finals,
      restarts,
      chains,
      today,
      lengths,
      rules,
      conflicts,
      foreign,
      features,
      steps,
      planes,
      references,
      parameters,
      imports,
      bodies,
      timeMs: {
        median: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
        slowest: Math.round(sorted.at(-1) ?? 0),
      },
    };
    console.log(JSON.stringify(summary, null, 1));
    if (reportFile) writeFileSync(reportFile, `${JSON.stringify(summary)}\n${lines.join('\n')}\n`);
    expect(restarts).toBe(0);
  });
});
