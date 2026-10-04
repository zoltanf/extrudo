import {
  type AttachmentId,
  addAttachment,
  addParameter,
  applyCommand,
  createDocument,
  type DocumentId,
  type ExtrudoDocument,
  type ParameterId,
  removeAttachment,
} from '@extrudo/core';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { memoryFiles } from './files';
import { memoryIndex } from './idb';
import { createProjectStore, localLock } from './project-store';
import { sha256Hex } from './sha256';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_BYTES, ProjectNotFoundError } from './types';

function setup() {
  let clock = Date.parse('2026-09-25T10:00:00.000Z');
  let ids = 0;
  const files = memoryFiles();
  const store = createProjectStore({
    index: memoryIndex(),
    files,
    appVersion: '0.1.0',
    now: () => {
      clock += 1000;
      return new Date(clock).toISOString();
    },
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` as DocumentId,
  });
  return { store, files };
}

const doc = (name: string): ExtrudoDocument =>
  applyCommand(
    createDocument({ name, now: '2026-09-01T00:00:00.000Z' }),
    addParameter({
      parameter: {
        id: crypto.randomUUID() as ParameterId,
        name: 'wall',
        expression: '2.4 mm',
        unit: 'length',
      },
    }),
  ).doc;

const png = (...bytes: number[]) => new Blob([new Uint8Array([137, 80, 78, 71, ...bytes])]);

describe('ProjectStore', () => {
  it('opens a document a newer Extrudo saved, and says what it left out (P3-13)', async () => {
    const { store, files } = setup();
    const d = doc('Bracket');
    await store.save(d);
    const path = `projects/${d.id}/document.json`;
    const stored = JSON.parse(new TextDecoder().decode(await files.read(path)));
    await files.write(
      path,
      new TextEncoder().encode(JSON.stringify({ ...stored, formatVersion: 2, grid: { step: 5 } })),
    );
    const notices: string[] = [];
    const loaded = await store.load(d.id, { onNotice: (m) => notices.push(m) });
    expect(loaded.name).toBe('Bracket');
    expect(notices).toEqual([
      "This design was saved by a newer Extrudo (file format 2; this version reads 1). 1 setting this version doesn't know was left out. Saving here loses them; reload to update Extrudo first if you need them.",
    ]);
    // An ordinary load says nothing.
    await store.save(loaded);
    await store.load(d.id, { onNotice: (m) => notices.push(m) });
    expect(notices).toHaveLength(1);
  });

  it('imports a newer file, and says the file itself is unchanged', async () => {
    const { store } = setup();
    const d = { ...doc('Bracket'), formatVersion: 2, grid: { step: 5 } };
    const file = new Blob([
      zipSync({
        'manifest.json': strToU8('{"format":"extrudo","formatVersion":2}'),
        'document.json': strToU8(JSON.stringify(d)),
      }) as Uint8Array<ArrayBuffer>,
    ]);
    const notices: string[] = [];
    const summary = await store.importFile(file, { onNotice: (m) => notices.push(m) });
    expect(summary.name).toBe('Bracket');
    expect(notices[0]).toMatch(/left out\. The file itself is unchanged\.$/);
  });

  it('saves and loads a document, stamping modified and the app version', async () => {
    const { store } = setup();
    const d = doc('Bracket');
    const summary = await store.save(d);
    expect(summary).toMatchObject({ id: d.id, name: 'Bracket', hasThumbnail: false });
    expect(summary.created).toBe('2026-09-01T00:00:00.000Z');
    expect(summary.modified).toBe('2026-09-25T10:00:01.000Z');

    const loaded = await store.load(d.id);
    expect(loaded.parameters.map((p) => p.name)).toEqual(['wall']);
    expect(loaded.meta.modified).toBe(summary.modified);
    expect(loaded.meta.appVersion).toBe('0.1.0');
    // The caller's document is not touched.
    expect(d.meta.modified).toBe('2026-09-01T00:00:00.000Z');
  });

  it('lists projects, most recently modified first, and updates on save', async () => {
    const { store } = setup();
    const a = doc('A');
    const b = doc('B');
    await store.save(a);
    await store.save(b);
    expect((await store.list()).map((s) => s.name)).toEqual(['B', 'A']);
    await store.save({ ...a, name: 'A again' });
    expect((await store.list()).map((s) => s.name)).toEqual(['A again', 'B']);
  });

  it('renames, keeping everything else', async () => {
    const { store } = setup();
    const d = doc('Old');
    await store.save(d);
    const renamed = await store.rename(d.id, '  New name ');
    expect(renamed.name).toBe('New name');
    expect((await store.load(d.id)).name).toBe('New name');
    await expect(store.rename(d.id, '   ')).rejects.toThrow('needs a name');
  });

  it('duplicates with a new ID and name, copying the thumbnail', async () => {
    const { store } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await store.setThumbnail(d.id, png(1, 2, 3));
    const copy = await store.duplicate(d.id);
    expect(copy.id).not.toBe(d.id);
    expect(copy.name).toBe('Bracket copy');
    expect(copy.hasThumbnail).toBe(true);
    const loaded = await store.load(copy.id);
    expect(loaded.id).toBe(copy.id);
    expect(loaded.parameters).toEqual(d.parameters);
    expect(new Uint8Array(await ((await store.thumbnail(copy.id)) as Blob).arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    );
    expect(await store.list()).toHaveLength(2);
  });

  it('moves projects to the trash and back, and a save keeps them there', async () => {
    const { store } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await store.trash(d.id);
    expect((await store.get(d.id))?.trashed).toBeDefined();
    await store.save(d);
    expect((await store.get(d.id))?.trashed).toBeDefined();
    await store.restore(d.id);
    expect((await store.get(d.id))?.trashed).toBeUndefined();
  });

  it('purges a project and all its files', async () => {
    const { store, files } = setup();
    const keep = doc('Keep');
    const gone = doc('Gone');
    await store.save(keep);
    await store.save(gone);
    await store.setThumbnail(gone.id, png());
    await store.purge(gone.id);
    expect(files.paths()).toEqual([`projects/${keep.id}/document.json`]);
    expect(await store.list()).toHaveLength(1);
    await expect(store.load(gone.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('refuses unknown projects', async () => {
    const { store } = setup();
    const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' as DocumentId;
    await expect(store.load(id)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(store.trash(id)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(store.setThumbnail(id, png())).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(await store.thumbnail(id)).toBeNull();
  });

  it('says so when a listed project has lost its document', async () => {
    const { store, files } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await files.remove(`projects/${d.id}/document.json`);
    await expect(store.load(d.id)).rejects.toThrow('document is missing');
  });

  it('exports and imports a project; importing it again makes a copy', async () => {
    const { store } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await store.setThumbnail(d.id, png(9));
    const file = await store.exportFile(d.id);

    const other = setup().store;
    const imported = await other.importFile(file);
    expect(imported).toMatchObject({ id: d.id, name: 'Bracket', hasThumbnail: true });
    const loaded = await other.load(d.id);
    expect(loaded.parameters).toEqual(d.parameters);
    expect(loaded.features).toEqual(d.features);

    const again = await other.importFile(file);
    expect(again.id).not.toBe(d.id);
    expect(again.name).toBe('Bracket');
    expect(await other.list()).toHaveLength(2);
  });
});

describe('ProjectStore versions (P2-14)', () => {
  it('saves versions, lists them newest first and loads each as it was', async () => {
    const { store, files } = setup();
    const d = doc('Bracket');
    await store.save(d);
    expect(await store.versions(d.id)).toEqual([]);

    const v1 = await store.saveVersion(d, '  First fit  ');
    expect(v1).toEqual({
      number: 1,
      description: 'First fit',
      created: '2026-09-25T10:00:02.000Z',
      name: 'Bracket',
    });
    const later = { ...d, name: 'Bracket v2', parameters: [] };
    const v2 = await store.saveVersion(later, '');
    expect(v2.number).toBe(2);
    // Saving a version saves the document too.
    expect((await store.load(d.id)).name).toBe('Bracket v2');
    expect((await store.versions(d.id)).map((v) => [v.number, v.name])).toEqual([
      [2, 'Bracket v2'],
      [1, 'Bracket'],
    ]);

    const old = await store.loadVersion(d.id, 1);
    expect(old.name).toBe('Bracket');
    expect(old.parameters).toEqual(d.parameters);
    expect(old.meta.modified).toBe(v1.created);
    expect((await store.loadVersion(d.id, 2)).parameters).toEqual([]);
    expect(files.paths()).toEqual([
      `projects/${d.id}/document.json`,
      `projects/${d.id}/versions/1.json.gz`,
      `projects/${d.id}/versions/2.json.gz`,
      `projects/${d.id}/versions/index.json`,
    ]);

    // Purging takes the versions along.
    await store.purge(d.id);
    expect(files.paths()).toEqual([]);
  });

  it('refuses versions of unknown projects and says when one is missing or damaged', async () => {
    const { store, files } = setup();
    const d = doc('Bracket');
    await expect(store.saveVersion(d, 'x')).rejects.toBeInstanceOf(ProjectNotFoundError);
    await store.save(d);
    await store.saveVersion(d, 'x');
    await expect(store.loadVersion(d.id, 7)).rejects.toThrow(
      'Version 7 of this project is missing',
    );
    await files.write(`projects/${d.id}/versions/1.json.gz`, new Uint8Array([1, 2, 3]));
    await expect(store.loadVersion(d.id, 1)).rejects.toThrow(
      'Version 1 of this project is damaged',
    );
    await files.write(`projects/${d.id}/versions/index.json`, new TextEncoder().encode('{'));
    await expect(store.versions(d.id)).rejects.toThrow('version list is damaged');
  });

  it('exports versions in the .extrudo file and imports them, also into a copy', async () => {
    const { store } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await store.saveVersion({ ...d, name: 'Early' }, 'early');
    await store.saveVersion(d, 'late');
    const file = await store.exportFile(d.id);

    const other = setup().store;
    await other.importFile(file);
    expect((await other.versions(d.id)).map((v) => v.description)).toEqual(['late', 'early']);
    expect((await other.loadVersion(d.id, 1)).name).toBe('Early');

    const copy = await other.importFile(file);
    expect((await other.versions(copy.id)).map((v) => v.number)).toEqual([2, 1]);
    const early = await other.loadVersion(copy.id, 1);
    expect(early.id).toBe(copy.id);
    expect(early.name).toBe('Early');
  });

  it('deletes versions, and never gives a deleted number out again (P3-13)', async () => {
    const { store, files } = setup();
    const d = doc('Bracket');
    await store.save(d);
    for (const note of ['one', 'two', 'three']) await store.saveVersion(d, note);
    await store.deleteVersions(d.id, [3, 1, 99]);
    expect((await store.versions(d.id)).map((v) => [v.number, v.description])).toEqual([
      [2, 'two'],
    ]);
    expect(files.paths()).toEqual([
      `projects/${d.id}/document.json`,
      `projects/${d.id}/versions/2.json.gz`,
      `projects/${d.id}/versions/index.json`,
    ]);
    await expect(store.loadVersion(d.id, 3)).rejects.toThrow(
      'Version 3 of this project is missing',
    );
    // The newest was deleted, and still the next one is V4.
    expect((await store.saveVersion(d, 'four')).number).toBe(4);
    await store.deleteVersions(d.id, [2, 4]);
    expect(await store.versions(d.id)).toEqual([]);
    expect((await store.saveVersion(d, 'five')).number).toBe(5);
    await expect(store.deleteVersions(doc('Other').id, [1])).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('reads an index without `next` (written before P3-13) by its highest number', async () => {
    const { store, files } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await store.saveVersion(d, 'one');
    await store.saveVersion(d, 'two');
    const path = `projects/${d.id}/versions/index.json`;
    const { versions } = JSON.parse(new TextDecoder().decode(await files.read(path)));
    await files.write(path, new TextEncoder().encode(JSON.stringify({ versions })));
    expect((await store.saveVersion(d, 'three')).number).toBe(3);
  });

  /** Two stores over the same files and index: two tabs of one browser. */
  function twoTabs(lock?: ReturnType<typeof localLock>) {
    const files = memoryFiles();
    const index = memoryIndex();
    const tab = () => createProjectStore({ index, files, ...(lock ? { lock } : {}) });
    return [tab(), tab()] as const;
  }

  it('keeps every version when two tabs save at the same moment, holding a shared lock', async () => {
    const [a, b] = twoTabs(localLock());
    const d = doc('Bracket');
    await a.save(d);
    await Promise.all([
      a.saveVersion(d, 'a1'),
      b.saveVersion(d, 'b1'),
      a.saveVersion(d, 'a2'),
      b.saveVersion(d, 'b2'),
      b.deleteVersions(d.id, [1]),
    ]);
    const versions = await a.versions(d.id);
    expect(versions.map((v) => v.number)).toEqual([4, 3, 2]);
    expect(new Set(versions.map((v) => v.description)).size).toBe(3);
  });

  it('loses an entry without a shared lock (the control)', async () => {
    const [a, b] = twoTabs();
    const d = doc('Bracket');
    await a.save(d);
    await Promise.all([a.saveVersion(d, 'a1'), b.saveVersion(d, 'b1')]);
    expect((await a.versions(d.id)).length).toBeLessThan(2);
  });
});

describe('ProjectStore attachments (P4-03b, ADR-0061 §2)', () => {
  const someBytes = (seed: number, length = 2048) =>
    new Uint8Array(Array.from({ length }, (_, i) => (i * 31 + seed) % 256));
  const hash = (bytes: Uint8Array) => sha256Hex(bytes);
  const aid = (id: string) => id as AttachmentId;
  /** The attachment record for a font's bytes. */
  const font = (bytes: Uint8Array, size = bytes.length) => ({
    name: 'Comic Neue Bold',
    fileName: 'ComicNeue-Bold.ttf',
    mediaType: 'font/ttf' as const,
    sha256: hash(bytes),
    size,
  });
  /** The document with one attachment recorded for `bytes`. */
  const withFont = (d: ExtrudoDocument, id: string, bytes: Uint8Array) =>
    applyCommand(d, addAttachment({ id: aid(id), attachment: font(bytes) })).doc;

  it('stores a file under its hash and reads it back', async () => {
    const { store, files } = setup();
    const bytes = someBytes(1);
    const d = doc('Bracket');
    await store.save(d);
    await store.writeAttachment(d.id, hash(bytes), bytes);
    expect(files.paths()).toEqual([
      `projects/${d.id}/attachments/${hash(bytes)}`,
      `projects/${d.id}/document.json`,
    ]);
    expect(await store.readAttachment(d.id, hash(bytes))).toEqual(bytes);
    // A hash the project has no file for, and a name that isn't a hash.
    expect(await store.readAttachment(d.id, 'c'.repeat(64))).toBeUndefined();
    expect(await store.readAttachment(d.id, 'not-a-hash')).toBeUndefined();
  });

  it('refuses bytes that are not the file they are named after', async () => {
    const { store, files } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await expect(store.writeAttachment(d.id, 'a'.repeat(64), someBytes(2))).rejects.toThrow(
      'they hash to',
    );
    await expect(store.writeAttachment(d.id, 'not-a-hash', someBytes(2))).rejects.toThrow(
      "isn't a SHA-256 hash",
    );
    expect(files.paths()).toEqual([`projects/${d.id}/document.json`]);
  });

  it('refuses a file over 10 MB and a design over 50 MB of them', async () => {
    const { store } = setup();
    const d = doc('Bracket');
    await store.save(d);
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    await expect(store.writeAttachment(d.id, hash(big), big)).rejects.toThrow(
      'one file may be at most 10 MB',
    );
    // The design's limit comes from the sizes its stored document records:
    // six 9 MB fonts pass 50 MB before the seventh is written.
    const heavy = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [aid(`f${i}`), font(someBytes(i, 16), 9 * 1024 * 1024)]),
    );
    await store.save({ ...d, attachments: heavy });
    const bytes = someBytes(9);
    await expect(store.writeAttachment(d.id, hash(bytes), bytes)).rejects.toThrow(
      'they may be at most 50 MB',
    );
    expect(MAX_ATTACHMENTS_BYTES).toBe(50 * 1024 * 1024);
  });

  it('takes the attachments folder with the project when it is deleted', async () => {
    const { store, files } = setup();
    const d = doc('Bracket');
    await store.save(d);
    const bytes = someBytes(3);
    await store.writeAttachment(d.id, hash(bytes), bytes);
    await store.purge(d.id);
    expect(files.paths()).toEqual([]);
  });

  it('gathers the files nothing names any more when a version is saved', async () => {
    const { store, files } = setup();
    const bytes = someBytes(4);
    const d = doc('Bracket');
    await store.save(d);
    await store.writeAttachment(d.id, hash(bytes), bytes);
    // Bytes written before any document named them: an add that was undone.
    const orphan = someBytes(5);
    await store.writeAttachment(d.id, hash(orphan), orphan);
    // A plain save gathers nothing: autosave has to stay cheap.
    await store.save(withFont(d, 'f1', bytes));
    expect(files.paths()).toContain(`projects/${d.id}/attachments/${hash(orphan)}`);

    await store.saveVersion(withFont(d, 'f1', bytes), 'with the font');
    // The document and the version both name the font, so only the orphan goes.
    expect(files.paths()).toEqual([
      `projects/${d.id}/attachments/${hash(bytes)}`,
      `projects/${d.id}/document.json`,
      `projects/${d.id}/versions/1.json.gz`,
      `projects/${d.id}/versions/index.json`,
    ]);
  });

  it('keeps a file a saved version names after the document drops it', async () => {
    const { store, files } = setup();
    const bytes = someBytes(6);
    const withIt = withFont(doc('Bracket'), 'f1', bytes);
    const withoutIt = applyCommand(withIt, removeAttachment({ id: aid('f1') })).doc;
    await store.save(withIt);
    await store.writeAttachment(withIt.id, hash(bytes), bytes);
    await store.saveVersion(withIt, 'with the font');
    await store.save(withoutIt);
    expect(files.paths()).toContain(`projects/${withIt.id}/attachments/${hash(bytes)}`);

    // Deleting the version that names it frees the file.
    await store.deleteVersions(withIt.id, [1]);
    expect(files.paths()).not.toContain(`projects/${withIt.id}/attachments/${hash(bytes)}`);
  });

  it('exports the files a version names and imports them, also into a copy', async () => {
    const { store } = setup();
    const old = someBytes(7);
    const newer = someBytes(8);
    const withOld = withFont(doc('Bracket'), 'f1', old);
    await store.save(withOld);
    await store.writeAttachment(withOld.id, hash(old), old);
    await store.saveVersion(withOld, 'early');
    const withBoth = withFont(withOld, 'f2', newer);
    await store.save(withBoth);
    await store.writeAttachment(withBoth.id, hash(newer), newer);

    const file = await store.exportFile(withBoth.id);
    const other = setup().store;
    const notices: string[] = [];
    await other.importFile(file, { onNotice: (m) => notices.push(m) });
    expect(notices).toEqual([]);
    expect(await other.readAttachment(withBoth.id, hash(old))).toEqual(old);
    expect(await other.readAttachment(withBoth.id, hash(newer))).toEqual(newer);
    expect((await other.loadVersion(withBoth.id, 1)).attachments).toEqual(withOld.attachments);

    // The same file again becomes a copy, with the bytes under the new ID.
    const copy = await other.importFile(file);
    expect(copy.id).not.toBe(withBoth.id);
    expect(await other.readAttachment(copy.id, hash(old))).toEqual(old);
  });

  it('copies a project\u2019s files when it is duplicated', async () => {
    const { store } = setup();
    const bytes = someBytes(10);
    const d = withFont(doc('Bracket'), 'f1', bytes);
    await store.save(d);
    await store.writeAttachment(d.id, hash(bytes), bytes);
    const copy = await store.duplicate(d.id);
    expect(await store.readAttachment(copy.id, hash(bytes))).toEqual(bytes);
  });

  it('stores one font once, however many attachments name it', async () => {
    const { store, files } = setup();
    const bytes = someBytes(11);
    const d = doc('Bracket');
    // Two attachments with the same bytes, one file.
    const withBoth = withFont(withFont(d, 'f1', bytes), 'f2', bytes);
    await store.save(withBoth);
    await store.writeAttachment(d.id, hash(bytes), bytes);
    await store.writeAttachment(d.id, hash(bytes), bytes);
    const attachments = () => files.paths().filter((p) => p.includes('/attachments/'));
    expect(attachments()).toEqual([`projects/${d.id}/attachments/${hash(bytes)}`]);
    // The archive has one entry for it too.
    const entries = unzipSync(
      new Uint8Array(await (await store.exportFile(d.id)).arrayBuffer()) as Uint8Array<ArrayBuffer>,
    );
    expect(Object.keys(entries).filter((n) => n.startsWith('attachments/'))).toEqual([
      `attachments/${hash(bytes)}`,
    ]);
    // And a version save keeps it: both records name it.
    await store.saveVersion(withBoth, 'nothing kept');
    expect(attachments()).toEqual([`projects/${d.id}/attachments/${hash(bytes)}`]);
  });

  it('says which fonts a file is missing and loads it anyway', async () => {
    const { store } = setup();
    const one = someBytes(12);
    const two = someBytes(13);
    const d = withFont(withFont(doc('Bracket'), 'f1', one), 'f2', two);
    await store.save(d);
    await store.writeAttachment(d.id, hash(one), one);
    await store.writeAttachment(d.id, hash(two), two);
    // Take one file out of the archive, as a hand-edited file would be.
    const entries = unzipSync(
      new Uint8Array(await (await store.exportFile(d.id)).arrayBuffer()) as Uint8Array<ArrayBuffer>,
    );
    delete entries[`attachments/${hash(two)}`];
    const notices: string[] = [];
    const other = setup().store;
    await other.importFile(new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>]), {
      onNotice: (m) => notices.push(m),
    });
    expect(notices).toEqual(['1 font is missing from the file; its texts show without letters.']);
    expect((await other.load(d.id)).attachments).toEqual(d.attachments);
    expect(await other.readAttachment(d.id, hash(one))).toEqual(one);
    expect(await other.readAttachment(d.id, hash(two))).toBeUndefined();
  });

  it('leaves out a file whose bytes are not what its name says', async () => {
    const { store } = setup();
    const bytes = someBytes(14);
    const d = withFont(doc('Bracket'), 'f1', bytes);
    await store.save(d);
    await store.writeAttachment(d.id, hash(bytes), bytes);
    const entries = unzipSync(
      new Uint8Array(await (await store.exportFile(d.id)).arrayBuffer()) as Uint8Array<ArrayBuffer>,
    );
    entries[`attachments/${hash(bytes)}`] = strToU8('not a font at all');
    const notices: string[] = [];
    const other = setup().store;
    await other.importFile(new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>]), {
      onNotice: (m) => notices.push(m),
    });
    expect(notices).toEqual([
      "1 file in this Extrudo file is damaged (its content doesn't match its name) and was left out.",
      '1 font is missing from the file; its texts show without letters.',
    ]);
    expect(await other.readAttachment(d.id, hash(bytes))).toBeUndefined();
    // The design still opens; the text shows without letters.
    expect((await other.load(d.id)).attachments).toEqual(d.attachments);
  });
});
