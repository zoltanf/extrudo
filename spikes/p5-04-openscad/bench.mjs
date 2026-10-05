// P5-04 spike: load each OpenSCAD WASM build in Node and measure.
// node bench.mjs <pre|ow|snap|snapnode> [test...]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const which = process.argv[2] ?? 'snap';
const out = [];
const err = [];
const log = (...a) => console.log(`[${which}]`, ...a);

async function make() {
  const t0 = performance.now();
  let mod;
  const base = {
    noInitialRun: true,
    noExitRuntime: process.env.KEEP === "1",
    print: (t) => out.push(t),
    printErr: (t) => err.push(t),
  };
  if (which === 'pre') {
    const { createOpenSCAD } = await import('./pre/package/dist/openscad.js');
    mod = (await createOpenSCAD(base)).getInstance();
  } else if (which === 'ow') {
    const { createOpenSCAD } = await import('./ow/package/openscad.js');
    mod = (await createOpenSCAD(base)).getInstance();
  } else if (which === 'snap') {
    const OpenSCAD = (await import('./snap/openscad.js')).default;
    mod = await OpenSCAD({ ...base, wasmBinary: readFileSync('snap/openscad.wasm') });
  } else {
    const OpenSCAD = (await import('./snapnode/openscad.js')).default;
    mod = await OpenSCAD(base);
  }
  return { mod, ms: performance.now() - t0 };
}

function run(mod, source, args = [], output = '/out.stl') {
  out.length = 0;
  err.length = 0;
  mod.FS.writeFile('/in.scad', source);
  const t0 = performance.now();
  let code;
  try {
    code = mod.callMain(['/in.scad', '-o', output, ...args]);
  } catch (e) {
    code = `threw ${e?.message ?? e}`;
  }
  const ms = performance.now() - t0;
  let bytes;
  try {
    bytes = mod.FS.readFile(output);
    mod.FS.unlink(output);
  } catch {}
  return { code, ms, bytes, out: [...out], err: [...err] };
}

const SMALL = 'difference(){ cube([20,20,10]); translate([10,10,-1]) cylinder(d=8,h=12,$fn=64); }';
const HEAVY_MINK = 'minkowski(){ cube([20,20,10]); sphere(r=2,$fn=64); }';
const HEAVY_DIFF =
  'difference(){ cube([110,110,5]); for(i=[0:9],j=[0:9]) translate([5+i*11,5+j*11,-1]) cylinder(d=6,h=7,$fn=32); }';

const { mod, ms } = await make();
log('instantiate ms', ms.toFixed(0));
const heap = () => (mod.HEAP8?.length ?? mod.HEAPU8?.length ?? mod.wasmExports?.memory?.buffer.byteLength ?? Object.keys(mod).filter(k=>/HEAP|mem/i.test(k)).join(','));
log('heap after init', heap());

const tests = process.argv.slice(3);
const want = (t) => tests.length === 0 || tests.includes(t);
const sha = (b) => (b ? createHash('sha256').update(b).digest('hex').slice(0, 12) : 'none');

if (want('version')) {
  const r = run(mod, '', ['--version']);
  log('version', r.code, r.out.join('|'), r.err.join('|'));
}
for (const backend of ['manifold', 'cgal']) {
  if (!want(backend)) continue;
  const flag = which === 'snap' || which === 'snapnode' ? [`--backend=${backend}`] : backend === 'manifold' ? ['--enable=manifold'] : [];
  for (const [name, src] of [
    ['small', SMALL],
    ['mink', HEAVY_MINK],
    ['diff100', HEAVY_DIFF],
  ]) {
    const r = run(mod, src, [...flag, '--export-format=binstl']);
    log(backend, name, 'code', r.code, 'ms', r.ms.toFixed(0), 'bytes', r.bytes?.length, sha(r.bytes), 'heap', heap());
    if (r.code !== 0) log(r.err.slice(-4).join(' | '));
  }
}
if (want('repeat')) {
  const flag = which.startsWith('snap') ? ['--backend=manifold'] : ['--enable=manifold'];
  const shas = new Set();
  const times = [];
  for (let i = 0; i < 50; i++) {
    const r = run(mod, SMALL, [...flag, '--export-format=binstl']);
    shas.add(sha(r.bytes));
    times.push(r.ms);
    if (r.code !== 0) {
      log('repeat failed at', i, r.code, r.err.slice(-3));
      break;
    }
  }
  log('repeat 50', 'distinct outputs', shas.size, 'median ms', times.sort((a, b) => a - b)[25]?.toFixed(1), 'heap', heap());
}
if (want('errors')) {
  const flag = which.startsWith('snap') ? ['--backend=manifold'] : ['--enable=manifold'];
  for (const [name, src] of [
    ['syntax', 'cube(10);\n\ntranslate([1,2,3) sphere(2);\n'],
    ['2d', 'square(10);'],
    ['empty', '// nothing\n'],
    ['echo', 'echo("hello", 1+2); x = undef + 1; cube(1);'],
    ['include', 'include <MCAD/gears.scad>\ncube(1);'],
    ['use', 'use <missing.scad>\ncube(1);'],
    ['import', 'import("part.stl");'],
    ['text', 'linear_extrude(2) text("Hi");'],
    ['assert', 'assert(false, "too thin"); cube(1);'],
  ]) {
    const r = run(mod, src, flag);
    log(name, 'code', r.code, 'bytes', r.bytes?.length ?? 0);
    log('   out:', r.out.join(' | ').slice(0, 300));
    log('   err:', r.err.join(' | ').slice(0, 600));
  }
}
if (want('params')) {
  const src = `// a box
width = 20; // [10:100]
height = 10; // [5:1:50]
label = "x";
/* [Holes] */
hole = 6;
cube([width, width, height]);
`;
  const r = run(mod, src, [], '/out.param');
  log('param export', r.code, r.bytes ? new TextDecoder().decode(r.bytes).slice(0, 1500) : r.err.join('|'));
  const r2 = run(mod, src, ['-D', 'width=40', '-D', 'height=5', '--export-format=binstl']);
  log('-D', r2.code, r2.bytes?.length, r2.err.slice(-2).join('|'));
  const r3 = run(mod, src, ['-o', '/x.json', '--export-format=param']);
  log('param json', r3.code, r3.err.slice(-3).join('|'));
}
if (want('formats')) {
  const src = 'color("red") cube(10); color("blue") translate([20,0,0]) sphere(5,$fn=24);';
  for (const [ext, extra] of [['stl', []], ['off', []], ['3mf', []], ['obj', []]]) {
    const r = run(mod, src, ['--backend=manifold', ...extra], `/out.${ext}`);
    log('format', ext, r.code, r.bytes?.length, r.err.slice(-2).join('|'));
    if (r.bytes) writeFileSync(`/tmp/p5-04/out-${which}.${ext}`, r.bytes);
  }
}
