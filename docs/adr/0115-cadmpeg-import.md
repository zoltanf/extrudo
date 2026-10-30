# ADR-0115: Native CAD import through a bundled cadmpeg

- **Status:** Accepted, 2026-10-30 (owner asked for the assessment after issue
  #141 and chose bundling over PATH detection and download-on-first-use).
- **Task:** P6-19, FR-IO-01 (import).
- **Builds on:** ADR-0062's P6-02 amendment (an external program found per OS,
  a temp file, `Platform.openInSlicer`), ADR-0075 (the Electron app, IPC
  channels, preferences main reads, `extraResources`), ADR-0101 (the Blender
  service: a program run from main with a timeout and capped output),
  ADR-0066 (STEP import, attachments, the storage budget), ADR-0084 (f3d
  import stays ours).
- **Schema change:** none. The design stores the converted STEP as an
  attachment, exactly as a STEP import does today.

## Context

Import takes STEP, STL, 3MF, OBJ, SCAD and f3d (ADR-0066, ADR-0084). Issue
#141 asks for the native formats of other CAD programs. Writing those readers
ourselves is out of the question; **cadmpeg** (<https://github.com/cadmpeg/cadmpeg>,
Apache-2.0 code, CC-BY-4.0 docs, a clean-room `LEGAL.md`) is a Rust command
line tool that reads them and writes STEP: `cadmpeg convert in.sldprt -o out.step`.
Its support ladder (checked for v0.6.7, released 2026-10-28): `.ipt`/`.iam`,
`.sat`/`.smt`/`.smb`/`.sab`, `.sldprt`, `.CATPart` and `.pvz` at L3 (a connected
B-rep, no colours or names), `.FCStd` at L5, IGES at L9; `.3dm` is L2 and the
NX/Creo `.prt` L1, both unusable. STEP and f3d stay on our own importers.

cadmpeg has no WASM build and no JavaScript bindings: it is a process, so the
browser can't run it. The binaries are pure Rust (only `linux-raw-sys` /
`windows-sys` as platform crates), prebuilt by cargo-dist for
`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-apple-darwin`,
`aarch64-apple-darwin` and `x86_64-pc-windows-msvc`, 21–43 MB compressed each,
with a `sha256.sum` beside them. Apache-2.0 is already on
`scripts/check-licenses.mjs`'s allow-list and compatible with our GPL-3.0.

cadmpeg's own documentation names the vendor of the `.f3d` format. Our rule
stands: nothing in this repository names that vendor or its products; the
formats are named by extension only.

## Decision

### 1. Desktop only, converted before import

The desktop app bundles cadmpeg and converts a native file to STEP **before**
the normal import: the renderer calls a new optional platform seam

```ts
Platform.convertCad?: (file: { name: string; bytes: Uint8Array }) =>
  Promise<{ ok: true; name: string; bytes: Uint8Array } | { ok: false; message: string }>;
```

(`apps/web/src/platform/index.ts`, beside `render` and `openInSlicer`). When
the seam exists, `IMPORT_ACCEPT` (`apps/web/src/features/import.ts`) also
offers `.sldprt .ipt .iam .catpart .fcstd .sat .smt .smb .sab .igs .iges .pvz`,
labelled **Other CAD files**. `pickImportFile` converts such a file first (a
toast "Converting *name*…"), then continues the STEP path with the returned
bytes: the attachment is `<base>.step`, media type `model/step`, and the
imported feature is a STEP import. The design never holds the native file, so
the file format doesn't change and the browser opens such a design as any
other. The browser's import dialog keeps refusing the formats; its message adds
that the desktop app imports them.

After a conversion the app says once that the result is a B-rep only: no
colours, names, history or sketches (cadmpeg's L3).

### 2. The service in main

`apps/desktop/src/main/cadmpeg.ts` is pure over an injected environment
(platform, file existence, spawn, temp directory, override path), like
`slicers.ts`; `cadmpegService.ts` wires Node in and gives `status()` (found or
not, version, path) and `convert(file)`. IPC channels `extrudo:cad:status`
and `extrudo:cad:convert` (`shared/ipc.ts`, preload, `main/ipc.ts`), wired
in `main/index.ts` like `nodeSlicerService`. The binary is looked up in this
order: the preference `cadmpeg.path` → the packaged
`process.resourcesPath/cadmpeg/cadmpeg[.exe]` → the dev checkout's
`apps/desktop/vendor/cadmpeg/cadmpeg[.exe]` → `cadmpeg` on `PATH`.

A conversion writes the input to `<temp>/extrudo-cadmpeg/<uuid>/<name>` (mode
0700), spawns `cadmpeg convert <name> -o <base>.step` without a shell with that
directory as `cwd`, kills it after 120 s, caps stdout and stderr at 64 KiB
each, refuses inputs over 100 MiB and outputs over 100 MiB, and removes the
directory afterwards (and leftovers on quit, as the slicer temp files). A
non-zero exit shows the last line of stderr. `--allow-errors` is **not**
passed: when cadmpeg's own check refuses the output, so do we.

### 3. Pinned, fetched at build time, verified

`apps/desktop/cadmpeg.json` pins the version and the SHA-256 of every
target's archive, copied from the release's `sha256.sum`.
`apps/desktop/scripts/fetch-cadmpeg.mjs` downloads the archive for the host
(or `--target <triple>`), verifies the hash and refuses on a mismatch, and
extracts `cadmpeg[.exe]` and `LICENSE` into `apps/desktop/vendor/cadmpeg/`
(gitignored). `electron-builder.yml` ships that folder as
`extraResources` → `resources/cadmpeg/`; the `package*` scripts and the desktop
workflow's package jobs run the fetch first. On macOS the ad-hoc signature must
cover the extra binary (checked with `codesign -dv` in the mac job); the smoke
steps run `cadmpeg --version` from the packaged resources. The installers grow
by the binary's size (about 21–43 MB compressed). Measured on S1's desktop run
(41020007841) against v0.9.0, in MiB: the AppImage 134.7 → 175.7 (+41), the mac
arm64 dmg 135.9 → 171.4 (+35.5), the Windows x64 installer 117.5 → 144.6 (+27).

Updating cadmpeg is a release-checklist step: bump the version and hashes in
`cadmpeg.json`, nothing else.

### 4. Licensing and docs

`NOTICE` section 4 (components the packaged app redistributes) lists cadmpeg
with its version and Apache-2.0, and the shipped `LICENSE` sits at
`resources/cadmpeg/LICENSE`. `docs/references.md` gets a cadmpeg entry;
`docs/desktop.md` a section "Other CAD files" (the formats, the fidelity
limits, the `cadmpeg.path` preference for a different build).

## Rejected

- **A WASM build of cadmpeg in the browser.** No bindings exist; building and
  maintaining one is a project of its own, and the browser would pay 20+ MB
  for a rarely used importer.
- **Detecting cadmpeg on `PATH` only.** Nobody has it installed; the feature
  would be invisible. `PATH` stays as the last fallback and `cadmpeg.path` as
  the override.
- **Downloading on first use.** Needs network at import time, a verification
  story in the app and a place to put the file; the installer size is the
  smaller cost.
- **Storing the native file in the design.** A file-format change for a file
  the app can't read without cadmpeg; the STEP is what the design uses.
