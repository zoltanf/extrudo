/**
 * The `.extrudo-plugin` file (P6-03, ADR-0077 §1): a zip of `plugin.json` (the
 * manifest, core's `PluginManifestSchema`), the module it names (`main.ts` or
 * `main.js`) and optionally `README.md` and `LICENSE`.
 *
 * Both the app (installing a plugin) and the kernel worker (running a design's
 * copy of one) read it through `readPluginFile`, so a file is refused for the
 * same reasons everywhere: larger than 1 MB, more than 4 MB unpacked (counted
 * as it inflates, so a header that lies costs nothing), more than 64 entries,
 * an entry whose path leaves the zip's root (`../`, an absolute path, a backslash or a
 * drive letter), no `plugin.json` or no module, a manifest the schema refuses,
 * or a module longer than 200,000 characters. This module needs nothing but
 * fflate and core, so the kernel imports it as `@extrudo/storage/plugin`.
 */
import {
  PLUGIN_MANIFEST_FILE,
  PLUGIN_MAX_CODE,
  type PluginManifest,
  parsePluginManifest,
} from '@extrudo/core';
import { strFromU8, strToU8, Unzip, UnzipInflate, UnzipPassThrough, zipSync } from 'fflate';

/** The largest plugin file there is (ADR-0077 §1: code and text, no assets). */
export const MAX_PLUGIN_BYTES = 1024 * 1024;

/** How much a plugin file may hold unpacked: four times its own limit. */
export const MAX_PLUGIN_UNPACKED_BYTES = 4 * MAX_PLUGIN_BYTES;

/** A plugin file as the app and the kernel read it. */
export interface PluginFile {
  manifest: PluginManifest;
  /** The module's source, `main.ts` or `main.js` as the manifest names it. */
  code: string;
  /** What the module is written in, from its name. */
  language: 'ts' | 'js';
  /** `README.md`, when the file has one: what the Plugins dialog shows. */
  readme?: string;
  /** `LICENSE`, when the file has one. */
  license?: string;
}

/** A plugin file that can't be read, with the reason in the user's words. */
export class PluginFileError extends Error {
  override readonly name = 'PluginFileError';
}

/** The most entries a plugin file may hold. */
export const MAX_PLUGIN_ENTRIES = 64;

/** `README.md` and `LICENSE` are shown as one text each: a quarter of a MB at most. */
export const MAX_PLUGIN_TEXT_BYTES = 256 * 1024;

/** The compressed bytes pushed at a time: a block inflates to at most ~1,032 times that. */
const PUSH_CHUNK = 1024;

const README = 'README.md';
const LICENSE = 'LICENSE';

/**
 * Reads a plugin file. Throws `PluginFileError` for a file that isn't one, and
 * core's `PluginManifestError` (with the manifest's path) for a manifest the
 * schema refuses.
 */
export function readPluginFile(bytes: Uint8Array): PluginFile {
  if (bytes.byteLength > MAX_PLUGIN_BYTES) {
    throw new PluginFileError('This plugin file is larger than 1 MB.');
  }
  const entries = unpack(bytes);
  const text = (name: string): string | undefined => {
    const entry = entries[name];
    return entry === undefined ? undefined : strFromU8(entry);
  };
  const manifestText = text(PLUGIN_MANIFEST_FILE);
  if (manifestText === undefined) {
    throw new PluginFileError(`This plugin file has no ${PLUGIN_MANIFEST_FILE}.`);
  }
  const manifest = parsePluginManifest(manifestText);
  const code = text(manifest.main);
  if (code === undefined) {
    throw new PluginFileError(
      `This plugin file has no ${manifest.main}, which its ${PLUGIN_MANIFEST_FILE} names.`,
    );
  }
  if (code.length > PLUGIN_MAX_CODE) {
    throw new PluginFileError(
      `${manifest.main} is longer than ${PLUGIN_MAX_CODE.toLocaleString('en')} characters.`,
    );
  }
  for (const name of [README, LICENSE]) {
    if ((entries[name]?.byteLength ?? 0) > MAX_PLUGIN_TEXT_BYTES) {
      throw new PluginFileError(`${name} is larger than 256 kB.`);
    }
  }
  const readme = text(README);
  const license = text(LICENSE);
  return {
    manifest,
    code,
    language: manifest.main === 'main.js' ? 'js' : 'ts',
    ...(readme !== undefined && { readme }),
    ...(license !== undefined && { license }),
  };
}

