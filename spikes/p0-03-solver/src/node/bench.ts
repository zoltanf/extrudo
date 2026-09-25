// Node benchmark: `[BUILD=growth] node src/node/bench.ts` → results/node-<build>.json
// BUILD=npm (default) uses the published @salusoft89/planegcs WASM; any other
// value loads builds/<BUILD>/planegcs.js (our own builds, see README).
import { writeFileSync } from 'node:fs';
import { init_planegcs_module } from '@salusoft89/planegcs';
import { benchAll } from '../bench-core.ts';

const build = process.env.BUILD ?? 'npm';
const init =
  build === 'npm'
    ? () => init_planegcs_module()
    : async () => {
        const glue = await import(new URL(`../../builds/${build}/planegcs.js`, import.meta.url).href);
        return glue.default();
      };
const t0 = performance.now();
const mod = await init();
const initMs = performance.now() - t0;
const heapMB = mod.HEAP8.length / 2 ** 20;
const f = (n: number) => n.toFixed(2);
console.log(`build ${build}: init ${f(initMs)} ms, initial heap ${heapMB} MB`);
const results = await benchAll(init, (r) => {
  if ('error' in r) {
    console.log(`${r.layout} ${r.join} ${r.entities}: ${r.error}`);
    return;
  }
  console.log(
    `${r.layout} ${r.join.padEnd(10)} ${String(r.entities).padStart(3)} ent (${r.params} unknowns): build ${f(r.build)} first ${f(r.firstSolve)} (st ${r.firstStatus}, dof ${r.dof}) apply ${f(r.apply)} | noop ${f(r.noopSolve.median)} | param ${f(r.paramChange.median)}/${f(r.paramChange.p95)} | drag ${f(r.drag.median)}/${f(r.drag.p95)}/${f(r.drag.max)} (dof ${r.dragDof}) rebuild ${f(r.dragRebuild.median)} | conflict ${f(r.conflict.solve)} st ${r.conflict.status} n=${r.conflict.reported} culprit=${r.conflict.includesCulprit} | DL ${f(r.algorithms.DogLeg.ms)} LM ${f(r.algorithms.LevenbergMarquardt.ms)}(${r.algorithms.LevenbergMarquardt.status}) BFGS ${f(r.algorithms.BFGS.ms)}(${r.algorithms.BFGS.status})`,
  );
});
const out = { runtime: `Node ${process.version}`, build, initMs, heapMB, results };
writeFileSync(
  new URL(`../../results/node-${build}.json`, import.meta.url),
  `${JSON.stringify(out, null, 2)}\n`,
);
