# Extrudo

Open-source parametric CAD for the 3D-printing community, running in your
browser. Sketch a profile, extrude it into a solid, round the edges, and
change one number to update the whole part. The workflow follows Fusion 360
(sketch → features → timeline, parameters everywhere) with a friendlier,
faster interface.

> **Status:** early development (Phase 0). Nothing is usable yet. See
> [`docs/03-roadmap.md`](docs/03-roadmap.md).

## Development

Requires Node 24+ and pnpm 12 (`mise use -g pnpm@12`, or see pnpm.io).

```sh
pnpm install
pnpm dev          # start the app at http://localhost:5173
pnpm check        # typecheck + lint + package boundaries + unit tests
pnpm e2e:install  # once: download Playwright's Chromium
pnpm e2e          # build and run end-to-end tests
pnpm format       # auto-format and fix lint issues
```

## Repository layout

| Path | What |
|---|---|
| `apps/web` | The web app (React + Vite). The desktop build will wrap it. |
| `packages/core` | Document model, parameters, expressions, undo. No DOM, no WASM. |
| `packages/sketch` | Sketch model, constraint solver adapter, profiles, SVG/DXF export |
| `packages/kernel` | Geometry kernel (OpenCascade WASM) in a Web Worker |
| `packages/io` | File-format readers and writers (MIT-licensed) |
| `packages/storage` | Local project storage (OPFS + IndexedDB) |
| `e2e/` | Playwright end-to-end tests |
| `docs/` | Requirements, architecture, roadmap, UI spec, brand |

## License

Extrudo is licensed under the [GNU GPL v3.0 or later](LICENSE).
`packages/io` and the file-format specification are MIT-licensed, so other
tools can read and write Extrudo files.
