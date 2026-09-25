// Per-component solving: `[BUILD=growth] node src/node/components.ts` → results/components-<build>.json
import { writeFileSync } from 'node:fs';
import { init_planegcs_module } from '@salusoft89/planegcs';
import { benchComponents, SIZES } from '../bench-core.ts';
import { splitComponents } from '../components.ts';

const build = process.env.BUILD ?? 'npm';
const init =
  build === 'npm'
    ? () => init_planegcs_module()
    : async () => (await import(new URL(`../../builds/${build}/planegcs.js`, import.meta.url).href)).default();
const f = (n: number) => n.toFixed(2);
benchComponents(await init(), 50, 'coincident', splitComponents); // warm-up
const results = [];
for (const join of ['coincident', 'shared'] as const) {
  for (const size of SIZES) {
    const r = benchComponents(await init(), size, join, splitComponents);
    results.push(r);
    console.log(
      `${join.padEnd(10)} ${String(r.entities).padStart(3)} ent: ${r.components} components (largest ${r.largestUnknowns} unknowns) | open ${f(r.firstSolveAll)} | drag ${f(r.drag.median)}/${f(r.drag.p95)} | constraint edit ${f(r.constraintEdit.median)} | param (all) ${f(r.paramChange.median)}/${f(r.paramChange.p95)}`,
    );
  }
}
writeFileSync(new URL(`../../results/components-${build}.json`, import.meta.url), `${JSON.stringify({ build, results }, null, 2)}\n`);
