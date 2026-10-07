/**
 * Rescue copies on disk (P6-01, ADR-0075 §3): one JSON file under `userData`
 * holding `{ <document id>: <document JSON> }`. Written **synchronously** on
 * the renderer's `pagehide` (through `sendSync`), because an async write would
 * not finish while the window is closing; read synchronously at startup by
 * `recoverRescued`. Free of Electron, so it is unit-tested over a temp file.
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

export interface RescueFile {
  put(id: string, raw: string): boolean;
  clear(id: string): void;
  list(): { id: string; raw: string }[];
}

function readCopies(file: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, raw] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof raw === 'string') out[id] = raw;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAtomic(file: string, copies: Record<string, string>): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  // Flush before rename; a failed rename removes the temp file (P6-01 review).
  const handle = openSync(temp, 'w');
  try {
    writeSync(handle, JSON.stringify(copies));
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

export function createRescueFile(file: string): RescueFile {
  const copies = readCopies(file);
  const save = () => writeAtomic(file, copies);
  return {
    put(id, raw) {
      const previous = copies[id];
      copies[id] = raw;
      try {
        save();
        return true;
      } catch {
        if (previous === undefined) delete copies[id];
        else copies[id] = previous;
        return false;
      }
    },
    clear(id) {
      if (!(id in copies)) return;
      delete copies[id];
      try {
        save();
      } catch {
        // The next start recovers it again; nothing else to do.
      }
    },
    list: () => Object.entries(copies).map(([id, raw]) => ({ id, raw })),
  };
}
