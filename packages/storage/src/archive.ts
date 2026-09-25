/**
 * The `.extrudo` file: a zip with a manifest, the document and an optional
 * thumbnail (docs/02-architecture.md §6.2). Attachments and the geometry
 * cache come with the features that need them.
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

export interface Manifest {
  format: typeof FORMAT_NAME;
  formatVersion: number;
  appVersion: string;
  created: string;
  units: string;
}

export interface Archive extends LoadResult {
  manifest: Manifest;
  thumbnail?: Uint8Array;
}

const MANIFEST = 'manifest.json';
const DOCUMENT = 'document.json';
const THUMBNAIL = 'thumbnail.png';

/** Packs a document (and its thumbnail) into `.extrudo` bytes. */
export function writeArchive(doc: ExtrudoDocument, thumbnail?: Uint8Array): Uint8Array {
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
  const raw = parseJson(entries[DOCUMENT]);
  if (raw === undefined) {
    throw new ArchiveError(
      'damaged',
      'This Extrudo file is damaged: the document is missing or unreadable.',
    );
  }
  const result = loadDocument(raw);
  const thumbnail = entries[THUMBNAIL];
  return { ...result, manifest: manifest as Manifest, ...(thumbnail ? { thumbnail } : {}) };
}

function parseJson(bytes: Uint8Array | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return undefined;
  }
}
