# @extrudo/openscad

OpenSCAD in WebAssembly for the `import` feature (P5-04,
[ADR-0071](../../docs/adr/0071-openscad-import.md)): a `.scad` file of a design
is compiled to a 3MF, and the kernel makes mesh bodies of it.

- `dist/` is OpenSCAD's own WebAssembly snapshot (`openscad.js`,
  `openscad.wasm`), pinned by date and sha256 in `openscad.mjs`, with one patch
  to the glue (the heap limit becomes a module option). It is not in git:
  `pnpm openscad ensure` (part of `pnpm wasm`) downloads our mirror of it, the
  release `openscad-<hash>`, and builds it from the upstream zip when the mirror
  is missing (`pnpm openscad build`: a download, no Docker). CI's `openscad` job
  publishes the mirror.
- `src/index.ts`: the protocol's types (`ScadCompiler`, `ScadRequest`,
  `ScadResult`), which the kernel imports.
- `src/node.ts` / `src/browser.ts`: the compiler in a worker of its own
  (`worker_threads` / a nested module worker), one fresh OpenSCAD instance per
  compile, a time limit and a heap ceiling.
- `src/messages.ts`: OpenSCAD's log in the app's words.

To move to a newer snapshot: change `VERSION` and `SHA256` in `openscad.mjs`
(the zip's `.sha256` file is next to it on files.openscad.org), run
`pnpm openscad build` and the tests, and update NOTICE and the ADR's numbers.

OpenSCAD is GPL-2.0-or-later; the libraries its WASM contains are listed in
NOTICE.
