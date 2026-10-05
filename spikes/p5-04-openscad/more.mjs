// Fresh instance per compile: memory per model, determinism, fonts, a heap ceiling.
// node more.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import OpenSCAD from './snap/openscad.js';

const compiled = await WebAssembly.compile(readFileSync('snap/openscad.wasm'));
const patchedGlue = readFileSync('snap/openscad.js', 'utf8').replace(
  'getHeapMax=()=>4294901760',
  'getHeapMax=()=>Module["heapMax"]||4294901760',
);
const { writeFileSync } = await import('node:fs');
writeFileSync('/tmp/p5-04/openscad-patched.mjs', patchedGlue);
const Patched = (await import('/tmp/p5-04/openscad-patched.mjs')).default;

async function compile(source, { files = {}, args = [], heapMax, glue = OpenSCAD, env } = {}) {
  const err = [];
  let memory;
  const mod = await glue({
    noInitialRun: true,
    heapMax,
    print: (s) => err.push(s),
    printErr: (s) => err.push(s),
    preRun: [(m) => env && Object.assign(m.ENV, env)],
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(compiled, imports).then((inst) => {
        memory = Object.values(inst.exports).find((x) => x instanceof WebAssembly.Memory);
        receive(inst, compiled);
      });
      return {};
    },
  });
  for (const [path, data] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir) mod.FS.mkdirTree(dir);
    mod.FS.writeFile(path, data);
  }
  mod.FS.writeFile('/in.scad', source);
  const t = performance.now();
  let code;
  try {
    code = mod.callMain(['/in.scad', '-o', '/o.stl', '--backend=manifold', '--export-format=binstl', ...args]);
  } catch (e) {
    code = `threw ${e?.message ?? e}`;
  }
  const ms = performance.now() - t;
  let bytes;
  try {
    bytes = mod.FS.readFile('/o.stl');
  } catch {}
  return {
    code,
    ms: Math.round(ms),
    mb: memory ? memory.buffer.byteLength / 2 ** 20 : undefined,
    sha: bytes ? createHash('sha256').update(bytes).digest('hex').slice(0, 12) : 'none',
    size: bytes?.length,
    err: err.filter((l) => !/localization|Geometr|cache|rendering time|Top level|Convex|Facets|Vertices|Genus|Volumes|Simple|^\s*$/.test(l)),
  };
}

const MINK = 'minkowski(){ cube([20,20,10]); sphere(r=2,$fn=64); }';
const DIFF = 'difference(){ cube([110,110,5]); for(i=[0:9],j=[0:9]) translate([5+i*11,5+j*11,-1]) cylinder(d=6,h=7,$fn=32); }';
const HUGE = 'minkowski(){ sphere(20,$fn=300); rotate([10,20,30]) cube(10,center=true); } ';
for (const [name, src] of [['mink', MINK], ['diff100', DIFF], ['huge', HUGE]]) {
  const a = await compile(src);
  const b = await compile(src);
  console.log(name, a.code, a.ms, 'ms', a.mb, 'MB', a.size, 'bytes', 'same twice:', a.sha === b.sha);
}
console.log('ceiling 64 MB', await compile(HUGE, { glue: Patched, heapMax: 64 * 2 ** 20 }));

const font = readFileSync('../../packages/fonts/fonts/inter-regular.ttf');
const conf = `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/fonts</dir><cachedir>/tmp/fc</cachedir></fontconfig>`;
console.log(
  'text',
  await compile('linear_extrude(2) text("Hi", font="Inter");', {
    files: { '/fonts/inter.ttf': font, '/fonts/fonts.conf': conf },
    env: { FONTCONFIG_FILE: '/fonts/fonts.conf' },
  }),
);
console.log(
  'use lib',
  await compile('use <lib/part.scad>\npart(3);', { files: { '/lib/part.scad': 'module part(s) cube(s);' } }),
);
console.log('-D', await compile('w = 10; cube(w);', { args: ['-D', 'w=25'] }));
console.log('-D bad', await compile('w = 10; cube(w);', { args: ['-D', 'w=)'] }));
console.log('-D unknown', await compile('w = 10; cube(w);', { args: ['-D', 'zz=3'] }));
console.log('two solids', await compile('cube(5); translate([10,0,0]) cube(5);'));
console.log('mixed 2d+3d', await compile('cube(5); translate([10,0,0]) square(5);'));
console.log('warnings', await compile('echo("a"); echo("b"); x = [1][5]; cube(1); y = 1/0; rotate(undef) cube(2);'));
console.log('error rt', await compile('module m() { undefined_thing(); } m(); cube(1);'));
console.log('import stl', await compile('import("part.stl");', { files: { '/part.stl': readFileSync('../../fixtures/imports/cube.stl') } }));
