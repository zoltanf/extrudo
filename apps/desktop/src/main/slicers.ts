/**
 * Finding and launching slicers (P6-02, ADR-0062's amendment). Pure over an
 * injected environment, so every OS's candidates are unit-tested on Linux; the
 * real environment is `nodeSlicerEnv` at the bottom.
 *
 * A slicer can only open a file, so the exported bytes are written to
 * `<temp>/extrudo-slicer/<name>` and the program is started on that path,
 * detached. Nothing here throws to the renderer: a failed launch is `false`.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { posix, win32 } from 'node:path';
import { SLICERS, type SlicerFile, type SlicerId } from '@extrudo/web/platform/slicer';

export type Launcher = 'exe' | 'flatpak' | 'open';

/** An installed slicer: `path` is the program, the app bundle or the flatpak's ID. */
export interface FoundSlicer {
  id: SlicerId;
  path: string;
  launcher: Launcher;
}

/** The slice of a child process the launch watches. */
export interface SpawnedProcess {
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  unref(): void;
}

export interface SlicerEnv {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  exists(path: string): boolean;
  /** Names of the entries of `dir` that start with `prefix` (none if it can't be read). */
  glob(dir: string, prefix: string): string[];
  /** The executable `name` resolves to on `PATH`, if any. */
  which(name: string): string | undefined;
  /** Whether `flatpak info <id>` succeeds. */
  flatpakInfo(id: string): boolean;
  spawn(command: string, args: string[]): SpawnedProcess;
  tempDir: string;
  /** The preference `slicers.paths`: a path per slicer that wins over detection. */
  overrides: Partial<Record<SlicerId, string>>;
  /** Creates `dir` (mode 0o700) and refuses one that isn't ours. */
  prepareDir(dir: string): void;
  /** Writes `bytes` to `path`, replacing a file that is there. */
  writeFile(path: string, bytes: Uint8Array): void;
  removeDir(dir: string): void;
}

/** A file larger than this is not written (a model, not an archive of them). */
export const MAX_SLICER_BYTES = 500 * 1024 * 1024;
/** How long a started process may take to exit non-zero before the launch counts as failed. */
export const LAUNCH_WINDOW_MS = 1500;
export const SLICER_DIR = 'extrudo-slicer';

const LINUX_COMMANDS: readonly (readonly [SlicerId, string])[] = [
  ['prusaslicer', 'prusa-slicer'],
  ['orcaslicer', 'orca-slicer'],
  ['bambustudio', 'bambu-studio'],
  ['cura', 'cura'],
  ['cura', 'UltiMaker-Cura'],
];

const FLATPAKS: readonly (readonly [SlicerId, string])[] = [
  ['prusaslicer', 'com.prusa3d.PrusaSlicer'],
  ['orcaslicer', 'io.github.softfever.OrcaSlicer'],
  ['bambustudio', 'com.bambulab.BambuStudio'],
  ['cura', 'com.ultimaker.cura'],
];

/** Per-OS-root program paths, relative to `%ProgramFiles%` or `%LOCALAPPDATA%\Programs`. */
const WINDOWS_PROGRAMS: readonly (readonly [SlicerId, readonly string[]])[] = [
  ['prusaslicer', ['Prusa3D', 'PrusaSlicer', 'prusa-slicer.exe']],
  ['orcaslicer', ['OrcaSlicer', 'orca-slicer.exe']],
  ['bambustudio', ['Bambu Studio', 'bambu-studio.exe']],
];
const WINDOWS_CURA_PREFIXES = ['UltiMaker Cura ', 'Ultimaker Cura '];

const MAC_APPS: readonly (readonly [SlicerId, string])[] = [
  ['prusaslicer', 'PrusaSlicer.app'],
  ['orcaslicer', 'OrcaSlicer.app'],
  ['bambustudio', 'BambuStudio.app'],
  ['cura', 'UltiMaker Cura.app'],
];

