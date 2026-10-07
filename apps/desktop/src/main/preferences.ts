/**
 * Per-user preferences on disk (P6-01, ADR-0075 §3): one JSON file under
 * `userData`, read once by the main process and written debounced, so a slider
 * drag or a theme toggle doesn't hit the disk on every change. The preload
 * reads the whole map synchronously (the `Preferences` interface is
 * synchronous) and writes go through `set`, which updates the map and schedules
 * the write. `flush` writes at once (the app calls it before quitting).
 *
 * Free of Electron, so it is unit-tested over a temp file.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

export interface PreferencesFileOptions {
  /** How long `set` waits before writing; defaults to 300 ms. */
  debounceMs?: number;
}

export interface PreferencesFile {
  read(): Record<string, unknown>;
  set(key: string, value: unknown): void;
  flush(): void;
}

function readValues(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Missing or damaged: preferences are a convenience, start empty.
    return {};
  }
}

function writeAtomic(file: string, values: Record<string, unknown>): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  // Write and flush the temp file, then rename: the rename is the commit, and
  // a partial file must never replace the old one (P6-01's review).
  const handle = openSync(temp, 'w');
  try {
    writeSync(handle, `${JSON.stringify(values, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  try {
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Already gone.
    }
    throw error;
  }
}

export function createPreferencesFile(
  file: string,
  options: PreferencesFileOptions = {},
): PreferencesFile {
  const values = readValues(file);
  let timer: NodeJS.Timeout | undefined;
  return {
    read: () => values,
    set(key, value) {
      values[key] = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        writeAtomic(file, values);
      }, options.debounceMs ?? 300);
      // The process should not stay alive just to flush a preference.
      timer.unref?.();
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      writeAtomic(file, values);
    },
  };
}
