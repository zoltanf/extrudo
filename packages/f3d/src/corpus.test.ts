/**
 * Reads a folder of real `.f3d` files, when one is given: every file decodes,
 * and every one maps to a design without throwing. The files are other
 * people's designs, so none are checked in; point `F3D_SAMPLES` at a folder
 * of them to run this (`F3D_SAMPLES=~/f3d pnpm vitest run packages/f3d`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { f3dToDesign } from './map';
import { readF3d } from './model';

const root = process.env.F3D_SAMPLES;

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

  it('decodes every file and maps it to a valid design', () => {
    const failures: string[] = [];
    for (const file of files) {
      try {
        const f3d = readF3d(new Uint8Array(readFileSync(file)));
        const { design } = f3dToDesign(f3d, 'Imported');
        const problems = design.validate();
        if (problems.length > 0) failures.push(`${file}: ${JSON.stringify(problems[0])}`);
      } catch (error) {
        failures.push(`${file}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 600_000);
});
