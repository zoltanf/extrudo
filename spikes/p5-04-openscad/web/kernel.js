// The "kernel worker": spawns a nested compiler worker and drives compiles.
const log = (m) => postMessage(m);
const SMALL = 'difference(){ cube([20,20,10]); translate([10,10,-1]) cylinder(d=8,h=12,$fn=64); }';
const MINK = 'minkowski(){ cube([20,20,10]); sphere(r=2,$fn=64); }';
const DIFF = 'difference(){ cube([110,110,5]); for(i=[0:9],j=[0:9]) translate([5+i*11,5+j*11,-1]) cylinder(d=6,h=7,$fn=32); }';
const LOOP = 'function f(n, a = 0) = n == 0 ? a : f(n - 1, a + 1); echo(f(1e9)); cube(1);';
let compiler;
let next = 0;
const pending = new Map();
function start() {
  compiler = new Worker('./compiler.js', { type: 'module' });
  compiler.onmessage = (e) => { pending.get(e.data.id)?.(e.data); pending.delete(e.data.id); };
  compiler.onerror = (e) => log({ compilerError: e.message });
}
function compile(source, timeoutMs = 20000) {
  const id = next++;
  const t = performance.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      compiler.terminate();
      start();
      resolve({ id, timedOut: true, ms: performance.now() - t });
    }, timeoutMs);
    pending.set(id, (r) => { clearTimeout(timer); resolve({ ...r, total: performance.now() - t }); });
    compiler.postMessage({ id, source });
  });
}
onmessage = async (e) => {
  log({ coi: e.data.crossOriginIsolated, sab: typeof SharedArrayBuffer });
  start();
  const r0 = await compile('cube(1);');
  log({ first: r0 });
  for (const [name, src] of [['small', SMALL], ['small2', SMALL], ['mink', MINK], ['diff100', DIFF]]) {
    log({ name, r: await compile(src) });
  }
  log({ name: 'loop', r: await compile(LOOP, 3000) });
  log({ name: 'after-timeout', r: await compile(SMALL) });
  log({ done: true });
};
