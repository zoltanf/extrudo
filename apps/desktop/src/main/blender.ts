/**
 * Finding and running Blender for Render Picture (P6-15, ADR-0101 §3). Pure
 * over an injected environment like `slicers.ts`, so every OS's candidates and
 * the whole render flow are unit-tested on Linux; the real environment is
 * `nodeBlenderEnv` at the bottom.
 *
 * A render is a job directory `<temp>/extrudo-render-<8 hex>`, a direct child
 * of the (sticky) temp directory so no one else can rename it: the model as
 * OBJ + MTL, the job as JSON and the bundled `render.py`, then
 * `blender -b --factory-startup -noaudio --python render.py [-f 1] -- job.json out.png`
 * with that directory as its working directory. Progress is read from stdout:
 * the script's own `EXTRUDO <phase>` lines, and Blender's `Sample n/m` lines,
 * which only its command-line render (`-f 1`, used for the slow qualities)
 * prints: a render started from the script is silent. The result is
 * `out.png` (or `out1.png` after `-f 1`), and the directory is removed
 * afterwards whatever happened.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import type {
  BlenderStatus,
  RenderJob,
  RenderProgress,
  RenderResult,
} from '@extrudo/web/platform/render';
import { BLENDER_MIN_VERSION } from '@extrudo/web/platform/render';
import renderScript from './renderScript';

export type Launcher = 'exe' | 'flatpak';

/** An installed Blender: `path` is the program, or the flatpak's ID. */
export interface FoundBlender {
  path: string;
  launcher: Launcher;
}

/** The slice of a running Blender the render watches. */
export interface RenderProcess {
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  kill(): void;
}

export interface BlenderEnv {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string;
  exists(path: string): boolean;
  /** Names of the entries of `dir` that start with `prefix` (none if it can't be read). */
  glob(dir: string, prefix: string): string[];
  /** The executable `name` resolves to on `PATH`, if any. */
  which(name: string): string | undefined;
  /** Whether `flatpak info <id>` succeeds. */
  flatpakInfo(id: string): boolean;
  /** Runs the program to completion with a timeout; stdout+stderr text and the exit code. */
  run(command: string, args: string[], timeoutMs: number): { code: number | null; output: string };
  spawn(command: string, args: string[], cwd: string): RenderProcess;
  tempDir: string;
  /** The `blender.path` preference (a program path or the flatpak ID), or undefined. */
  override: string | undefined;
  /** Creates `dir` (mode 0o700); refuses one that already exists or isn't ours. */
  prepareDir(dir: string): void;
  writeFile(path: string, text: string): void;
  /** The file's bytes, or undefined when it isn't there. */
  readFile(path: string): Uint8Array | undefined;
  removeDir(dir: string): void;
}

/** What a cancel flips, and where the running process is kept so it can be killed. */
export interface RenderSignal {
  cancelled: boolean;
  process?: RenderProcess;
}

export const FLATPAK_ID = 'org.blender.Blender';
/** Job directories are `<temp>/<RENDER_PREFIX><8 hex>`. */
export const RENDER_PREFIX = 'extrudo-render-';
/** An OBJ longer than this is refused: a model, not a scene of them. */
export const MAX_OBJ_CHARS = 200 * 1024 * 1024;
/** How long `blender --version` may take. */
export const VERSION_TIMEOUT_MS = 10_000;
/** Progress is reported at most this often (phase changes always go through). */
export const PROGRESS_INTERVAL_MS = 100;

const MAC_APP_SUFFIX = 'Contents/MacOS/Blender';

/** Compares version-like names ("Blender 4.5" over "Blender 4.2"), newest first. */
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

