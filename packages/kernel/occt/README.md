# Extrudo's OCCT WASM

Our own trimmed OpenCascade build, with a small C++ facade compiled into it.
The decision and its measurements are in
[ADR-0001](../../../docs/adr/0001-geometry-kernel.md).

| Path | What |
|---|---|
| `libcascade.config.ts` | Build config for `@libcascade/toolchain`: the bound OCCT classes, the facade, emcc settings. |
| `facade/extrudo_facade.cpp` | The facade (LGPL-2.1-or-later, see `facade/LICENSE`). It owns OCCT memory: shapes sit in an arena behind integer handles, builders live on the C++ stack, and results, history and meshes come back as flat arrays. |
| `closure.mjs` | Prints the base classes and referenced types the binding list needs (`node closure.mjs --refs`). `libcascade check` does not catch these. |
| `occt.mjs` | Build, publish and download (below). Run it as `pnpm occt <command>` from the repo root. |
| `dist/` | The build output (gitignored): `extrudo_occt_single.{js,wasm,d.ts}` and the `init.js` loader. |

## Getting the WASM

You normally don't build it. `pnpm check`, `pnpm dev` and `pnpm build` run
`pnpm occt ensure`, which compares `dist/.inputs-hash` with a hash of the inputs
(the config, everything in `facade/`, the toolchain version) and, if they
differ, downloads the matching build from the GitHub release `occt-<hash>`. It
uses `gh` when installed (needed while the repo is private) and a plain HTTPS
download otherwise.

CI publishes that release: the `occt` job in `.github/workflows/ci.yml` builds
each new input hash once and uploads `dist/` as `extrudo-occt-<hash>.tar.gz`.

## Changing the build

Edit the config or the facade, then build locally to try it:

```sh
pnpm occt build     # Docker + the pinned 2.4 GB image; about 10 minutes
pnpm occt check     # every OCCT symbol used in src/ is bound
```

A plain `em++ -fsyntax-only` inside the image checks the facade in seconds, which
beats waiting for a full build to find a typo:

```sh
docker run --rm -v "$PWD/facade:/f:ro" --entrypoint sh ghcr.io/taucad/opencascade.js:<tag> \
  -c 'em++ -std=c++17 -fsyntax-only -fwasm-exceptions -I/opencascade.js/build/occt-includes /f/extrudo_facade.cpp'
```

Then push; CI builds and publishes the new hash before the tests run.

Things the builds ran into:

- The toolchain parses the facade and generates embind bindings for every class
  in it, so the file holds exactly one class (helpers are private members),
  with no overloaded method names. `const char*` returns become JS strings;
  pointers are returned as `uintptr_t` and read from `wasmMemory` in JS.
- OCCT 8 deprecates the `TopTools_*` and `TColStd_*` collection typedefs; use
  the `NCollection_*` templates directly.
- `mallinfo()` does not link in this build, so the memory probe is `sbrk(0)`
  (`heapTop()`).
- The binding list must include every base class of a bound class and the types
  its methods use (`closure.mjs`), `MODULARIZE` + `EXPORT_ES6`, and the three
  exception helpers in `EXPORTED_RUNTIME_METHODS`.

## Licensing

OCCT is LGPL-2.1 with the OCCT exception. The facade is LGPL-2.1-or-later. The
app loads the result as a separate, replaceable `.wasm`.
