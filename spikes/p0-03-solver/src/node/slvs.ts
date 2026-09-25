// SolveSpace comparison: `node src/node/slvs.ts [sizes…]` → results/slvs.json
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { benchSlvs, buildSlvs } from '../slvs-bench.ts';

const require = createRequire(import.meta.url);
const factory = require('slvs');
const wasm = require.resolve('slvs').replace(/slvs\.js$/, 'slvs.js-3.wasm');
const s = await factory({ locateFile: () => wasm });

// Sanity: fully constrained → DOF 0; conflict reported.
buildSlvs(s, 18, 'chained');
console.log('sanity', s.solveSketch(2, true));
const sizes = process.argv.slice(2).map(Number);
const results = [];
for (const layout of ['anchored', 'chained'] as const) {
  for (const size of sizes.length ? sizes : [50, 100, 200, 500]) {
    const r = benchSlvs(s, size, layout);
    results.push(r);
    console.log(JSON.stringify(r));
  }
}
writeFileSync(new URL('../../results/slvs.json', import.meta.url), `${JSON.stringify(results, null, 2)}\n`);