/** The first Blender found: the override, then PATH, then the OS's usual places. */
export function findBlender(env: BlenderEnv): FoundBlender | undefined {
  const override = env.override?.trim();
  if (override) {
    if (override === FLATPAK_ID) {
      if (env.flatpakInfo(FLATPAK_ID)) return { path: FLATPAK_ID, launcher: 'flatpak' };
    } else if (env.exists(override)) {
      const path =
        env.platform === 'darwin' && override.endsWith('.app')
          ? posix.join(override, MAC_APP_SUFFIX)
          : override;
      return { path, launcher: 'exe' };
    }
  }
  const onPath = env.which('blender');
  if (onPath) return { path: onPath, launcher: 'exe' };

  const candidates: string[] = [];
  if (env.platform === 'linux') {
    if (env.flatpakInfo(FLATPAK_ID)) return { path: FLATPAK_ID, launcher: 'flatpak' };
    candidates.push(
      '/snap/bin/blender',
      posix.join(env.homeDir, '.steam/steam/steamapps/common/Blender/blender'),
      posix.join(env.homeDir, '.local/share/Steam/steamapps/common/Blender/blender'),
    );
  } else if (env.platform === 'win32') {
    const programs = env.env.ProgramFiles;
    if (programs) {
      const root = win32.join(programs, 'Blender Foundation');
      for (const dir of env.glob(root, 'Blender ').sort(newestFirst)) {
        candidates.push(win32.join(root, dir, 'blender.exe'));
      }
    }
    const programs86 = env.env['ProgramFiles(x86)'];
    if (programs86) {
      candidates.push(
        win32.join(programs86, 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe'),
      );
    }
  } else if (env.platform === 'darwin') {
    candidates.push(
      posix.join('/Applications/Blender.app', MAC_APP_SUFFIX),
      posix.join(env.homeDir, 'Applications/Blender.app', MAC_APP_SUFFIX),
      posix.join(
        env.homeDir,
        'Library/Application Support/Steam/steamapps/common/Blender/Blender.app',
        MAC_APP_SUFFIX,
      ),
    );
  }
  for (const path of candidates) if (env.exists(path)) return { path, launcher: 'exe' };
  return undefined;
}

/**
 * The program and arguments that run Blender with `args`. A flatpak's sandbox
 * has a private `/tmp`, so the job directory is granted to it for the run.
 */
export function launchCommand(
  found: FoundBlender,
  args: string[],
  dir?: string,
): [string, string[]] {
  if (found.launcher === 'flatpak') {
    const grant = dir ? [`--filesystem=${dir}`] : [];
    return ['flatpak', ['run', ...grant, found.path, ...args]];
  }
  return [found.path, args];
}

/** "4.2" from `blender --version`'s first line; undefined when it didn't run or say. */
export function blenderVersion(env: BlenderEnv, found: FoundBlender): string | undefined {
  try {
    const [command, args] = launchCommand(found, ['--version']);
    const { code, output } = env.run(command, args, VERSION_TIMEOUT_MS);
    if (code !== 0) return undefined;
    return /^Blender (\d+\.\d+)/m.exec(output)?.[1];
  } catch {
    return undefined;
  }
}

/** Whether `version` ("4.2", "5.2") is at least `BLENDER_MIN_VERSION`, numerically. */
export function isSupported(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  const [minMajor = 0, minMinor = 0] = BLENDER_MIN_VERSION.split('.').map(Number);
  return major > minMajor || (major === minMajor && minor >= minMinor);
}

/** What the Render dialog shows about Blender: found and usable, too old, or missing. */
export function blenderStatus(env: BlenderEnv): BlenderStatus {
  const found = findBlender(env);
  if (!found) return { state: 'missing' };
  const version = blenderVersion(env, found);
  // A Blender that can't even say its version is no use: say "missing" and
  // let the user install one or point the preference at a working one.
  if (!version) return { state: 'missing' };
  return { state: isSupported(version) ? 'found' : 'too-old', version, path: found.path };
}

/** What `job.json` holds: the job without the texts, which are files beside it. */
export function jobFile(job: RenderJob, eevee = true): Record<string, unknown> {
  return {
    project: job.project,
    obj: 'model.obj',
    objects: job.objects,
    preset: job.preset,
    camera: job.camera ?? null,
    width: job.width,
    height: job.height,
    quality: job.quality,
    // False after a crash: the draft takes Cycles (EEVEE needs a working GPU).
    ...(eevee ? {} : { eevee: false }),
  };
}

/** Blender's own crash handler ("Error : EXCEPTION_ACCESS_VIOLATION", "Thread : 1bc4"). */
const CRASH_LINE = /^(Error|Address|Module|Thread)\s*:\s/;

/** The progress a stdout line means, if any. */
export function progressOf(line: string): RenderProgress | undefined {
  const own = /^EXTRUDO (importing|scene|rendering|saving)\b/.exec(line);
  if (own) {
    switch (own[1]) {
      case 'importing':
        return { fraction: 0.05, phase: 'importing' };
      case 'scene':
        return { fraction: 0.08, phase: 'importing' };
      case 'rendering':
        return { fraction: 0.1, phase: 'rendering' };
      default:
        return { fraction: 0.97, phase: 'saving' };
    }
  }
  // Blender's own render, after `-f 1`: "… | Fra: 1 | … | Sample 12/128", then
  // "… | Finished" and "Saved: '…'".
  if (/\| Finished$/.test(line) || /^.*Saved: '/.test(line)) {
    return { fraction: 0.97, phase: 'saving' };
  }
  const sample = /Sample (\d+)\/(\d+)/.exec(line) ?? /Rendering (\d+) \/ (\d+) samples/.exec(line);
  if (sample) {
    const n = Number(sample[1]);
    const m = Math.max(1, Number(sample[2]));
    return { fraction: Math.min(0.95, 0.1 + 0.85 * (n / m)), phase: 'rendering' };
  }
  return undefined;
}

/** Splits chunks into whole lines, keeping a partial line for the next chunk. */
function lineReader(onLine: (line: string) => void): (chunk: string) => void {
  let rest = '';
  return (chunk) => {
    rest += chunk;
    const lines = rest.split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) onLine(line.replace(/\r$/, ''));
  };
}

