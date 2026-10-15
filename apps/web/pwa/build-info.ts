import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Which deployment a build is for: `stable` (app.), `edge` (edge.) or a local `dev` build. */
export type BuildChannel = 'stable' | 'edge' | 'dev';

/** What the About dialog shows about the build, fixed at build time. */
export interface BuildInfo {
  /** `0.6.1` on stable; `0.6.1+edge.17` (17 commits after v0.6.1) on edge, `+dev.17` locally. */
  version: string;
  channel: BuildChannel;
  /** The short commit hash, empty without git. */
  commit: string;
  /** Uncommitted changes in a local build. */
  dirty: boolean;
  /** ISO time of the build. */
  date: string;
  /** The WASM engines bundled in the build: `occt-<hash>`, `planegcs-<hash>`, the OpenSCAD snapshot. */
  engines: { occt: string; planegcs: string; openscad: string };
}

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Runs git in the repository; `undefined` when git or the repository is missing. */
export function runGit(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function hashOf(script: string, prefix: string): string {
  try {
    const hash = execFileSync('node', [script, 'hash'], {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return hash ? `${prefix}-${hash}` : '';
  } catch {
    return '';
  }
}

function engines(): BuildInfo['engines'] {
  let openscad = '';
  try {
    openscad = readFileSync(`${ROOT}packages/openscad/dist/VERSION`, 'utf8').trim();
  } catch {
    // not downloaded
  }
  return {
    occt: hashOf('packages/kernel/occt/occt.mjs', 'occt'),
    planegcs: hashOf('packages/sketch/planegcs/planegcs.mjs', 'planegcs'),
    openscad,
  };
}

/**
 * The build's version from the last release tag: `git describe` gives the tag
 * and the commits since it. The deploy workflow sets `EXTRUDO_CHANNEL`; any
 * other build is `dev`. Without git (a source tarball) it falls back to the
 * package version.
 */
export function buildInfo(
  packageVersion: string,
  env: Record<string, string | undefined> = process.env,
  git: (args: string[]) => string | undefined = runGit,
): BuildInfo {
  const channel: BuildChannel =
    env.EXTRUDO_CHANNEL === 'stable' || env.EXTRUDO_CHANNEL === 'edge'
      ? env.EXTRUDO_CHANNEL
      : 'dev';
  const described = git(['describe', '--tags', '--match', 'v[0-9]*', '--long', '--dirty']);
  const match = described?.match(/^v(.+)-(\d+)-g([0-9a-f]+)(-dirty)?$/);
  const base = match?.[1] ?? packageVersion;
  const ahead = Number(match?.[2] ?? 0);
  const commit = match?.[3] ?? git(['rev-parse', '--short', 'HEAD']) ?? '';
  const version = channel === 'stable' || ahead === 0 ? base : `${base}+${channel}.${ahead}`;
  return {
    version,
    channel,
    commit: commit.slice(0, 7),
    dirty: Boolean(match?.[4]),
    date: new Date().toISOString(),
    engines: engines(),
  };
}
