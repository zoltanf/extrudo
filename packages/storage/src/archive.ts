/**
 * The `.extrudo` file: a zip with a manifest, the document, an optional
 * thumbnail and the project's versions (docs/02-architecture.md §6.2,
 * ADR-0036). Attachments and the geometry cache come with the features
 * that need them.
 */
import {
  type ExtrudoDocument,
  FORMAT_NAME,
  FORMAT_VERSION,
  type LoadResult,
  loadDocument,
} from '@extrudo/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { ArchiveError } from './types';
import { readVersionIndex, type StoredVersion, writeVersionIndex } from './versions';

export interface Manifest {
  format: typeof FORMAT_NAME;
  formatVersion: number;
  appVersion: string;
  created: string;
  units: string;
}

/**
 * `loadedVersion` is the newer of the manifest's and the document's format
 * version: a file from a newer Extrudo may keep an older document and still
 * carry parts (in the zip) this version doesn't read.
 */
export interface Archive extends LoadResult {
  manifest: Manifest;
  thumbnail?: Uint8Array;
  /** Saved versions, oldest first, each migrated and validated; none in older files. */
  versions: StoredVersion[];
}

const MANIFEST = 'manifest.json';
const DOCUMENT = 'document.json';
const THUMBNAIL = 'thumbnail.png';
const VERSION_INDEX = 'versions/index.json';
const versionFile = (n: number) => `versions/${n}.json`;

/** Packs a document (with its thumbnail and versions) into `.extrudo` bytes. */
export function writeArchive(
  doc: ExtrudoDocument,
  thumbnail?: Uint8Array,
  versions: readonly StoredVersion[] = [],
): Uint8Array {
  const manifest: Manifest = {
    format: FORMAT_NAME,
    formatVersion: FORMAT_VERSION,
    appVersion: doc.meta.appVersion,
    created: doc.meta.created,
    units: doc.settings.units,
  };
  const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);
  return zipSync({
    [MANIFEST]: json(manifest),
    [DOCUMENT]: json(doc),
    // PNG is already compressed.
    ...(thumbnail ? { [THUMBNAIL]: [thumbnail, { level: 0 }] } : {}),
    ...(versions.length > 0
      ? {
          [VERSION_INDEX]: json(writeVersionIndex(versions.map((v) => v.summary))),
          ...Object.fromEntries(versions.map((v) => [versionFile(v.summary.number), json(v.doc)])),
        }
      : {}),
  });
}

/**
 * Reads `.extrudo` bytes: checks the manifest, then loads the document
 * through core's migrations and validation (which throw `DocumentLoadError`).
 */
export function readArchive(bytes: Uint8Array): Archive {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new ArchiveError(
      'not-a-zip',
      "This isn't an Extrudo project file: it isn't a zip archive.",
    );
  }
  const manifest = parseJson(entries[MANIFEST]) as Partial<Manifest> | undefined;
  if (manifest?.format !== FORMAT_NAME) {
    throw new ArchiveError(
      'not-extrudo',
      "This zip isn't an Extrudo project: it has no Extrudo manifest.",
    );
  }
  if (!Number.isInteger(manifest.formatVersion)) {
    throw new ArchiveError(
      'damaged',
      'This Extrudo file is damaged: its manifest has no format version.',
    );
  }
  const raw = parseJson(entries[DOCUMENT]);
  if (raw === undefined) {
    throw new ArchiveError(
      'damaged',
      'This Extrudo file is damaged: the document is missing or unreadable.',
    );
  }
  const result = loadDocument(raw);
  const thumbnail = entries[THUMBNAIL];
  return {
    ...result,
    // A newer container (the manifest) counts as a newer file even if its document isn't.
    loadedVersion: Math.max(result.loadedVersion, manifest.formatVersion as number),
    manifest: manifest as Manifest,
    ...(thumbnail ? { thumbnail } : {}),
    versions: readVersions(entries),
  };
}

/** The archive's versions, each through core's migrations and validation. */
function readVersions(entries: Record<string, Uint8Array>): StoredVersion[] {
  const indexBytes = entries[VERSION_INDEX];
  if (!indexBytes) return [];
  const summaries = readVersionIndex(parseJson(indexBytes));
  if (!summaries) {
    throw new ArchiveError(
      'damaged',
      "This Extrudo file is damaged: its version list can't be read.",
    );
  }
  return summaries.map((summary) => {
    const raw = parseJson(entries[versionFile(summary.number)]);
    if (raw === undefined) {
      throw new ArchiveError(
        'damaged',
        `This Extrudo file is damaged: version ${summary.number} is missing or unreadable.`,
      );
    }
    return { summary, doc: loadDocument(raw).doc };
  });
}

function parseJson(bytes: Uint8Array | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return undefined;
  }
}
