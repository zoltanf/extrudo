import { createDocument, DocumentLoadError, FORMAT_VERSION } from '@extrudo/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import v0 from '../../core/fixtures/v0-bracket.json' with { type: 'json' };
import { readArchive, writeArchive } from './archive';
import { ArchiveError } from './types';

const doc = () => createDocument({ name: 'Bracket', units: 'in', now: '2026-09-01T00:00:00.000Z' });

describe('.extrudo archives', () => {
  it('holds a manifest, the document and the thumbnail', () => {
    const bytes = writeArchive(doc(), new Uint8Array([1, 2, 3]));
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual([
      'document.json',
      'manifest.json',
      'thumbnail.png',
    ]);
    expect(JSON.parse(strFromU8(entries['manifest.json'] as Uint8Array))).toEqual({
      format: 'extrudo',
      formatVersion: FORMAT_VERSION,
      appVersion: '0.0.0',
      created: '2026-09-01T00:00:00.000Z',
      units: 'in',
    });
  });

  it('round-trips', () => {
    const d = doc();
    const archive = readArchive(writeArchive(d, new Uint8Array([7])));
    expect(archive.doc).toEqual(d);
    expect(archive.migrated).toBe(false);
    expect(archive.thumbnail).toEqual(new Uint8Array([7]));
    expect(readArchive(writeArchive(d)).thumbnail).toBeUndefined();
  });

  it('migrates old documents on the way in', () => {
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'extrudo', formatVersion: 0 })),
      'document.json': strToU8(JSON.stringify(v0)),
    });
    const archive = readArchive(bytes);
    expect(archive.migrated).toBe(true);
    expect(archive.loadedVersion).toBe(0);
    expect(archive.doc.name).toBe('Wall bracket');
  });

  it.each<[string, Uint8Array, string]>([
    ['not a zip', strToU8('hello'), 'not-a-zip'],
    ['a zip without a manifest', zipSync({ 'a.txt': strToU8('a') }), 'not-extrudo'],
    ['another format', zipSync({ 'manifest.json': strToU8('{"format":"other"}') }), 'not-extrudo'],
    [
      'no document',
      zipSync({ 'manifest.json': strToU8('{"format":"extrudo","formatVersion":1}') }),
      'damaged',
    ],
    [
      'a broken document',
      zipSync({
        'manifest.json': strToU8('{"format":"extrudo","formatVersion":1}'),
        'document.json': strToU8('{oops'),
      }),
      'damaged',
    ],
  ])('refuses %s', (_, bytes, code) => {
    expect(() => readArchive(bytes)).toThrow(ArchiveError);
    try {
      readArchive(bytes);
    } catch (error) {
      expect((error as ArchiveError).code).toBe(code);
    }
  });

  it('carries versions, and refuses a version the file lists but lacks', () => {
    const d = doc();
    const summary = { number: 3, description: 'fit', created: d.meta.created, name: 'Old' };
    const bytes = writeArchive(d, undefined, [{ summary, doc: { ...d, name: 'Old' } }]);
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
      'document.json',
      'manifest.json',
      'versions/3.json',
      'versions/index.json',
    ]);
    const archive = readArchive(bytes);
    expect(archive.versions).toEqual([{ summary, doc: { ...d, name: 'Old' } }]);
    expect(readArchive(writeArchive(d)).versions).toEqual([]);

    const entries = unzipSync(bytes);
    delete entries['versions/3.json'];
    expect(() => readArchive(zipSync(entries))).toThrow('version 3 is missing');
  });

  it("passes on core errors for documents from a newer Extrudo it can't read", () => {
    const newer = { ...doc(), formatVersion: FORMAT_VERSION + 1, features: 'reshaped' };
    const bytes = zipSync({
      'manifest.json': strToU8(`{"format":"extrudo","formatVersion":${FORMAT_VERSION + 1}}`),
      'document.json': strToU8(JSON.stringify(newer)),
    });
    expect(() => readArchive(bytes)).toThrow(DocumentLoadError);
  });

  it("checks the manifest's format version (P3-13)", () => {
    const d = doc();
    const file = (manifest: object, document: object = d) =>
      zipSync({
        'manifest.json': strToU8(JSON.stringify({ format: 'extrudo', ...manifest })),
        'document.json': strToU8(JSON.stringify(document)),
      });
    expect(() => readArchive(file({}))).toThrow(ArchiveError);
    expect(() => readArchive(file({ formatVersion: '1' }))).toThrow('no format version');
    expect(readArchive(file({ formatVersion: FORMAT_VERSION })).loadedVersion).toBe(FORMAT_VERSION);
    // A newer container counts as a newer file, even with a document this version reads.
    const newer = readArchive(file({ formatVersion: FORMAT_VERSION + 1 }));
    expect(newer.doc).toEqual(d);
    expect(newer.loadedVersion).toBe(FORMAT_VERSION + 1);
  });

  it('reads unknown keys leniently and lists them', () => {
    const d = doc();
    const raw = { ...d, formatVersion: FORMAT_VERSION + 1, lighting: 'studio' };
    const archive = readArchive(
      zipSync({
        'manifest.json': strToU8(`{"format":"extrudo","formatVersion":${FORMAT_VERSION + 1}}`),
        'document.json': strToU8(JSON.stringify(raw)),
      }),
    );
    expect(archive.doc).toEqual(d);
    expect(archive.dropped).toEqual(['lighting']);
  });
});
