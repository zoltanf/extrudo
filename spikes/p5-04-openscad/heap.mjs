// Heap and instance-reuse costs of the upstream snapshot build in Node.
// node heap.mjs
import { readFileSync } from 'node:fs';
import OpenSCAD from './snap/openscad.js';

const bytes = readFileSync('snap/openscad.wasm');
let t = performance.now();
const compiled = await WebAssembly.compile(bytes);
console.log('compile ms', (performance.now() - t).toFixed(0));

let memory;
async function instance(keep) {
  const err = [];
  const mod = await OpenSCAD({
    noInitialRun: true,
    noExitRuntime: keep,
    print: () => {},
    printErr: (s) => err.push(s),
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(compiled, imports).then((inst) => {
        memory = Object.values(inst.exports).find((e) => e instanceof WebAssembly.Memory);
        receive(inst, compiled);
      });
      return {};
    },
  });
  return { mod, err };
}

const src = (i) =>
  `difference(){ cube([20+${i},20,10]); for(k=[0:9]) translate([2+k*2,10,-1]) cylinder(d=1.5,h=12,$fn=${16 + i}); }`;

t = performance.now();
const first = await instance(true);
console.log('instantiate (compiled) ms', (performance.now() - t).toFixed(0), 'memory MB', memory.buffer.byteLength / 2 ** 20);
const runOne = (mod, i) => {
  mod.FS.writeFile('/in.scad', src(i));
  const t0 = performance.now();
  const code = mod.callMain(['/in.scad', '-o', '/o.stl', '--backend=manifold', '--export-format=binstl']);
  const ms = performance.now() - t0;
  mod.FS.unlink('/o.stl');
  return { code, ms };
};
const reuse = [];
for (let i = 0; i < 50; i++) reuse.push(runOne(first.mod, i));
console.log(
  'reuse 50 distinct: median ms',
  reuse.map((r) => r.ms).sort((a, b) => a - b)[25].toFixed(1),
  'codes',
  [...new Set(reuse.map((r) => r.code))],
  'memory MB',
  memory.buffer.byteLength / 2 ** 20,
);

const fresh = [];
let mem = [];
for (let i = 0; i < 50; i++) {
  const t0 = performance.now();
  const { mod } = await instance(false);
  const r = runOne(mod, i);
  fresh.push(performance.now() - t0);
  mem.push(memory.buffer.byteLength / 2 ** 20);
  if (i === 0) console.log('fresh first code', r.code);
}
global.gc?.();
console.log(
  'fresh 50: median total ms',
  fresh.sort((a, b) => a - b)[25].toFixed(1),
  'memory per instance MB max',
  Math.max(...mem),
  'process rss MB',
  (process.memoryUsage().rss / 2 ** 20).toFixed(0),
);
