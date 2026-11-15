// Shared build/publish/fetch logic for the WASM builds we make ourselves
// (packages/kernel/occt, packages/sketch/planegcs) or mirror
// (packages/openscad: OpenSCAD's own snapshot, ADR-0071 §1).
//
// A build needs Docker and takes minutes, so it is keyed by a hash of its
// inputs. CI builds each new hash once and publishes `dist/` as a GitHub
// release asset tagged `<name>-<hash>`. Everyone else downloads it, and the
// download must have the SHA-256 pinned for that tag in `wasm-pins.json`
// (checked in, so a new build's digest shows up in review), or nothing is
// unpacked (fail closed; ADR-0001's amendment of 2026-11-15). Unpacking (or a
// local build) records every file's SHA-256 in `dist/.sha256`, and `ensure`
// refuses a dist/ whose files no longer match it.
//
// Commands every build gets:
//   hash      print the input hash
//   ensure    make dist/ match the inputs: no-op, else download
//   fetch     download the release for the current hash
//   build     build locally with Docker
//   publish   upload dist/ as the release for the current hash and pin it (CI)
//   pin       pin the digest of the published release for the current hash
//   exists    exit 0 if that release exists, 1 if not (CI)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'zoltanf/extrudo';
/** The pinned SHA-256 of each build's release tarball: `{ <name>: { tag, sha256 } }`. */
export const PINS = join(dirname(fileURLToPath(import.meta.url)), 'wasm-pins.json');
const PINS_SHOWN = 'scripts/wasm-pins.json';
const SHA256 = /^[0-9a-f]{64}$/;
/** dist/'s bookkeeping files: never packed, never hashed. */
const STAMP_NAME = '.inputs-hash';
const MANIFEST_NAME = '.sha256';

/** The SHA-256 of `bytes`, as lowercase hex. */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function readPins(path = PINS) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

export function writePins(pins, path = PINS) {
  const sorted = Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * The SHA-256 pinned for release `tag` of build `name`. Throws when there is
 * none (or it pins another tag): a download that can't be checked is not used.
 */
export function pinFor(pins, name, tag) {
  const pin = pins[name];
  if (pin?.tag === tag && typeof pin.sha256 === 'string' && SHA256.test(pin.sha256)) {
    return pin.sha256;
  }
  throw new Error(
    `${PINS_SHOWN} has no SHA-256 for ${tag}` +
      (pin?.tag && pin.tag !== tag ? ` (it pins ${pin.tag})` : '') +
      ", so its download can't be checked. If CI has published that release, run " +
      '`pnpm wasm:pin` and commit the change',
  );
}

/** A file whose SHA-256 is not the recorded one. */
export class DigestMismatch extends Error {}

/** Throws unless `bytes` has the SHA-256 `expected` (hex), naming `file`. */
export function checkDigest(bytes, expected, file) {
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new DigestMismatch(
      `${file}: SHA-256 mismatch, refusing it.\n  expected ${expected} (${PINS_SHOWN})\n  actual   ${actual}`,
    );
  }
}

/** Records the SHA-256 of every file in `dist` in `dist/.sha256`. */
export function writeManifest(dist) {
  const lines = distFiles(dist).map(
    (file) => `${sha256(readFileSync(join(dist, file)))}  ${file}\n`,
  );
  writeFileSync(join(dist, MANIFEST_NAME), lines.join(''));
}

/**
 * Checks `dist` against `dist/.sha256`: false when there is no record (an
 * older unpack: fetch again), true when it matches; throws, naming the file,
 * when a file was changed, added or removed.
 */
export function checkManifest(dist) {
  const path = join(dist, MANIFEST_NAME);
  if (!existsSync(path)) return false;
  const expected = new Map(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(66), line.slice(0, 64)]),
  );
  const shown = relative(process.cwd(), dist) || dist;
  for (const file of distFiles(dist)) {
    const want = expected.get(file);
    const actual = sha256(readFileSync(join(dist, file)));
    if (want === undefined) throw new Error(`${shown}/${file} is not one the build made`);
    if (want !== actual) {
      throw new DigestMismatch(
        `${shown}/${file}: SHA-256 mismatch, refusing it.\n  expected ${want} (when it was unpacked)\n  actual   ${actual}`,
      );
    }
    expected.delete(file);
  }
  for (const file of expected.keys()) throw new Error(`${shown}/${file} is missing`);
  return true;
}

