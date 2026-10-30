/**
 * Converting other CAD files to STEP with the bundled cadmpeg (P6-19,
 * ADR-0115 §2). Pure over an injected environment like `blender.ts`, so the
 * lookup and the whole conversion are unit-tested on Linux; the real
 * environment is `nodeCadmpegEnv` at the bottom.
 *
 * A conversion is a directory `<temp>/extrudo-cadmpeg/<uuid>` (mode 0700): the
 * input under a sanitised name, then `cadmpeg convert <name> -o <base>.step`
 * without a shell and with that directory as its working directory. The
 * result is the STEP's bytes, and the directory is removed afterwards
 * whatever happened.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, posix, win32 } from 'node:path';
import {
  type CadConvertResult,
  type CadFile,
  type CadmpegStatus,
  isConvertibleCad,
  stepNameFor,
} from '@extrudo/web/platform/cad';
import { type RenderProcess, wrap } from './blender';

/** The slice of a running cadmpeg the conversion watches (the shape of a render's). */
export type ConvertProcess = RenderProcess;

export interface CadmpegEnv {
  platform: NodeJS.Platform;
  exists(path: string): boolean;
  /** The executable `name` resolves to on `PATH`, if any. */
  which(name: string): string | undefined;
  /** `cadmpeg --version` to completion with a timeout; text and exit code. */
  run(command: string, args: string[], timeoutMs: number): { code: number | null; output: string };
  /** The converter as a child process: stdout/stderr text, exit, kill. */
  spawn(command: string, args: string[], cwd: string): ConvertProcess;
  tempDir: string;
  /** `process.resourcesPath` when packaged, else undefined. */
  resourcesPath: string | undefined;
  /** The dev checkout's `apps/desktop/vendor/cadmpeg`, else undefined. */
  devVendorDir: string | undefined;
  /** The `cadmpeg.path` preference, or undefined. */
  override: string | undefined;
  /** Creates `dir` (mode 0o700) under a parent of ours; refuses one that already exists. */
  prepareDir(dir: string): void;
  writeFile(path: string, bytes: Uint8Array): void;
  /** The file's bytes, or undefined when it isn't there. */
  readFile(path: string): Uint8Array | undefined;
  /** The file's size, or undefined when it isn't there. */
  fileSize(path: string): number | undefined;
  removeDir(dir: string): void;
}

/** Conversions run in `<temp>/<CADMPEG_DIR>/<uuid>`. */
export const CADMPEG_DIR = 'extrudo-cadmpeg';
export const CONVERT_TIMEOUT_MS = 120_000;
export const MAX_INPUT_BYTES = 100 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
/** stdout and stderr are each kept up to this; the rest is dropped. */
export const MAX_LOG_BYTES = 64 * 1024;
/** How long `cadmpeg --version` may take. */
export const VERSION_TIMEOUT_MS = 10_000;

export const NOT_AVAILABLE =
  "The converter for other CAD files isn't available in this build. Set cadmpeg.path in preferences.json to a cadmpeg binary.";

const pathOf = (env: CadmpegEnv) => (env.platform === 'win32' ? win32 : posix);
const exeName = (env: CadmpegEnv) => (env.platform === 'win32' ? 'cadmpeg.exe' : 'cadmpeg');

/** The binary: the preference, then the packaged one, the dev checkout's, then `PATH`. */
export function findCadmpeg(env: CadmpegEnv): string | undefined {
  const path = pathOf(env);
  const override = env.override?.trim();
  const candidates = [
    override,
    env.resourcesPath && path.join(env.resourcesPath, 'cadmpeg', exeName(env)),
    env.devVendorDir && path.join(env.devVendorDir, exeName(env)),
  ];
  for (const candidate of candidates) if (candidate && env.exists(candidate)) return candidate;
  return env.which('cadmpeg');
}

/** Where the converter is and its version, or why there is none. */
export function cadmpegStatus(env: CadmpegEnv): CadmpegStatus {
  const path = findCadmpeg(env);
  if (!path) return { found: false, message: NOT_AVAILABLE };
  try {
    const { code, output } = env.run(path, ['--version'], VERSION_TIMEOUT_MS);
    const version = /^cadmpeg (\S+)/m.exec(output)?.[1];
    if (code === 0 && version) return { found: true, path, version };
  } catch {
    // Falls through: a binary that can't say its version is no use.
  }
  return { found: false, path, message: `${path} didn't answer --version.` };
}

/**
 * The name the input is written under: the base reduced to `[A-Za-z0-9._-]`
 * (other runs become one `_`, leading and trailing `._-` are dropped, so it
 * can't read as an option; empty → `model`; at most 100 characters), the
 * extension in lower case. Undefined for a file that isn't convertible.
 */
export function safeInputName(name: string): string | undefined {
  if (!isConvertibleCad(name)) return undefined;
  const dot = name.lastIndexOf('.');
  const extension = name.slice(dot).toLowerCase();
  const base = name
    .slice(0, dot)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100)
    .replace(/[._-]+$/, '');
  return `${base || 'model'}${extension}`;
}

/** Keeps the first `MAX_LOG_BYTES` of a stream, dropping the rest. */
function capped(): { add(chunk: string): void; text(): string } {
  let text = '';
  return {
    add(chunk) {
      if (text.length < MAX_LOG_BYTES) text += chunk.slice(0, MAX_LOG_BYTES - text.length);
    },
    text: () => text,
  };
}

