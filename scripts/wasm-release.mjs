// Shared build/publish/fetch logic for the WASM builds we make ourselves
// (packages/kernel/occt, packages/sketch/planegcs) or mirror
// (packages/openscad: OpenSCAD's own snapshot, ADR-0071 §1).
//
// A build needs Docker and takes minutes, so it is keyed by a hash of its
// inputs. CI builds each new hash once and publishes `dist/` as a GitHub
// release asset tagged `<name>-<hash>`. Everyone else downloads it.
//
// Commands every build gets:
//   hash      print the input hash
//   ensure    make dist/ match the inputs: no-op, else download
//   fetch     download the release for the current hash
//   build     build locally with Docker
//   publish   upload dist/ as the release for the current hash (CI)
//   exists    exit 0 if that release exists, 1 if not (CI)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = 'zoltanf/extrudo';

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
  const STAMP = join(DIST, '.inputs-hash');

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
    const tmp = join(spec.dir, '.download');
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
      rmSync(DIST, { recursive: true, force: true });
      mkdirSync(DIST, { recursive: true });
      run('tar', ['-xzf', tarball, '-C', DIST]);
      writeFileSync(STAMP, `${hash}\n`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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
    const files = readdirSync(DIST).filter((name) => name !== '.inputs-hash');
    run('tar', ['-czf', tarball, '-C', DIST, ...files]);
    try {
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
        if (stampMatches(hash)) break;
        console.log(`${spec.label}: dist/ is missing or stale, downloading ${tag(hash)}…`);
        try {
          await fetchRelease(hash);
        } catch (error) {
          if (spec.buildOnMissing) {
            console.log(`${spec.label}: no ${tag(hash)} release (${error.message}), building it`);
            await spec.build();
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
        writeFileSync(STAMP, `${hash}\n`);
        break;
      case 'publish':
        publish(hash);
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
          `usage: ${spec.name} ${['hash', 'ensure', 'fetch', 'build', ...Object.keys(extra), 'publish', 'exists'].join('|')}`,
        );
        process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
