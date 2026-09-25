// Compares planegcs builds on the single-system cases:
// `node src/node/compare.ts growth modern` → results/compare.json
import { writeFileSync } from 'node:fs';
import { init_planegcs_module } from '@salusoft89/planegcs';
import { benchSize } from '../bench-core.ts';

const builds = process.argv.slice(2);
const load = async (build: string) =>
  build === 'npm'
    ? init_planegcs_module()
    : (await import(new URL(`../../builds/${build}/planegcs.js`, import.meta.url).href)).default();
const cases = [
  [99, 'anchored'],
  [198, 'anchored'],
  [99, 'chained'],
  [198, 'chained'],
] as const;
const f = (n: number) => n.toFixed(1);
const out: unknown[] = [];
for (const build of builds) {
  benchSize(await load(build), 50, 'coincident', 'chained', 30); // warm-up
  for (const [size, layout] of cases) {
    const r = benchSize(await load(build), size, 'coincident', layout);
    out.push({ solverBuild: build, ...r });
    console.log(
      `${build.padEnd(7)} ${layout.padEnd(8)} ${r.entities}: first ${f(r.firstSolve)} | drag ${f(r.drag.median)} | param ${f(r.paramChange.median)} | noop ${f(r.noopSolve.median)}`,
    );
  }
}
writeFileSync(new URL('../../results/compare.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