/** dist/'s files, relative and `/`-separated, without its bookkeeping files. */
function distFiles(dist) {
  return filesIn(dist)
    .map((path) => relative(dist, path).split('\\').join('/'))
    .filter((file) => file !== STAMP_NAME && file !== MANIFEST_NAME);
}

/** The digest GitHub reports for the asset `name` of release `tag`, or undefined. */
export async function releaseDigest(tag, name, hasGh) {
  let release;
  if (hasGh) {
    const out = spawnSync('gh', ['api', `repos/${REPO}/releases/tags/${tag}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    if (out.error) throw out.error;
    if (out.status !== 0) throw new Error(`gh api releases/tags/${tag} exited with ${out.status}`);
    release = JSON.parse(out.stdout);
  } else {
    const url = `https://api.github.com/repos/${REPO}/releases/tags/${tag}`;
    const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
    release = await response.json();
  }
  return release.assets?.find((a) => a.name === name)?.digest ?? undefined;
}

/** Every file under `dir`, sorted, so the hash doesn't depend on directory order. */
export function filesIn(dir) {
  const files = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(dir);
  return files;
}

export function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status}`);
}

/**
 * @param {object} spec
 * @param {string} spec.name     release tag prefix and display name, e.g. `occt`
 * @param {string} spec.label    human name for messages, e.g. `OCCT WASM`
 * @param {string} spec.dir      the build's directory; `dist/` lives in it
 * @param {string[]} spec.inputs files whose content keys the build
 * @param {string} [spec.salt]   extra hash input (a toolchain version)
 * @param {() => void | Promise<void>} spec.build builds into dist/
 * @param {boolean} [spec.buildOnMissing] `ensure` builds when the release is
 *   missing (a build that is only a download, like OpenSCAD's mirror)
 * @param {string} spec.notes    release notes
 * @param {string} spec.buildHint command that builds it locally, for error messages
 * @param {Record<string, () => void>} [spec.commands] extra commands
 */
export async function wasmRelease(spec) {
  const DIST = join(spec.dir, 'dist');
  const STAMP = join(DIST, STAMP_NAME);

  const inputHash = () => {
    const hash = createHash('sha256').update(spec.salt ?? '');
    for (const file of spec.inputs) {
      // Normalise line endings so a Windows checkout hashes the same.
      const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      hash.update(`${relative(spec.dir, file).split('\\').join('/')}\n${text}\n`);
    }
    return hash.digest('hex').slice(0, 12);
  };
  const tag = (hash) => `${spec.name}-${hash}`;
  const asset = (hash) => `extrudo-${spec.name}-${hash}.tar.gz`;
  const stampMatches = (hash) => existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === hash;
  const hasGh = () => spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0;

  const fetchRelease = async (hash) => {
    // Before the download: without a pin there is nothing to check it against.
    const expected = pinFor(readPins(), spec.name, tag(hash));
    const tmp = join(spec.dir, '.download');
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const tarball = join(tmp, asset(hash));
    try {
      const gh = hasGh();
      if (gh) {
        // Works for the private repo too, with the user's (or CI's) gh auth.
        run('gh', ['release', 'download', tag(hash), '-R', REPO, '-p', asset(hash), '-D', tmp]);
      } else {
        const url = `https://github.com/${REPO}/releases/download/${tag(hash)}/${asset(hash)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
        writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
      }
      // Checked before anything is unpacked: dist/ stays as it was on a mismatch.
      checkDigest(readFileSync(tarball), expected, asset(hash));
      rmSync(DIST, { recursive: true, force: true });
      mkdirSync(DIST, { recursive: true });
      // A path relative to the working directory: GNU tar (Git Bash on Windows
      // runners) reads `D:\…` as a host name ("Cannot connect to D").
      run('tar', ['-xzf', relative(process.cwd(), tarball), '-C', relative(process.cwd(), DIST)]);
      writeManifest(DIST);
      writeFileSync(STAMP, `${hash}\n`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };

  const savePin = (hash, digest) => {
    writePins({ ...readPins(), [spec.name]: { tag: tag(hash), sha256: digest } });
    const line = `${tag(hash)}: SHA-256 ${digest}, pinned in ${PINS_SHOWN}`;
    console.log(line);
    // CI's runner can't commit it: say so where the run's summary shows it.
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `${line}. Commit it: run \`pnpm wasm:pin\` on this branch.\n`,
        { flag: 'a' },
      );
    }
  };

  /** Pins the digest GitHub reports for the published release of `hash`. */
  const pin = async (hash) => {
    const reported = await releaseDigest(tag(hash), asset(hash), hasGh());
    if (typeof reported !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(reported)) {
      throw new Error(`${tag(hash)}: the release reports no SHA-256 digest for ${asset(hash)}`);
    }
    const digest = reported.slice('sha256:'.length);
    const old = readPins()[spec.name];
    if (old?.tag === tag(hash)) {
      if (old.sha256 === digest) {
        console.log(`${tag(hash)} is pinned already`);
        return;
      }
      // Same inputs, other bytes: the release was replaced. Don't follow it.
      throw new Error(
        `${tag(hash)}: the release's SHA-256 is now ${digest}, ${PINS_SHOWN} pins ${old.sha256}; ` +
          'the release was replaced, so the pin stays',
      );
    }
    savePin(hash, digest);
  };

  const releaseExists = (hash) =>
    spawnSync('gh', ['release', 'view', tag(hash), '-R', REPO], { stdio: 'ignore' }).status === 0;

  const publish = (hash) => {
    if (!stampMatches(hash))
      throw new Error('dist/ does not match the current inputs; build first');
    if (releaseExists(hash)) {
      console.log(`${tag(hash)} already exists`);
      return;
    }
    const tarball = join(spec.dir, asset(hash));
    const files = readdirSync(DIST).filter((name) => name !== STAMP_NAME && name !== MANIFEST_NAME);
    run('tar', ['-czf', tarball, '-C', DIST, ...files]);
    try {
      const digest = sha256(readFileSync(tarball));
      run('gh', [
        'release',
        'create',
        tag(hash),
        tarball,
        '-R',
        REPO,
        '--prerelease',
        '--title',
        `${spec.label} ${hash}`,
        '--notes',
        spec.notes.replace('{hash}', hash),
        ...(process.env.GITHUB_SHA ? ['--target', process.env.GITHUB_SHA] : []),
      ]);
      savePin(hash, digest);
    } finally {
      rmSync(tarball, { force: true });
    }
  };

  const command = process.argv[2];
  const hash = inputHash();
  const extra = spec.commands ?? {};
  try {
    switch (command) {
      case 'hash':
        console.log(hash);
        break;
      case 'ensure':
        // A changed file throws (refused); an unrecorded dist/ is fetched again.
        if (stampMatches(hash) && checkManifest(DIST)) break;
        console.log(`${spec.label}: dist/ is missing or stale, downloading ${tag(hash)}…`);
        try {
          await fetchRelease(hash);
        } catch (error) {
          // A download that doesn't match its pin is refused outright.
          if (error instanceof DigestMismatch) throw error;
          if (spec.buildOnMissing) {
            console.log(`${spec.label}: no ${tag(hash)} release (${error.message}), building it`);
            await spec.build();
            writeManifest(DIST);
            writeFileSync(STAMP, `${hash}\n`);
            break;
          }
          console.error(
            `\nCould not download ${tag(hash)} (${error.message}).\n` +
              `If you changed ${relative(process.cwd(), spec.dir) || spec.dir}, build it locally with Docker:\n` +
              `  ${spec.buildHint}\n` +
              'or push the change and let CI publish it.',
          );
          process.exit(1);
        }
        break;
      case 'fetch':
        await fetchRelease(hash);
        break;
      case 'build':
        await spec.build();
        writeManifest(DIST);
        writeFileSync(STAMP, `${hash}\n`);
        break;
      case 'publish':
        publish(hash);
        break;
      case 'pin':
        await pin(hash);
        break;
      case 'exists':
        process.exit(releaseExists(hash) ? 0 : 1);
        break;
      default:
        if (command in extra) {
          extra[command]();
          break;
        }
        console.error(
          `usage: ${spec.name} ${['hash', 'ensure', 'fetch', 'build', ...Object.keys(extra), 'publish', 'pin', 'exists'].join('|')}`,
        );
        process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
