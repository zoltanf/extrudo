/**
 * Reads a folder of real `.f3d` files, when one is given: every file decodes,
 * and every one maps to a design without throwing, its sketch constraints and
 * dimensions vetted by the solver without moving anything. The files are other
 * people's designs, so none are checked in; point `F3D_SAMPLES` at a folder
 * of them to run this (`F3D_SAMPLES=~/f3d pnpm vitest run packages/f3d`), and add
 * `F3D_REPORT=<file>` for what each file left out, technical detail included.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { describe, expect, it } from 'vitest';
import { f3dToDesign } from './map';
import { readF3d } from './model';

const root = process.env.F3D_SAMPLES;
/**
 * With `F3D_REPORT=<file>`, what each file left out is written there with the technical
 * detail people don't see in the app (R3-18), for bug reports and for widening the import.
 */
const reportFile = process.env.F3D_REPORT;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.toLowerCase().endsWith('.f3d')) yield path;
  }
}

describe.skipIf(!root)('a folder of real .f3d files', () => {
  const files = root ? [...walk(root)] : [];

  it('has files to read', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('decodes every file and maps it to a valid design', async () => {
    const failures: string[] = [];
    const lines: string[] = [];
    const solver = new SketchSolver(await loadPlanegcs());
    for (const file of files) {
      try {
        const f3d = readF3d(new Uint8Array(readFileSync(file)));
        const { design, report } = f3dToDesign(f3d, 'Imported', { solver });
        const problems = design.validate();
        if (problems.length > 0) failures.push(`${file}: ${JSON.stringify(problems[0])}`);
        for (const s of report.skipped)
          lines.push(`${file}\t${s.name}\t${s.kind}\t${s.reason}\t${s.detail ?? ''}`);
        for (const line of report.problems) lines.push(`${file}\t\t\t\t${line}`);
        const moved = report.constraints?.maxDisplacement ?? 0;
        if (moved > 1e-6) failures.push(`${file}: a sketch moved ${moved} mm`);
      } catch (error) {
        failures.push(`${file}: ${(error as Error).message}`);
      }
    }
    solver.dispose();
    if (reportFile) writeFileSync(reportFile, `${lines.join('\n')}\n`);
    expect(failures).toEqual([]);
  }, 600_000);
});
