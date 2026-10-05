#!/usr/bin/env node
// Fetches OpenSCAD's own WebAssembly build into packages/openscad/dist (P5-04,
// ADR-0071 §1).
//
// The build is OpenSCAD's nightly snapshot, pinned by date and sha256 below.
// files.openscad.org keeps snapshots for months, not for ever, so the pinned one
// is mirrored as our release `openscad-<hash>` through the scheme the OCCT and
// planegcs builds use (scripts/wasm-release.mjs): CI publishes it once per input
// hash and `pnpm wasm` downloads it. Our "build" is a download, a checksum and
// one patch to the glue, so `ensure` falls back to it when the release is
// missing.
//
//   node openscad.mjs hash|ensure|fetch|build|publish|exists
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, wasmRelease } from '../../scripts/wasm-release.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The snapshot: change these two together (and the ADR's numbers, if they move). */
const VERSION = '2026.10.05';
const SHA256 = 'a27c885251865aca407af68908ced454266f902cd2b59e1923e33a97c825ef3d';
const URL = `https://files.openscad.org/snapshots/OpenSCAD-${VERSION}-WebAssembly-web.zip`;

/**
 * The memory ceiling (ADR-0071 §6): the glue's heap limit is a constant 4 GB;
 * this makes it the module's `heapMax` when the caller gives one.
 */
const HEAP_MAX = ['getHeapMax=()=>4294901760', 'getHeapMax=()=>Module["heapMax"]||4294901760'];

async function build() {
  const response = await fetch(URL);
  if (!response.ok) throw new Error(`GET ${URL}: ${response.status}`);
  const zip = new Uint8Array(await response.arrayBuffer());
  const sum = createHash('sha256').update(zip).digest('hex');
  if (sum !== SHA256) throw new Error(`${URL}: sha256 ${sum}, expected ${SHA256}`);
  // `unzip` rather than a package: CI's mirror job runs this without an install.
  const tmp = join(HERE, '.unzip');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  let text;
  let wasm;
  try {
    writeFileSync(join(tmp, 'openscad.zip'), zip);
    run('unzip', ['-q', '-o', join(tmp, 'openscad.zip'), 'openscad.js', 'openscad.wasm', '-d', tmp]);
    text = readFileSync(join(tmp, 'openscad.js'), 'utf8');
    wasm = readFileSync(join(tmp, 'openscad.wasm'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (!text.includes(HEAP_MAX[0])) {
    throw new Error(`OpenSCAD ${VERSION}'s glue has no "${HEAP_MAX[0]}" to patch`);
  }
  const dist = join(HERE, 'dist');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'openscad.js'), text.replace(HEAP_MAX[0], HEAP_MAX[1]));
  writeFileSync(join(dist, 'openscad.wasm'), wasm);
  writeFileSync(join(dist, 'VERSION'), `${VERSION}\n`);
}

await wasmRelease({
  name: 'openscad',
  label: 'OpenSCAD WASM',
  dir: HERE,
  inputs: [fileURLToPath(import.meta.url)],
  build,
  buildOnMissing: true,
  notes:
    `OpenSCAD ${VERSION} WebAssembly (the upstream snapshot ${URL}, sha256 ${SHA256}), ` +
    'with its heap limit made a module option. Mirrored by CI from packages/openscad at ' +
    'input hash {hash}; downloaded by `pnpm openscad ensure`. OpenSCAD is GPL-2.0-or-later; ' +
    'the libraries it bundles are listed in NOTICE.',
  buildHint: 'pnpm openscad build',
});
