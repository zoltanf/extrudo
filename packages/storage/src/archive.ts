/**
 * The `.extrudo` file: a zip with a manifest, the document, an optional
 * thumbnail, the project's versions (docs/02-architecture.md §6.2, ADR-0036)
 * and the attachments its document or a version names (ADR-0061 §2).
 */
import {
  attachmentHashes,
  type ExtrudoDocument,
  FORMAT_NAME,
  FORMAT_VERSION,
  type LoadResult,
  loadDocument,
} from '@extrudo/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { SHA256_PATTERN, sha256Hex } from './sha256';
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
  /**
   * The `attachments/` entries, by SHA-256: the bytes of the files the
   * document and the versions name (ADR-0061 §2). An entry whose bytes don't
   * hash to its name is left out (`damagedAttachments`) and the file still
   * opens; `attachmentNotices` words both that and a file that is simply not
   * there.
   */
  attachments: Map<string, Uint8Array>;
  /** Entry names (the hashes) whose bytes didn't match. */
  damagedAttachments: string[];
}

const MANIFEST = 'manifest.json';
const DOCUMENT = 'document.json';
const THUMBNAIL = 'thumbnail.png';
const VERSION_INDEX = 'versions/index.json';
const versionFile = (n: number) => `versions/${n}.json`;
/** The folder of content-addressed files, each named by its SHA-256 (ADR-0061 §2). */
export const ATTACHMENT_FOLDER = 'attachments';
const attachmentFile = (sha256: string) => `${ATTACHMENT_FOLDER}/${sha256}`;

/**
 * Packs a document (with its thumbnail, versions and the attachment bytes the
 * document or a version names) into `.extrudo` bytes.
 */
export function writeArchive(
  doc: ExtrudoDocument,
  thumbnail?: Uint8Array,
  versions: readonly StoredVersion[] = [],
  attachments: ReadonlyMap<string, Uint8Array> = new Map(),
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
    // Fonts are already compressed, so they are stored, not deflated.
    ...Object.fromEntries(
      [...attachments].map(([sha256, bytes]) => [attachmentFile(sha256), [bytes, { level: 0 }]]),
    ),
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
  const { attachments, damagedAttachments } = readAttachments(entries);
  return {
    ...result,
    // A newer container (the manifest) counts as a newer file even if its document isn't.
    loadedVersion: Math.max(result.loadedVersion, manifest.formatVersion as number),
    manifest: manifest as Manifest,
    ...(thumbnail ? { thumbnail } : {}),
    versions: readVersions(entries),
    attachments,
    damagedAttachments,
  };
}

/**
 * The `attachments/` entries that are really the file they name. A file whose
 * bytes don't hash to its name is left out rather than trusted: it is named
 * by content everywhere else (ADR-0061 §1).
 */
function readAttachments(entries: Record<string, Uint8Array>): {
  attachments: Map<string, Uint8Array>;
  damagedAttachments: string[];
} {
  const attachments = new Map<string, Uint8Array>();
  const damagedAttachments: string[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith(`${ATTACHMENT_FOLDER}/`)) continue;
    const sha256 = name.slice(ATTACHMENT_FOLDER.length + 1);
    if (!SHA256_PATTERN.test(sha256) || sha256Hex(bytes) !== sha256) {
      damagedAttachments.push(sha256);
      continue;
    }
    attachments.set(sha256, bytes);
  }
  return { attachments, damagedAttachments };
}

/**
 * What to tell the user about an archive's attachments (ADR-0061 §2): a file
 * that is damaged is left out, and a design whose document names a file the
 * archive doesn't carry opens without it. Both are notices, not errors: only
 * fonts are attachments so far, so both are worded as fonts (other media
 * types come with P4-06 and need their own wording).
 */
export function attachmentNotices(archive: Archive): string[] {
  const notices: string[] = [];
  const damaged = archive.damagedAttachments.length;
  if (damaged > 0) {
    notices.push(
      `${damaged} ${damaged === 1 ? 'file' : 'files'} in this Extrudo file ${damaged === 1 ? 'is' : 'are'} damaged (its content doesn't match its name) and ${damaged === 1 ? 'was' : 'were'} left out.`,
    );
  }
  const missing = missingAttachments(archive);
  if (missing > 0) {
    notices.push(
      `${missing} ${missing === 1 ? 'font is' : 'fonts are'} missing from the file; ${missing === 1 ? 'its' : 'their'} texts show without letters.`,
    );
  }
  return notices;
}

/** How many distinct files the documents name that the archive doesn't carry. */
function missingAttachments(archive: Archive): number {
  const have = new Set(archive.attachments.keys());
  const wanted = new Set<string>();
  for (const doc of [archive.doc, ...archive.versions.map((v) => v.doc)]) {
    for (const hash of attachmentHashes(doc)) wanted.add(hash);
  }
  return [...wanted].filter((hash) => !have.has(hash)).length;
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
