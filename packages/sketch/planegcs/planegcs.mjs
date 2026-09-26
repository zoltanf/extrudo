#!/usr/bin/env node
// Builds, publishes and fetches Extrudo's planegcs WASM (packages/sketch/planegcs/dist).
//
// Same scheme as the OCCT build (scripts/wasm-release.mjs): the build needs
// Docker, so CI builds each new input hash once (build.sh, Dockerfile, the
// patch) and publishes dist/ as the GitHub release `planegcs-<hash>`.
//
//   node planegcs.mjs hash|ensure|fetch|build|publish|exists
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, wasmRelease } from '../../../scripts/wasm-release.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

await wasmRelease({
  name: 'planegcs',
  label: 'planegcs WASM',
  dir: HERE,
  inputs: ['build.sh', 'Dockerfile', 'planegcs.patch'].map((file) => join(HERE, file)),
  build: () => run('bash', [join(HERE, 'build.sh')]),
  notes:
    'Extrudo planegcs WASM (FreeCAD PlaneGCS via Salusoft89/planegcs, patched), built by CI ' +
    'from packages/sketch/planegcs at input hash {hash}. Downloaded by `pnpm planegcs ensure`. ' +
    'LGPL-2.1-or-later; the patch is packages/sketch/planegcs/planegcs.patch.',
  buildHint: 'pnpm planegcs build',
});