/**
 * Converts `file` to STEP: refuses what isn't convertible or is too large,
 * then runs cadmpeg in a fresh directory and returns the STEP or why there is
 * none. Never throws; the directory is removed whatever happened.
 */
export async function convertWithCadmpeg(
  env: CadmpegEnv,
  file: CadFile,
  timeoutMs = CONVERT_TIMEOUT_MS,
): Promise<CadConvertResult> {
  const inputName = safeInputName(file.name);
  if (!inputName) return { ok: false, message: `${file.name} isn't a file Extrudo converts.` };
  if (file.bytes.byteLength > MAX_INPUT_BYTES) {
    return { ok: false, message: `${file.name} is too large to convert (the limit is 100 MB).` };
  }
  const binary = findCadmpeg(env);
  if (!binary) return { ok: false, message: NOT_AVAILABLE };
  const path = pathOf(env);
  const outputName = `${inputName.slice(0, inputName.lastIndexOf('.'))}.step`;
  const dir = path.join(env.tempDir, CADMPEG_DIR, randomUUID());
  try {
    env.prepareDir(dir);
    env.writeFile(path.join(dir, inputName), file.bytes);
    const failure = await run(
      env,
      binary,
      ['convert', inputName, '-o', outputName],
      dir,
      timeoutMs,
    );
    if (failure) return { ok: false, message: failure };
    const output = path.join(dir, outputName);
    const size = env.fileSize(output);
    if (size === undefined) return { ok: false, message: 'cadmpeg finished without a STEP file.' };
    if (size > MAX_OUTPUT_BYTES) {
      return { ok: false, message: 'The converted STEP file is too large (over 100 MB).' };
    }
    const bytes = env.readFile(output);
    if (!bytes) return { ok: false, message: 'cadmpeg finished without a STEP file.' };
    return { ok: true, name: stepNameFor(file.name), bytes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message ? `Couldn't convert: ${message}` : "Couldn't convert." };
  } finally {
    try {
      env.removeDir(dir);
    } catch {
      // Best effort: the leftovers go on quit (`cleanupCadmpegFiles`).
    }
  }
}

/** Runs cadmpeg in `dir`; resolves with why it failed, or undefined after exit 0. */
function run(
  env: CadmpegEnv,
  command: string,
  args: string[],
  dir: string,
  timeoutMs: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let child: ConvertProcess;
    try {
      child = env.spawn(command, args, dir);
    } catch {
      resolve("Couldn't start cadmpeg.");
      return;
    }
    const stdout = capped();
    const stderr = capped();
    child.onStdout(stdout.add);
    child.onStderr(stderr.add);
    let done = false;
    const finish = (result: string | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(`The conversion took longer than ${Math.round(timeoutMs / 60_000)} minutes.`);
    }, timeoutMs);
    child.on('error', () => finish("Couldn't start cadmpeg."));
    child.on('exit', (code) => {
      if (code === 0) return finish(undefined);
      const last = stderr
        .text()
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .pop();
      finish(last?.slice(0, 300) || `cadmpeg exited with code ${code ?? 'unknown'}.`);
    });
  });
}

/** Removes every conversion directory left in the temp directory (on quit); best effort. */
export function cleanupCadmpegFiles(env: CadmpegEnv): void {
  try {
    env.removeDir(pathOf(env).join(env.tempDir, CADMPEG_DIR));
  } catch {
    // A cadmpeg still holds a file (Windows): the OS clears its temp directory later.
  }
}

/** A directory that is ours: a real one (not a link planted in the shared temp), owned by us. */
function checkOwnDir(dir: string): void {
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('The conversion directory is not a plain directory.');
  }
  if (process.platform !== 'win32') {
    if (info.uid !== process.getuid?.()) throw new Error('The conversion directory is not ours.');
    chmodSync(dir, 0o700);
  }
}

/** The real environment, with the preference read now. */
export function nodeCadmpegEnv(
  tempDir: string,
  override: string | undefined,
  resourcesPath: string | undefined,
  devVendorDir: string | undefined,
): CadmpegEnv {
  const path = process.platform === 'win32' ? win32 : posix;
  const isFile = (file: string) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  };
  return {
    platform: process.platform,
    exists: isFile,
    which(name) {
      const names = process.platform === 'win32' ? [`${name}.exe`, name] : [name];
      for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
        for (const candidate of names) {
          const full = path.join(dir, candidate);
          if (isFile(full)) return full;
        }
      }
      return undefined;
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
    resourcesPath,
    devVendorDir,
    override,
    prepareDir(dir) {
      // The shared parent is made once and must be ours; the job directory is
      // never reused (not recursive: a pre-planted one fails here).
      const parent = dirname(dir);
      mkdirSync(parent, { recursive: true, mode: 0o700 });
      checkOwnDir(parent);
      mkdirSync(dir, { mode: 0o700 });
      checkOwnDir(dir);
    },
    writeFile(file, bytes) {
      writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
    },
    readFile(file) {
      try {
        return new Uint8Array(readFileSync(file));
      } catch {
        return undefined;
      }
    },
    fileSize(file) {
      try {
        const info = statSync(file);
        return info.isFile() ? info.size : undefined;
      } catch {
        return undefined;
      }
    },
    removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
  };
}