/**
 * Renders `job` with `found`: writes the job directory, runs Blender in it,
 * reports progress, and returns the PNG or why there is none. Never throws;
 * the directory is removed whatever happened.
 */
export async function renderInBlender(
  env: BlenderEnv,
  found: FoundBlender,
  job: RenderJob,
  onProgress: (progress: RenderProgress) => void,
  signal: RenderSignal,
  now: () => number = Date.now,
): Promise<RenderResult> {
  if (job.obj.length > MAX_OBJ_CHARS) {
    return { ok: false, message: 'The model is too large to render.' };
  }
  const path = env.platform === 'win32' ? win32 : posix;
  const dir = path.join(env.tempDir, `${RENDER_PREFIX}${randomBytes(4).toString('hex')}`);
  try {
    env.prepareDir(dir);
    env.writeFile(path.join(dir, 'model.obj'), job.obj);
    env.writeFile(path.join(dir, 'model.mtl'), job.mtl);
    env.writeFile(path.join(dir, 'job.json'), JSON.stringify(jobFile(job)));
    env.writeFile(path.join(dir, 'render.py'), renderScript);
    if (signal.cancelled) return cancelled();
    let result = await run(env, found, dir, job, onProgress, signal, now);
    if (!result.ok && result.crashed && job.quality === 'draft' && !signal.cancelled) {
      // EEVEE crashes Blender where there is no usable GPU (virtual machines,
      // remote desktops); the draft is rendered again with Cycles.
      env.writeFile(path.join(dir, 'job.json'), JSON.stringify(jobFile(job, false)));
      result = await run(env, found, dir, job, onProgress, signal, now);
    }
    if (!result.ok) {
      const { crashed: _, ...plain } = result;
      return plain;
    }
    // The script writes `out.png`; Blender's own render (`-f 1`) names the frame.
    const png = env.readFile(path.join(dir, 'out.png')) ?? env.readFile(path.join(dir, 'out1.png'));
    if (!png || png.byteLength === 0) {
      return { ok: false, message: 'Blender finished without writing the picture.' };
    }
    return { ok: true, png };
  } catch (error) {
    return { ok: false, message: describe(error) };
  } finally {
    try {
      env.removeDir(dir);
    } catch {
      // Best effort: the OS clears its temp directory eventually.
    }
  }
}

const cancelled = (): RenderResult => ({
  ok: false,
  cancelled: true,
  message: 'Render cancelled.',
});

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message ? `Couldn't render: ${message}` : "Couldn't render.";
}

/** `crashed`: Blender died without the script's own error line. */
type RunResult = RenderResult & { crashed?: boolean };

