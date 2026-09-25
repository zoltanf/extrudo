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
    ['no document', zipSync({ 'manifest.json': strToU8('{"format":"extrudo"}') }), 'damaged'],
    [
      'a broken document',
      zipSync({
        'manifest.json': strToU8('{"format":"extrudo"}'),
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

  it('passes on core errors for documents from a newer Extrudo', () => {
    const newer = { ...doc(), formatVersion: FORMAT_VERSION + 1 };
    const bytes = zipSync({
      'manifest.json': strToU8('{"format":"extrudo"}'),
      'document.json': strToU8(JSON.stringify(newer)),
    });
    expect(() => readArchive(bytes)).toThrow(DocumentLoadError);
  });
});
