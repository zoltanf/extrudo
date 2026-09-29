/**
 * Version history on disk (FR-PRJ-03, P2-14, ADR-0036). A project's
 * versions sit next to its document:
 *
 *   projects/<id>/versions/index.json   { versions: VersionSummary[] }, oldest first
 *   projects/<id>/versions/<n>.json.gz  the document as it was (gzipped JSON)
 *
 * A version is written before the index, so the index never lists a
 * version whose file wasn't written. In a `.extrudo` file the same index
 * sits at `versions/index.json` and each document at `versions/<n>.json`
 * (the zip compresses it).
 */
import type { ExtrudoDocument } from '@extrudo/core';
import type { VersionSummary } from './types';

/** A version with its document (the `.extrudo` archive's form). */
export interface StoredVersion {
  summary: VersionSummary;
  doc: ExtrudoDocument;
}

/** The index file's content. */
export function writeVersionIndex(versions: readonly VersionSummary[]): unknown {
  return { versions };
}

/**
 * Reads an index file's parsed JSON: the summaries that are well formed,
 * oldest first, or `undefined` if it isn't an index at all.
 */
export function readVersionIndex(raw: unknown): VersionSummary[] | undefined {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { versions?: unknown }).versions)) {
    return undefined;
  }
  const out: VersionSummary[] = [];
  for (const v of (raw as { versions: unknown[] }).versions) {
    if (!v || typeof v !== 'object') continue;
    const { number, description, created, name } = v as Record<string, unknown>;
    if (
      typeof number === 'number' &&
      Number.isInteger(number) &&
      number > 0 &&
      typeof description === 'string' &&
      typeof created === 'string' &&
      typeof name === 'string'
    ) {
      out.push({ number, description, created, name });
    }
  }
  return out.sort((a, b) => a.number - b.number);
}

/** The number the next version gets. */
export function nextVersionNumber(versions: readonly VersionSummary[]): number {
  return versions.reduce((n, v) => Math.max(n, v.number), 0) + 1;
}