/** Compares version-like names ("UltiMaker Cura 5.10.1" over "… 5.9.0"), newest first. */
function newestFirst(a: string, b: string): number {
  const parts = (name: string) => (name.match(/\d+/g) ?? []).map(Number);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (right[i] ?? 0) - (left[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function windowsCandidates(env: SlicerEnv): { id: SlicerId; path: string }[] {
  const roots = [
    env.env.ProgramFiles,
    env.env.LOCALAPPDATA ? win32.join(env.env.LOCALAPPDATA, 'Programs') : undefined,
  ].filter((root): root is string => !!root);
  const found: { id: SlicerId; path: string }[] = [];
  for (const root of roots) {
    for (const [id, parts] of WINDOWS_PROGRAMS)
      found.push({ id, path: win32.join(root, ...parts) });
    const dirs = WINDOWS_CURA_PREFIXES.flatMap((prefix) => env.glob(root, prefix)).sort(
      newestFirst,
    );
    for (const dir of dirs) {
      found.push({ id: 'cura', path: win32.join(root, dir, 'UltiMaker-Cura.exe') });
    }
  }
  return found;
}

/** The installed slicers, one per ID (the first candidate found wins). */
export function findSlicers(env: SlicerEnv): FoundSlicer[] {
  const found = new Map<SlicerId, FoundSlicer>();
  const add = (slicer: FoundSlicer) => {
    if (!found.has(slicer.id)) found.set(slicer.id, slicer);
  };

  // An override wins, and counts as installed when its path exists.
  for (const { id } of SLICERS) {
    const path = env.overrides[id];
    if (typeof path === 'string' && path !== '' && env.exists(path)) {
      add({
        id,
        path,
        launcher: env.platform === 'darwin' && path.endsWith('.app') ? 'open' : 'exe',
      });
    }
  }

  if (env.platform === 'linux') {
    for (const [id, command] of LINUX_COMMANDS) {
      const path = env.which(command);
      if (path) add({ id, path, launcher: 'exe' });
    }
    for (const [id, flatpak] of FLATPAKS) {
      if (!found.has(id) && env.flatpakInfo(flatpak)) {
        add({ id, path: flatpak, launcher: 'flatpak' });
      }
    }
  } else if (env.platform === 'win32') {
    for (const { id, path } of windowsCandidates(env))
      if (env.exists(path)) add({ id, path, launcher: 'exe' });
  } else if (env.platform === 'darwin') {
    for (const [id, app] of MAC_APPS) {
      const path = posix.join('/Applications', app);
      if (env.exists(path)) add({ id, path, launcher: 'open' });
    }
  }
  return SLICERS.flatMap(({ id }) => found.get(id) ?? []);
}

/**
 * A file name a slicer's temp file may have: a basename (no separators, no
 * leading dot, no characters Windows refuses) whose extension is the format's.
 */
export function sanitizeFileName(name: string, format: SlicerFile['format']): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const printable = [...base].map((c) => (c.charCodeAt(0) < 32 ? '_' : c)).join('');
  const cleaned = printable
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim();
  const stem = cleaned.replace(/\.(3mf|stl|step|stp)$/i, '').replace(/[.\s]+$/, '');
  return `${(stem || 'model').slice(0, 120)}.${format}`;
}

const FORMATS: readonly string[] = ['3mf', 'stl', 'step'];

/** Whether `value` is a well-formed `SlicerFile` (it crossed the bridge, so it is checked). */
export function isSlicerFile(value: unknown): value is SlicerFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.name === 'string' &&
    file.bytes instanceof Uint8Array &&
    typeof file.format === 'string' &&
    FORMATS.includes(file.format)
  );
}

export const isSlicerId = (value: unknown): value is SlicerId =>
  typeof value === 'string' && SLICERS.some((slicer) => slicer.id === value);

/** The program and arguments that open `file` in `slicer`. */
export function launchCommand(slicer: FoundSlicer, file: string): [string, string[]] {
  if (slicer.launcher === 'flatpak') {
    // The sandbox has a private /tmp: forward the file through the document portal.
    return ['flatpak', ['run', '--file-forwarding', slicer.path, '@@', file, '@@']];
  }
  if (slicer.launcher === 'open') return ['open', ['-a', slicer.path, file]];
  return [slicer.path, [file]];
}

/** Waits for the process to either fail or outlast the window: true when it took the file. */
function launched(env: SlicerEnv, command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child: SpawnedProcess;
    try {
      child = env.spawn(command, args);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      child.unref();
      resolve(true);
    }, LAUNCH_WINDOW_MS);
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    child.on('error', () => finish(false));
    // A zero exit inside the window is a launcher that handed over (`open`).
    child.on('exit', (code) => finish(code === 0));
  });
}

/** Writes the file and starts the slicer on it; false on any failure, never throws. */
export async function openInSlicer(
  env: SlicerEnv,
  found: readonly FoundSlicer[],
  file: SlicerFile,
  id: SlicerId,
): Promise<boolean> {
  try {
    const slicer = found.find((candidate) => candidate.id === id);
    if (!slicer || file.bytes.byteLength > MAX_SLICER_BYTES) return false;
    const path = env.platform === 'win32' ? win32 : posix;
    const dir = path.join(env.tempDir, SLICER_DIR);
    env.prepareDir(dir);
    const target = path.join(dir, sanitizeFileName(file.name, file.format));
    env.writeFile(target, file.bytes);
    const [command, args] = launchCommand(slicer, target);
    return await launched(env, command, args);
  } catch {
    return false;
  }
}

/** Empties the temp directory (on quit); best effort. */
export function cleanupSlicerFiles(env: SlicerEnv): void {
  try {
    const path = env.platform === 'win32' ? win32 : posix;
    env.removeDir(path.join(env.tempDir, SLICER_DIR));
  } catch {
    // A slicer still holds a file (Windows): the OS clears its temp directory later.
  }
}

/** The real environment, with the preference's overrides read now. */
export function nodeSlicerEnv(
  tempDir: string,
  overrides: Partial<Record<SlicerId, string>>,
): SlicerEnv {
  const exists = (path: string) => {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  };
  const runnable = (path: string) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };
  return {
    platform: process.platform,
    env: process.env,
    exists,
    glob(dir, prefix) {
      try {
        return readdirSync(dir).filter((entry) => entry.startsWith(prefix));
      } catch {
        return [];
      }
    },
    which(name) {
      const dirs = (process.env.PATH ?? '').split(posix.delimiter).filter(Boolean);
      for (const dir of dirs) {
        const candidate = posix.join(dir, name);
        if (runnable(candidate)) return candidate;
      }
      return undefined;
    },
    flatpakInfo(id) {
      return flatpakInfo(id);
    },
    spawn: (command, args) =>
      spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }),
    tempDir,
    overrides,
    prepareDir(dir) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      // /tmp is shared: the directory must be a real one of ours, not a link planted there.
      const info = lstatSync(dir);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error('The slicer directory is not a plain directory.');
      }
      if (process.platform !== 'win32') {
        if (info.uid !== process.getuid?.()) throw new Error('The slicer directory is not ours.');
        chmodSync(dir, 0o700);
      }
    },
    writeFile(path, bytes) {
      rmSync(path, { force: true });
      writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
    },
    removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
  };
}

function flatpakInfo(id: string): boolean {
  try {
    return spawnSync('flatpak', ['info', id], { stdio: 'ignore', timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
}
