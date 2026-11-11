/**
 * Reads a folder of real `.FCStd` files, when one is given: every file
 * decodes, every stored-shape entry is accounted for, and the final-shape
 * rule ends. The files are other people's designs, so none are checked in;
 * point `FCSTD_SAMPLES` at a folder of them (searched recursively) to run
 * this (`FCSTD_SAMPLES=~/fcstd pnpm vitest run packages/fcstd`).
 *
 * - `FCSTD_REPORT=<file>` (outside the repository) writes per-file counts,
 *   problems and unknown property types.
 * - `FCSTD_CENSUS=<file>` compares each file's object and stored-shape counts
 *   with an earlier census (`{ files: [{ file, objects, brp_nonempty }] }`,
 *   `file` relative to `FCSTD_SAMPLES`).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finalShapes } from './final-shapes';
import { readFcstd } from './model';

const root = process.env.FCSTD_SAMPLES;
const reportFile = process.env.FCSTD_REPORT;
const censusFile = process.env.FCSTD_CENSUS;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.toLowerCase().endsWith('.fcstd')) yield path;
  }
}

interface Census {
  file: string;
  objects: number;
  brp_nonempty: number;
}

describe.skipIf(!root)('a folder of real .FCStd files', () => {
  const files = root ? [...walk(root)] : [];

  it('has files to read', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('reads every file and finds its final shapes', () => {
    const census = censusFile
      ? new Map(
          (JSON.parse(readFileSync(censusFile, 'utf8')) as { files: Census[] }).files.map((c) => [
            c.file,
            c,
          ]),
        )
      : undefined;
    const failures: string[] = [];
    const lines: string[] = [];
    const unknown: Record<string, number> = {};
    const totals = { files: 0, objects: 0, sketches: 0, shapes: 0, final: 0, problems: 0 };
    const finalByKind: Record<string, number> = {};
    let slowest = { file: '', ms: 0, bytes: 0 };
    for (const file of files) {
      const name = relative(root as string, file);
      try {
        const bytes = new Uint8Array(readFileSync(file));
        const t = performance.now();
        const doc = readFcstd(bytes);
        const final = finalShapes(doc);
        const ms = performance.now() - t;
        if (ms > slowest.ms) slowest = { file: name, ms, bytes: bytes.length };
        const shapes = doc.entries.names.filter(
          (n) => n.endsWith('.brp') && (doc.entries.size(n) ?? 0) > 0,
        ).length;
        const sketches = doc.objects.filter((o) =>
          o.type.startsWith('Sketcher::SketchObject'),
        ).length;
        totals.files++;
        totals.objects += doc.objects.length;
        totals.sketches += sketches;
        totals.shapes += shapes;
        totals.final += final.length;
        totals.problems += doc.problems.length;
        for (const s of final) finalByKind[s.kind] = (finalByKind[s.kind] ?? 0) + 1;
        for (const [type, n] of Object.entries(doc.unknownTypes))
          unknown[type] = (unknown[type] ?? 0) + n;
        const c = census?.get(name);
        if (census && !c) failures.push(`${name}: not in the census`);
        if (c && c.objects !== doc.objects.length)
          failures.push(`${name}: ${doc.objects.length} objects, the census has ${c.objects}`);
        if (c && c.brp_nonempty !== shapes)
          failures.push(`${name}: ${shapes} stored shapes, the census has ${c.brp_nonempty}`);
        lines.push(
          [
            name,
            `version ${doc.programVersion}`,
            `objects ${doc.objects.length}`,
            `sketches ${sketches}`,
            `shapes ${shapes}`,
            `final ${final.length} (${final.map((s) => s.kind[0]).join('')})`,
            `hidden ${final.filter((s) => !s.visible).length}`,
            `gui ${doc.hasGui}`,
            `${Math.round(ms)} ms`,
          ].join('\t'),
        );
        for (const s of final)
          lines.push(`\tfinal\t${s.kind}\t${s.object.name}\t${s.entry ?? ''}\t${s.chain.length}`);
        for (const p of doc.problems) lines.push(`\tproblem\t${p}`);
      } catch (error) {
        failures.push(`${name}: ${(error as Error).message}`);
      }
    }
    const summary = [
      `totals ${JSON.stringify(totals)}`,
      `final by kind ${JSON.stringify(finalByKind)}`,
      `unknown property types ${JSON.stringify(unknown)}`,
      `slowest ${slowest.file} ${Math.round(slowest.ms)} ms (${slowest.bytes} bytes)`,
    ];
    if (reportFile) writeFileSync(reportFile, `${[...summary, ...lines].join('\n')}\n`);
    console.log(summary.join('\n'));
    expect(failures).toEqual([]);
  }, 600_000);
});
