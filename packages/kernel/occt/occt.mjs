#!/usr/bin/env node
// Builds, publishes and fetches Extrudo's OCCT WASM (packages/kernel/occt/dist).
//
// The build needs Docker and takes about 10 minutes, so it is keyed by a hash of
// its inputs (the config, the C++ facade and the toolchain version). CI builds
// each new hash once and publishes dist/ as a GitHub release asset tagged
// `occt-<hash>`. Everyone else downloads it (scripts/wasm-release.mjs).
//
//   node occt.mjs hash      print the input hash
//   node occt.mjs ensure    make dist/ match the inputs: no-op, else download
//   node occt.mjs fetch     download the release for the current hash
//   node occt.mjs build     build locally with Docker (+ libcascade assemble)
//   node occt.mjs check     fail if src/ uses an OCCT symbol the build doesn't bind
//   node occt.mjs publish   upload dist/ as the release for the current hash (CI)
//   node occt.mjs exists    exit 0 if that release exists, 1 if not (CI)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesIn, run, wasmRelease } from '../../../scripts/wasm-release.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KERNEL = join(HERE, '..');
const BIN = join(KERNEL, 'node_modules', '.bin', 'libcascade');
const toolchain = JSON.parse(readFileSync(join(KERNEL, 'package.json'), 'utf8')).devDependencies[
  '@libcascade/toolchain'
];

await wasmRelease({
  name: 'occt',
  label: 'OCCT WASM',
  dir: HERE,
  inputs: [join(HERE, 'libcascade.config.ts'), ...filesIn(join(HERE, 'facade'))],
  salt: `toolchain ${toolchain}\n`,
  build: () => {
    run(BIN, ['build'], { cwd: HERE });
    run(BIN, ['assemble'], { cwd: HERE });
  },
  notes:
    'Extrudo OCCT WASM, built by CI from packages/kernel/occt at input hash {hash}. ' +
    'Downloaded by `pnpm occt ensure`. OCCT and the facade are LGPL-2.1-or-later.',
  buildHint: 'pnpm occt build',
  commands: {
    check: () =>
      run(BIN, ['check', join(KERNEL, 'src'), '--config', join(HERE, 'libcascade.config.ts')]),
  },
});
