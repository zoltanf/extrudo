// The compiler worker: one OpenSCAD instance per compile, the WASM compiled once.
import OpenSCAD from './openscad.js';
const tFetch = performance.now();
const modulePromise = WebAssembly.compileStreaming(fetch('./openscad.wasm'));
let compiledMs;
modulePromise.then(() => { compiledMs = performance.now() - tFetch; });
onmessage = async (e) => {
  const { id, source } = e.data;
  const module = await modulePromise;
  const t0 = performance.now();
  const err = [];
  let memory;
  const mod = await OpenSCAD({
    noInitialRun: true,
    print: () => {},
    printErr: (s) => err.push(s),
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(module, imports).then((inst) => {
        memory = Object.values(inst.exports).find((x) => x instanceof WebAssembly.Memory);
        receive(inst, module);
      });
      return {};
    },
  });
  const tInst = performance.now() - t0;
  mod.FS.writeFile('/in.scad', source);
  const t1 = performance.now();
  let code;
  try { code = mod.callMain(['/in.scad', '-o', '/o.stl', '--backend=manifold', '--export-format=binstl']); }
  catch (x) { code = String(x); }
  const run = performance.now() - t1;
  let bytes = 0;
  try { bytes = mod.FS.readFile('/o.stl').length; } catch {}
  postMessage({ id, code, compiledMs, instantiateMs: tInst, runMs: run, bytes, memoryMB: (mod.HEAP8 ?? memory?.buffer)?.byteLength / 2 ** 20, err: err.slice(-3) });
};
