**Title:** bug: delete() does not release memory owned by the C++ object (NCollection_Array1, BRepAlgoAPI_Cut, BRepFilletAPI_MakeFillet)

**Body** (structured like the repo's "Bug report" form; blank issues are disabled there, so
filing via `gh issue create --body-file` needs these headings):

### Package or image version

`libcascade@3.0.2` (`libcascade/single/init`). Also seen on a custom build made with
`@libcascade/toolchain@3.0.2` (image `ghcr.io/taucad/opencascade.js:3.0.2-single-threaded`).

### Runtime

Node.js (v26.10.0, Linux x86-64). Same behaviour in a Chromium 153 Web Worker.

### Minimal reproduction

```js
// repro.mjs — `npm i libcascade@3.0.2 && node repro.mjs`
import { createInstance } from 'libcascade/single/init';

// Each case gets a fresh instance so earlier cases can't mask later ones.
let oc;
const run = async (label, n, fn) => {
  oc = await createInstance();
  const heapMB = () => oc.wasmMemory.buffer.byteLength / 2 ** 20;
  const before = heapMB();
  for (let i = 0; i < n; i++) fn();
  console.log(`${label.padEnd(46)} heap ${before} → ${heapMB()} MB`);
};

// Control: the allocator reuses a freed 2.4 MB block.
await run('malloc/free 2.4 MB ×300', 300, () => oc._emscripten_builtin_free(oc._emscripten_builtin_malloc(2_400_000)));

// 1. NCollection_Array1: the 2.4 MB buffer is never freed.
await run('Array1<gp_Pnt>(1, 100000) + delete() ×300', 300, () => new oc.NCollection_Array1_gp_Pnt(1, 100_000).delete());
await run('same, Resize(1, 1, false) before delete() ×300', 300, () => {
  const a = new oc.NCollection_Array1_gp_Pnt(1, 100_000);
  a.Resize(1, 1, false);
  a.delete();
});

// 2. BRepAlgoAPI_Cut: leaks unless Clear() is called before delete().
const cut = (clear) => () => {
  const mb = new oc.BRepPrimAPI_MakeBox(40, 30, 20);
  const box = mb.Shape();
  const p = new oc.gp_Pnt(20, 15, -1);
  const d = new oc.gp_Dir(0, 0, 1);
  const ax = new oc.gp_Ax2(p, d);
  const mc = new oc.BRepPrimAPI_MakeCylinder(ax, 4, 22);
  const cyl = mc.Shape();
  const pr = new oc.Message_ProgressRange();
  const c = new oc.BRepAlgoAPI_Cut(box, cyl, pr);
  c.Shape().delete();
  if (clear) c.Clear();
  for (const o of [c, pr, cyl, mc, ax, d, p, box, mb]) o.delete();
};
await run('BRepAlgoAPI_Cut + delete() ×2000', 2000, cut(false));
await run('BRepAlgoAPI_Cut + Clear() + delete() ×2000', 2000, cut(true));
```

### Expected behavior

`delete()` (or `[Symbol.dispose]()`) runs the C++ destructor, which releases what the
object owns, so a create/delete loop keeps the WASM heap flat, as the `Resize` and `Clear`
variants do.

### Actual behavior and logs

```
malloc/free 2.4 MB ×300                        heap 128 → 128 MB
Array1<gp_Pnt>(1, 100000) + delete() ×300      heap 128 → 1391.875 MB
same, Resize(1, 1, false) before delete() ×300 heap 128 → 128 MB
BRepAlgoAPI_Cut + delete() ×2000               heap 128 → 382.375 MB
BRepAlgoAPI_Cut + Clear() + delete() ×2000     heap 128 → 128 MB
```

Memory owned by the C++ object is not released by `delete()`. Releasing it from C++ first
(`Resize`, `Clear`) keeps the heap flat, so the allocator reuses memory fine.

Other classes we measured the same way:

- `BRepFilletAPI_MakeFillet`: about 10 KB per object after construct + `Add()` on a box
  edge, about 30 KB after `Build()`. `Reset()` before `delete()` does not help.
- On the custom toolchain build, `BRepPrimAPI_MakeBox` also leaks the box's topology
  (about 8 KB) once `Build()` or `Shape()` has run. The same loop on the prebuilt package
  showed no growth over 12 000 iterations, so the behaviour seems to vary by class and build.
- Deleting the shapes returned by `Shape()` makes no difference.

For comparison, the same box → fillet → cut → mesh loop through a C++ wrapper around OCCT
8.0.1 (occt-wasm 5.3.5, which owns the builders in C++) shows no heap growth over 4000
iterations, so this doesn't look like an OCCT leak.

`tests/smoke/smoke-output-params-disposal.test.ts` checks that `[Symbol.dispose]` exists,
runs at scope exit and is idempotent, but not that memory is released. A heap-growth loop
like the one above might make a useful regression test. Happy to test a fix or provide more
cases.
