/**
 * Version history on disk (FR-PRJ-03, P2-14, ADR-0036). A project's
 * versions sit next to its document:
 *
 *   projects/<id>/versions/index.json   { versions: VersionSummary[], next }, oldest first
 *   projects/<id>/versions/<n>.json.gz  the document as it was (gzipped JSON)
 *
 * A version is written before the index, so the index never lists a
 * version whose file wasn't written. In a `.extrudo` file the same index
 * sits at `versions/index.json` and each document at `versions/<n>.json`
 * (the zip compresses it). `next` is the number the next version gets:
 * numbers are never reused, even after the newest version was deleted
 * (P3-13); an index without it (older files) counts from the highest.
 *
 * Reading and rewriting the index happens under a lock per project
 * (`ProjectStoreOptions.lock`; the Web Locks API in the browser), so two
 * tabs saving versions at once can't drop each other's entry.
 */
import type { ExtrudoDocument } from '@extrudo/core';
import type { VersionSummary } from './types';

/** A version with its document (the `.extrudo` archive's form). */
export interface StoredVersion {
  summary: VersionSummary;
  doc: ExtrudoDocument;
}

/** The index file's content. `next` defaults to one past the highest number. */
export function writeVersionIndex(versions: readonly VersionSummary[], next?: number): unknown {
  return { versions, next: Math.max(next ?? 0, nextVersionNumber(versions)) };
}

/** The `next` an index file's parsed JSON records, if it is a usable one. */
export function readNextVersion(raw: unknown): number | undefined {
  const next = (raw as { next?: unknown } | undefined)?.next;
  return typeof next === 'number' && Number.isInteger(next) && next > 0 ? next : undefined;
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

/** The number the next version gets: past every listed one and at least `next`. */
export function nextVersionNumber(versions: readonly VersionSummary[], next = 1): number {
  return Math.max(next, versions.reduce((n, v) => Math.max(n, v.number), 0) + 1);
}
