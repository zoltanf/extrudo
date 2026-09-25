#!/usr/bin/env node
// Builds, publishes and fetches Extrudo's OCCT WASM (packages/kernel/occt/dist).
//
// The build needs Docker and takes about 10 minutes, so it is keyed by a hash of
// its inputs (the config, the C++ facade and the toolchain version). CI builds
// each new hash once and publishes dist/ as a GitHub release asset tagged
// `occt-<hash>`. Everyone else downloads it.
//
//   node occt.mjs hash      print the input hash
//   node occt.mjs ensure    make dist/ match the inputs: no-op, else download
//   node occt.mjs fetch     download the release for the current hash
//   node occt.mjs build     build locally with Docker (+ libcascade assemble)
//   node occt.mjs check     fail if src/ uses an OCCT symbol the build doesn't bind
//   node occt.mjs publish   upload dist/ as the release for the current hash (CI)
//   node occt.mjs exists    exit 0 if that release exists, 1 if not (CI)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KERNEL = join(HERE, '..');
const DIST = join(HERE, 'dist');
const STAMP = join(DIST, '.inputs-hash');
const REPO = 'zoltanf/extrudo';
const BIN = join(KERNEL, 'node_modules', '.bin', 'libcascade');

function inputFiles() {
  const files = [join(HERE, 'libcascade.config.ts')];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(join(HERE, 'facade'));
  return files;
}

function inputHash() {
  const toolchain = JSON.parse(readFileSync(join(KERNEL, 'package.json'), 'utf8')).devDependencies[
    '@libcascade/toolchain'
  ];
  const hash = createHash('sha256').update(`toolchain ${toolchain}\n`);
  for (const file of inputFiles()) {
    // Normalise line endings so a Windows checkout hashes the same.
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    hash.update(`${relative(HERE, file).split('\\').join('/')}\n${text}\n`);
  }
  return hash.digest('hex').slice(0, 12);
}

const tag = (hash) => `occt-${hash}`;
const asset = (hash) => `extrudo-occt-${hash}.tar.gz`;

function stampMatches(hash) {
  return existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === hash;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status}`);
}

function hasGh() {
  return spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0;
}

function unpack(tarball, hash) {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', DIST]);
  writeFileSync(STAMP, `${hash}\n`);
}

async function fetchRelease(hash) {
  const tmp = join(HERE, '.download');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const tarball = join(tmp, asset(hash));
  try {
    if (hasGh()) {
      // Works for the private repo too, with the user's (or CI's) gh auth.
      run('gh', ['release', 'download', tag(hash), '-R', REPO, '-p', asset(hash), '-D', tmp]);
    } else {
      const url = `https://github.com/${REPO}/releases/download/${tag(hash)}/${asset(hash)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
      writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
    }
    unpack(tarball, hash);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function build(hash) {
  run(BIN, ['build'], { cwd: HERE });
  run(BIN, ['assemble'], { cwd: HERE });
  writeFileSync(STAMP, `${hash}\n`);
}

function releaseExists(hash) {
  return (
    spawnSync('gh', ['release', 'view', tag(hash), '-R', REPO], { stdio: 'ignore' }).status === 0
  );
}

function publish(hash) {
  if (!stampMatches(hash)) throw new Error('dist/ does not match the current inputs; build first');
  if (releaseExists(hash)) {
    console.log(`${tag(hash)} already exists`);
    return;
  }
  const tarball = join(HERE, asset(hash));
  const files = readdirSync(DIST).filter((name) => name !== '.inputs-hash');
  run('tar', ['-czf', tarball, '-C', DIST, ...files]);
  try {
    const notes =
      'Extrudo OCCT WASM, built by CI from packages/kernel/occt at input hash ' +
      `${hash}. Downloaded by \`pnpm occt ensure\`. OCCT and the facade are LGPL-2.1-or-later.`;
    run('gh', [
      'release',
      'create',
      tag(hash),
      tarball,
      '-R',
      REPO,
      '--prerelease',
      '--title',
      `OCCT WASM ${hash}`,
      '--notes',
      notes,
      ...(process.env.GITHUB_SHA ? ['--target', process.env.GITHUB_SHA] : []),
    ]);
  } finally {
    rmSync(tarball, { force: true });
  }
}

const command = process.argv[2];
const hash = inputHash();
try {
  switch (command) {
    case 'hash':
      console.log(hash);
      break;
    case 'ensure':
      if (stampMatches(hash)) break;
      console.log(`OCCT WASM: dist/ is missing or stale, downloading ${tag(hash)}…`);
      try {
        await fetchRelease(hash);
      } catch (error) {
        console.error(
          `\nCould not download ${tag(hash)} (${error.message}).\n` +
            'If you changed packages/kernel/occt, build it locally with Docker:\n' +
            '  pnpm occt build\n' +
            'or push the change and let CI publish it.',
        );
        process.exit(1);
      }
      break;
    case 'fetch':
      await fetchRelease(hash);
      break;
    case 'build':
      build(hash);
      break;
    case 'check':
      run(BIN, ['check', join(KERNEL, 'src'), '--config', join(HERE, 'libcascade.config.ts')]);
      break;
    case 'publish':
      publish(hash);
      break;
    case 'exists':
      process.exit(releaseExists(hash) ? 0 : 1);
      break;
    default:
      console.error('usage: node occt.mjs hash|ensure|fetch|build|check|publish|exists');
      process.exit(2);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
