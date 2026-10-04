import {
  type AttachmentId,
  addAttachment,
  applyCommand,
  createDocument,
  DocumentLoadError,
  FORMAT_VERSION,
} from '@extrudo/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import v0 from '../../core/fixtures/v0-bracket.json' with { type: 'json' };
import { attachmentNotices, readArchive, writeArchive } from './archive';
import { sha256Hex } from './sha256';
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

describe('.extrudo attachments (P4-03b, ADR-0061 §2)', () => {
  const font = (seed: number) => {
    const bytes = new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 13 + seed) % 256));
    return { bytes, hash: sha256Hex(bytes) };
  };
  /** The document with one attachment recorded for a font's bytes. */
  const withFont = (id: string, bytes: Uint8Array) => {
    const d = doc();
    return applyCommand(
      d,
      addAttachment({
        id: id as AttachmentId,
        attachment: {
          name: 'Comic Neue Bold',
          fileName: 'ComicNeue-Bold.ttf',
          mediaType: 'font/ttf',
          sha256: sha256Hex(bytes),
          size: bytes.length,
        },
      }),
    ).doc;
  };
  /** The compression method of a zip entry: 0 stored, 8 deflated. */
  const methodOf = (zip: Uint8Array, name: string): number => {
    const letters = [...name].map((c) => c.charCodeAt(0));
    for (let i = 0; i + 30 + letters.length <= zip.length; i++) {
      const header = zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 3 && zip[i + 3] === 4;
      if (!header) continue;
      const here = [...zip.slice(i + 30, i + 30 + letters.length)].join();
      if (here === letters.join()) return (zip[i + 8] ?? 0) | ((zip[i + 9] ?? 0) << 8);
    }
    return -1;
  };

  it('carries the bytes a document names, stored not deflated', () => {
    const { bytes, hash } = font(1);
    const d = withFont('a1', bytes);
    const archive = readArchive(writeArchive(d, undefined, [], new Map([[hash, bytes]])));
    expect(archive.doc.attachments).toEqual(d.attachments);
    expect(archive.attachments.get(hash)).toEqual(bytes);
    expect(archive.damagedAttachments).toEqual([]);
    expect(
      Object.keys(unzipSync(writeArchive(d, undefined, [], new Map([[hash, bytes]])))).sort(),
    ).toEqual([`attachments/${hash}`, 'document.json', 'manifest.json']);
    // Fonts are already compressed: the entry is stored, the JSON deflated.
    const zip = writeArchive(d, undefined, [], new Map([[hash, bytes]]));
    expect(methodOf(zip, `attachments/${hash}`)).toBe(0);
    expect(methodOf(zip, 'document.json')).toBe(8);
  });

  it('has no attachments when the document names none', () => {
    const archive = readArchive(writeArchive(doc()));
    expect(archive.attachments.size).toBe(0);
    expect(archive.damagedAttachments).toEqual([]);
    expect(attachmentNotices(archive)).toEqual([]);
  });

  it('leaves out a file whose bytes are not what its name says', () => {
    const { bytes, hash } = font(2);
    const other = font(3);
    const d = withFont('a1', bytes);
    const entries = unzipSync(writeArchive(d, undefined, [], new Map([[hash, other.bytes]])));
    const archive = readArchive(zipSync(entries));
    expect(archive.attachments.size).toBe(0);
    expect(archive.damagedAttachments).toEqual([hash]);
    expect(archive.doc).toEqual(d);
    expect(attachmentNotices(archive)).toEqual([
      "1 file in this Extrudo file is damaged (its content doesn't match its name) and was left out.",
      '1 font is missing from the file; its texts show without letters.',
    ]);
  });

  it('leaves out an entry whose name is not a hash', () => {
    const d = doc();
    const bytes = writeArchive(d);
    const archive = readArchive(
      zipSync({ ...unzipSync(bytes), 'attachments/font.ttf': strToU8('x') }),
    );
    expect(archive.attachments.size).toBe(0);
    expect(archive.damagedAttachments).toEqual(['font.ttf']);
    expect(attachmentNotices(archive)).toHaveLength(1);
  });

  it('counts the fonts a file is missing, over the document and its versions', () => {
    const { bytes: one, hash: oneHash } = font(4);
    const { bytes: two, hash: twoHash } = font(5);
    const { bytes: three, hash: threeHash } = font(6);
    const early = withFont('a1', one);
    const later = applyCommand(
      withFont('a2', two),
      addAttachment({
        id: 'a3' as AttachmentId,
        attachment: {
          name: 'Fredoka One',
          fileName: 'fredoka.ttf',
          mediaType: 'font/ttf',
          sha256: threeHash,
          size: three.length,
        },
      }),
    ).doc;
    const summary = { number: 1, description: 'early', created: early.meta.created, name: 'Old' };
    const full = readArchive(
      writeArchive(later, undefined, [{ summary, doc: early }], new Map([[oneHash, one]])),
    );
    expect(attachmentNotices(full)).toEqual([
      '2 fonts are missing from the file; their texts show without letters.',
    ]);
    const none = readArchive(
      writeArchive(
        later,
        undefined,
        [{ summary, doc: early }],
        new Map([
          [oneHash, one],
          [twoHash, two],
          [threeHash, three],
        ]),
      ),
    );
    expect(attachmentNotices(none)).toEqual([]);
  });
});