/** What `writePluginFile` packs. */
export interface PluginSource {
  /** The manifest, as `plugin.json` holds it (written as given, two-space JSON). */
  manifest: unknown;
  code: string;
  readme?: string;
  license?: string;
}

/**
 * The mtime of every entry, so the same plugin packed twice is the same bytes
 * (and the same attachment hash), as `.extrudo` files are (`archive.ts`).
 */
const PLUGIN_MTIME = new Date('2024-01-01T00:00:00Z');

/**
 * Packs a plugin file: for the tests, the example plugin and whoever writes
 * one. `main` is whichever the manifest names (`main.ts` unless it says
 * `main.js`). Nothing is checked here: `readPluginFile` is the check.
 */
export function writePluginFile(source: PluginSource): Uint8Array {
  const main = (source.manifest as { main?: unknown }).main === 'main.js' ? 'main.js' : 'main.ts';
  const files: Record<string, Uint8Array> = {
    [PLUGIN_MANIFEST_FILE]: strToU8(`${JSON.stringify(source.manifest, null, 2)}\n`),
    [main]: strToU8(source.code),
  };
  if (source.readme !== undefined) files[README] = strToU8(source.readme);
  if (source.license !== undefined) files[LICENSE] = strToU8(source.license);
  return zipSync(files, { mtime: PLUGIN_MTIME });
}

/**
 * Inflates the zip with fflate's streaming reader, counting the bytes that
 * really come out (a local header's `originalSize` is the file's claim, not a
 * fact). The compressed bytes go in `PUSH_CHUNK` at a time, because fflate
 * inflates whatever it is pushed in one go: a throw from `ondata` ends the work
 * at the chunk that passed the limit, so a bomb costs about 4 MB of inflating
 * whatever its headers say.
 */
function unpack(bytes: Uint8Array): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  let unpacked = 0;
  let count = 0;
  try {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    unzip.onfile = (file) => {
      if (!insideRoot(file.name)) {
        throw new PluginFileError(
          `This plugin file has an entry outside its folder: ${file.name}.`,
        );
      }
      count += 1;
      if (count > MAX_PLUGIN_ENTRIES) {
        throw new PluginFileError(`This plugin file has more than ${MAX_PLUGIN_ENTRIES} entries.`);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      file.ondata = (error, chunk, final) => {
        if (error) throw error;
        unpacked += chunk.byteLength;
        if (unpacked > MAX_PLUGIN_UNPACKED_BYTES) {
          throw new PluginFileError('This plugin file holds more than 4 MB unpacked.');
        }
        chunks.push(chunk);
        size += chunk.byteLength;
        if (final) {
          const joined = new Uint8Array(size);
          let at = 0;
          for (const part of chunks) {
            joined.set(part, at);
            at += part.byteLength;
          }
          entries[file.name] = joined;
        }
      };
      file.start();
    };
    for (let at = 0; at < bytes.byteLength; at += PUSH_CHUNK) {
      const end = Math.min(at + PUSH_CHUNK, bytes.byteLength);
      unzip.push(bytes.subarray(at, end), end === bytes.byteLength);
    }
    if (count === 0) throw new Error('no entries');
  } catch (error) {
    if (error instanceof PluginFileError) throw error;
    throw new PluginFileError("This isn't a plugin file: it isn't a zip archive.");
  }
  return entries;
}

/** Whether a zip entry's name stays inside the zip's root. */
function insideRoot(name: string): boolean {
  if (name.length === 0 || name.startsWith('/') || name.includes('\\')) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the check
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((part) => part !== '..');
}
