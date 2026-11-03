#!/usr/bin/env node
/**
 * Fetch the pinned cadmpeg for the desktop installers (P6-19, ADR-0115 §3).
 *
 * Reads `apps/desktop/cadmpeg.json` (or `--pin <path>`), downloads the archive
 * for the host (or `--target <triple>`) from the cadmpeg release, checks its
 * SHA-256 against the pin **before** extracting (a mismatch deletes the
 * download and exits 1; there is no way to skip the check), and extracts only
 * `cadmpeg[.exe]` and `LICENSE` into `apps/desktop/vendor/cadmpeg/`, which
 * `electron-builder.yml` ships as `resources/cadmpeg/`. For the host target it
 * then runs `cadmpeg --version` and fails unless it prints the pinned version.
 *
 * Already fetched (`.version` and `.source` match the pin and the binary is
 * there): prints so and exits 0. `--force` fetches again.
 *
 *   node apps/desktop/scripts/fetch-cadmpeg.mjs [--target <triple>] [--pin <path>] [--force]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PIN = join(appDir, 'cadmpeg.json');
export const VENDOR_DIR = join(appDir, 'vendor', 'cadmpeg');

const HOST_TRIPLES = {
  'linux/x64': 'x86_64-unknown-linux-gnu',
  'linux/arm64': 'aarch64-unknown-linux-gnu',
  'darwin/x64': 'x86_64-apple-darwin',
  'darwin/arm64': 'aarch64-apple-darwin',
  'win32/x64': 'x86_64-pc-windows-msvc',
};

/** The cadmpeg target triple for a Node platform and arch, or undefined. */
export function hostTriple(platform = process.platform, arch = process.arch) {
  return HOST_TRIPLES[`${platform}/${arch}`];
}

export function readPin(path = DEFAULT_PIN) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** `<repository>/releases/download/v<version>/<file>` for a target in the pin. */
export function downloadUrl(pin, triple) {
  const archive = pin.archives[triple];
  if (!archive) throw new Error(`no cadmpeg archive pinned for ${triple}`);
  return `${pin.repository}/releases/download/v${pin.version}/${archive.file}`;
}

export function binaryName(triple) {
  return triple.includes('windows') ? 'cadmpeg.exe' : 'cadmpeg';
}

function say(message) {
  console.log(`fetch-cadmpeg: ${message}`);
}

/** Throws, so `finally` still removes the download; the entry point exits 1. */
function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = { target: undefined, pin: DEFAULT_PIN, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') args.force = true;
    else if (arg === '--target' || arg === '--pin') {
      const value = argv[++i];
      if (!value) fail(`${arg} needs a value`);
      args[arg.slice(2)] = arg === '--pin' ? resolve(value) : value;
    } else fail(`unknown argument ${arg}`);
  }
  return args;
}

/** Download to `dest`, hashing on the way; returns the hex SHA-256. */
async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok || !response.body) fail(`download failed: ${response.status} ${url}`);
  const hash = createHash('sha256');
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => hash.update(chunk));
  await pipeline(body, createWriteStream(dest));
  return hash.digest('hex');
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') return false;
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with ${result.status}`);
  return true;
}

/** Extract the whole archive into `dir` (it was hash-checked). */
function extract(archive, dir) {
  if (archive.endsWith('.zip') && process.platform !== 'win32') {
    if (!run('unzip', ['-q', '-o', archive, '-d', dir])) {
      fail('unzip is needed to extract a .zip on this OS; install it (e.g. apt install unzip)');
    }
    return;
  }
  // Windows' own bsdtar reads .zip and .tar.xz; a Git-for-Windows GNU tar on
  // PATH would read neither the zip nor a `C:` path.
  const tar =
    process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  if (!run(tar, ['-xf', archive, '-C', dir])) fail(`${tar} not found`);
}

/** The folder holding the files: the top level, or its one `cadmpeg-<triple>/` folder. */
function contentDir(dir, binary) {
  if (existsSync(join(dir, binary))) return dir;
  const entries = readdirSync(dir);
  if (entries.length === 1 && statSync(join(dir, entries[0])).isDirectory()) {
    const inner = join(dir, entries[0]);
    if (existsSync(join(inner, binary))) return inner;
  }
  fail(
    `${binary} is neither at the archive's top level nor in its one folder: ${entries.join(', ')}`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = hostTriple();
  const triple = args.target ?? host;
  if (!triple) fail(`no cadmpeg build for ${process.platform}/${process.arch}`);

  const pin = readPin(args.pin);
  const archive = pin.archives[triple];
  if (!archive) fail(`no cadmpeg archive pinned for ${triple} in ${args.pin}`);
  const binary = binaryName(triple);
  const source = `${triple} ${archive.sha256}`;

  const versionFile = join(VENDOR_DIR, '.version');
  const sourceFile = join(VENDOR_DIR, '.source');
  if (
    !args.force &&
    existsSync(join(VENDOR_DIR, binary)) &&
    existsSync(versionFile) &&
    existsSync(sourceFile) &&
    readFileSync(versionFile, 'utf8').trim() === pin.version &&
    readFileSync(sourceFile, 'utf8').trim() === source
  ) {
    say(`cadmpeg ${pin.version} already fetched (${triple})`);
    return;
  }

  // Wipe first: a failed run leaves no binary behind, not a stale one.
  rmSync(VENDOR_DIR, { recursive: true, force: true });

  const work = mkdtempSync(join(tmpdir(), 'extrudo-fetch-cadmpeg-'));
  try {
    const url = downloadUrl(pin, triple);
    const file = join(work, archive.file);
    say(`downloading ${url}`);
    const actual = await download(url, file);
    if (actual !== archive.sha256) {
      rmSync(file, { force: true });
      fail(
        `SHA-256 mismatch for ${archive.file}\n  pinned: ${archive.sha256}\n  actual: ${actual}`,
      );
    }
    say(`SHA-256 matches the pin (${actual})`);

    const unpacked = join(work, 'x');
    mkdirSync(unpacked);
    extract(file, unpacked);
    const from = contentDir(unpacked, binary);
    if (!existsSync(join(from, 'LICENSE'))) fail('the archive has no LICENSE');

    mkdirSync(VENDOR_DIR, { recursive: true });
    copyFileSync(join(from, binary), join(VENDOR_DIR, binary));
    copyFileSync(join(from, 'LICENSE'), join(VENDOR_DIR, 'LICENSE'));
    chmodSync(join(VENDOR_DIR, binary), 0o755);
    writeFileSync(versionFile, `${pin.version}\n`);
    writeFileSync(sourceFile, `${source}\n`);
    say(`extracted ${binary} and LICENSE into ${VENDOR_DIR}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  if (triple !== host) {
    say(`not running --version: ${triple} is not this host (${host ?? 'unsupported'})`);
    return;
  }
  const result = spawnSync(join(VENDOR_DIR, binary), ['--version'], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.error || result.status !== 0 || !output.includes(pin.version)) {
    rmSync(VENDOR_DIR, { recursive: true, force: true });
    fail(`${binary} --version did not print ${pin.version}: ${result.error?.message ?? output}`);
  }
  say(output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`fetch-cadmpeg: ${error.message}`);
    process.exit(1);
  }
}