/** Runs Blender in `dir` and resolves when it exits; `ok` means exit 0. */
function run(
  env: BlenderEnv,
  found: FoundBlender,
  dir: string,
  job: RenderJob,
  onProgress: (progress: RenderProgress) => void,
  signal: RenderSignal,
  now: () => number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    // Draft renders in the script (seconds, with its EEVEE → Cycles fallback);
    // the slow qualities let Blender render after the script so it prints progress.
    const own = job.quality === 'draft' ? [] : ['-f', '1'];
    const [command, args] = launchCommand(
      found,
      [
        '-b',
        '--factory-startup',
        '-noaudio',
        '--python',
        (env.platform === 'win32' ? win32 : posix).join(dir, 'render.py'),
        ...own,
        '--',
        'job.json',
        'out.png',
      ],
      dir,
    );
    let child: RenderProcess;
    try {
      child = env.spawn(command, args, dir);
    } catch {
      resolve({ ok: false, message: "Couldn't start Blender." });
      return;
    }
    signal.process = child;
    let scriptError: string | undefined;
    let lastStderr = '';
    let lastSent = { fraction: -1, at: -Infinity, phase: '' };
    const report = (progress: RenderProgress) => {
      const at = now();
      const phaseChanged = progress.phase !== lastSent.phase;
      if (!phaseChanged && progress.fraction === lastSent.fraction) return;
      if (!phaseChanged && at - lastSent.at < PROGRESS_INTERVAL_MS) return;
      lastSent = { fraction: progress.fraction, at, phase: progress.phase };
      onProgress(progress);
    };
    report({ fraction: 0, phase: 'starting' });
    child.onStdout(
      lineReader((line) => {
        if (line.startsWith('EXTRUDO ERROR '))
          scriptError = line.slice('EXTRUDO ERROR '.length).trim();
        const progress = progressOf(line);
        if (progress) report(progress);
      }),
    );
    child.onStderr(
      lineReader((line) => {
        if (line.trim()) lastStderr = line.trim();
      }),
    );
    let done = false;
    const finish = (result: RunResult) => {
      if (done) return;
      done = true;
      signal.process = undefined;
      resolve(result);
    };
    child.on('error', () => finish({ ok: false, message: "Couldn't start Blender." }));
    child.on('exit', (code) => {
      if (signal.cancelled) return finish(cancelled());
      if (code === 0) return finish({ ok: true, png: new Uint8Array() });
      if (scriptError) return finish({ ok: false, message: scriptError });
      const exit = `code ${code ?? 'unknown'}`;
      const message = CRASH_LINE.test(lastStderr)
        ? `Blender crashed (exit ${exit}).`
        : lastStderr.slice(0, 300) || `Blender exited with ${exit}.`;
      finish({ ok: false, message, crashed: true });
    });
  });
}

/** Removes every job directory left in the temp directory (on quit); best effort. */
export function cleanupRenderFiles(env: BlenderEnv): void {
  try {
    const path = env.platform === 'win32' ? win32 : posix;
    for (const name of env.glob(env.tempDir, RENDER_PREFIX)) {
      env.removeDir(path.join(env.tempDir, name));
    }
  } catch {
    // A Blender still holds a file (Windows): the OS clears its temp directory later.
  }
}

/** The real environment, with the preference read now. */
export function nodeBlenderEnv(tempDir: string, override: string | undefined): BlenderEnv {
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
  const path = process.platform === 'win32' ? win32 : posix;
  return {
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
    exists,
    glob(dir, prefix) {
      try {
        return readdirSync(dir).filter((entry) => entry.startsWith(prefix));
      } catch {
        return [];
      }
    },
    which(name) {
      const names = process.platform === 'win32' ? [`${name}.exe`, name] : [name];
      const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
      for (const dir of dirs) {
        for (const candidate of names) {
          const full = path.join(dir, candidate);
          if (runnable(full)) return full;
        }
      }
      return undefined;
    },
    flatpakInfo(id) {
      try {
        return spawnSync('flatpak', ['info', id], { stdio: 'ignore', timeout: 3000 }).status === 0;
      } catch {
        return false;
      }
    },
    run(command, args, timeoutMs) {
      const result = spawnSync(command, args, {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
      });
      return { code: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
    },
    spawn: (command, args, cwd) =>
      wrap(spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })),
    tempDir,
    override,
    prepareDir(dir) {
      // Not recursive: the temp directory exists, and a pre-planted job directory
      // (however unlikely the random name) must fail here rather than be reused.
      mkdirSync(dir, { mode: 0o700 });
      // /tmp is shared: the directory must be a real one of ours, not a link planted there.
      const info = lstatSync(dir);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error('The render directory is not a plain directory.');
      }
      if (process.platform !== 'win32') {
        if (info.uid !== process.getuid?.()) throw new Error('The render directory is not ours.');
        chmodSync(dir, 0o700);
      }
    },
    writeFile(file, text) {
      rmSync(file, { force: true });
      writeFileSync(file, text, { mode: 0o600, flag: 'wx' });
    },
    readFile(file) {
      try {
        return new Uint8Array(readFileSync(file));
      } catch {
        return undefined;
      }
    },
    removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
  };
}

/** A child process as the render watches it: text streams, exit, and a kill that takes the tree. */
function wrap(child: ChildProcess): RenderProcess {
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  return {
    onStdout: (listener) => void child.stdout?.on('data', (chunk) => listener(String(chunk))),
    onStderr: (listener) => void child.stderr?.on('data', (chunk) => listener(String(chunk))),
    on: (event, listener) => child.on(event, listener as (...args: unknown[]) => void),
    kill() {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        child.kill();
      }
    },
  };
}
