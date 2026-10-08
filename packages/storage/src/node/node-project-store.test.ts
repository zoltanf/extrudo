/**
 * The Node-fs ProjectStore (P6-01, ADR-0075 §2): the whole ProjectStore suite
 * runs against real files in a temp directory, covering what the browser store
 * promises (save/load/list/delete, versions, attachments, thumbnails) plus the
 * two things the file system makes real: atomic index writes and a shared lock
 * serialising two stores over one directory.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AttachmentId,
  addAttachment,
  addParameter,
  applyCommand,
  createDocument,
  type DocumentId,
  type ExtrudoDocument,
  type ParameterId,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import { writeArchive } from '../archive';
import { localLock } from '../project-store';
import { sha256Hex } from '../sha256';
import { ProjectNotFoundError, StorageError } from '../types';
import { createNodeProjectStore, nodeIndex } from './index';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'extrudo-store-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

function setup() {
  let clock = Date.parse('2026-09-25T10:00:00.000Z');
  let ids = 0;
  return tempDir().then((dir) => ({
    dir,
    store: createNodeProjectStore(dir, {
      appVersion: '0.3.0',
      now: () => {
        clock += 1000;
        return new Date(clock).toISOString();
      },
      newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` as DocumentId,
    }),
  }));
}

describe('Node-fs ProjectStore', () => {
  it('saves and loads a document on disk, at the layout OPFS has', async () => {
    const { dir, store } = await setup();
    const d = doc('Bracket');
    const summary = await store.save(d);
    expect(summary).toMatchObject({ id: d.id, name: 'Bracket', hasThumbnail: false });
    expect(summary.modified).toBe('2026-09-25T10:00:01.000Z');

    const loaded = await store.load(d.id);
    expect(loaded.parameters.map((p) => p.name)).toEqual(['wall']);
    expect(loaded.meta.appVersion).toBe('0.3.0');

    // The document is a real file under projects/<id>/.
    const path = join(dir, 'projects', d.id, 'document.json');
    expect(JSON.parse(await readFile(path, 'utf8')).name).toBe('Bracket');
    expect(JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')).projects).toHaveLength(1);
  });

  it('lists projects newest first, renames, trashes, restores and purges', async () => {
    const { dir, store } = await setup();
    const a = doc('A');
    const b = doc('B');
    await store.save(a);
    await store.save(b);
    expect((await store.list()).map((s) => s.name)).toEqual(['B', 'A']);
    await store.rename(a.id, '  A renamed ');
    expect((await store.load(a.id)).name).toBe('A renamed');
    await expect(store.rename(a.id, '  ')).rejects.toThrow('needs a name');

    await store.trash(b.id);
    expect((await store.get(b.id))?.trashed).toBeDefined();
    await store.restore(b.id);
    expect((await store.get(b.id))?.trashed).toBeUndefined();

    await store.purge(b.id);
    expect((await store.list()).map((s) => s.name)).toEqual(['A renamed']);
    await expect(store.load(b.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(await readdir(join(dir, 'projects'))).toEqual([a.id]);
  });

  it('saves versions under the project and loads them back', async () => {
    const { dir, store } = await setup();
    const d = doc('Bracket');
    await store.save(d);
    const v1 = await store.saveVersion(d, '  First fit  ');
    expect(v1).toEqual({
      number: 1,
      description: 'First fit',
      created: '2026-09-25T10:00:02.000Z',
      name: 'Bracket',
    });
    await store.saveVersion({ ...d, name: 'Bracket v2' }, '');
    expect((await store.versions(d.id)).map((v) => [v.number, v.name])).toEqual([
      [2, 'Bracket v2'],
      [1, 'Bracket'],
    ]);
    expect((await store.loadVersion(d.id, 1)).name).toBe('Bracket');
    expect(await readdir(join(dir, 'projects', d.id, 'versions'))).toEqual([
      '1.json.gz',
      '2.json.gz',
      'index.json',
    ]);
    await store.deleteVersions(d.id, [2]);
    expect((await store.versions(d.id)).map((v) => v.number)).toEqual([1]);
  });

  it('stores attachments under their hash and gathers the ones nothing names', async () => {
    const { dir, store } = await setup();
    const bytes = new Uint8Array(Array.from({ length: 1024 }, (_, i) => (i * 7) % 256));
    const hash = sha256Hex(bytes);
    const withFont = applyCommand(
      doc('Bracket'),
      addAttachment({
        id: 'f1' as AttachmentId,
        attachment: {
          name: 'Comic Neue Bold',
          fileName: 'ComicNeue-Bold.ttf',
          mediaType: 'font/ttf',
          sha256: hash,
          size: bytes.length,
        },
      }),
    ).doc;
    await store.save(withFont);
    await store.writeAttachment(withFont.id, hash, bytes);
    expect(await store.readAttachment(withFont.id, hash)).toEqual(bytes);
    expect(await readdir(join(dir, 'projects', withFont.id, 'attachments'))).toEqual([hash]);

    // Bytes written before any document named them: an add that was undone.
    const orphan = new Uint8Array([1, 2, 3, 4]);
    await store.writeAttachment(withFont.id, sha256Hex(orphan), orphan);
    await store.saveVersion(withFont, 'with the font');
    expect(await readdir(join(dir, 'projects', withFont.id, 'attachments'))).toEqual([hash]);
  });

  it('writes and reads a model cache, undefined when missing or garbage (ADR-0078)', async () => {
    const { dir, store } = await setup();
    const d = doc('Bracket');
    await store.save(d);
    expect(await store.readModelCache(d.id)).toBeUndefined();
    await store.writeModelCache(d.id, { version: 1, bodies: ['e1:0'] });
    expect(await store.readModelCache(d.id)).toEqual({ version: 1, bodies: ['e1:0'] });
    await writeFile(join(dir, 'projects', d.id, 'model-cache.json'), 'garbage');
    expect(await store.readModelCache(d.id)).toBeUndefined();
    await writeFile(join(dir, 'projects', d.id, 'model-cache.json'), '{"version":9,"bodies":[]}');
    expect(await store.readModelCache(d.id)).toBeUndefined();
  });

  it('writes and reads a thumbnail, and exports and re-imports the whole project', async () => {
    const { store } = await setup();
    const d = doc('Bracket');
    await store.save(d);
    await store.setThumbnail(d.id, png(1, 2, 3));
    expect((await store.get(d.id))?.hasThumbnail).toBe(true);
    expect(new Uint8Array(await ((await store.thumbnail(d.id)) as Blob).arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    );

    const file = await store.exportFile(d.id);
    const other = (await setup()).store;
    const imported = await other.importFile(file);
    expect(imported).toMatchObject({ id: d.id, name: 'Bracket', hasThumbnail: true });
    expect((await other.load(d.id)).parameters).toEqual(d.parameters);
  });
});

describe('Node-fs ProjectStore refuses ids that are not project ids (P6-01 review)', () => {
  it('refuses a purge, a thumbnail and an attachment for an id that leaves the store', async () => {
    const base = await tempDir();
    const dir = join(base, 'store');
    const outside = join(base, 'outside.txt');
    await writeFile(outside, 'keep me');
    const store = createNodeProjectStore(dir);

    await expect(store.purge('../../..' as DocumentId)).rejects.toBeInstanceOf(StorageError);
    await expect(store.purge('' as DocumentId)).rejects.toBeInstanceOf(StorageError);
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(
      store.writeAttachment('../../x' as DocumentId, sha256Hex(bytes), bytes),
    ).rejects.toBeInstanceOf(StorageError);
    // Nothing outside the store was touched.
    expect(existsSync(outside)).toBe(true);
    expect(await readFile(outside, 'utf8')).toBe('keep me');
    expect(existsSync(join(base, 'projects'))).toBe(false);
  });

  it('refuses an import whose document ID would climb out', async () => {
    const base = await tempDir();
    const dir = join(base, 'store');
    const store = createNodeProjectStore(dir);
    const outside = join(base, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'document.json'), 'do not overwrite');

    const evil = { ...doc('Evil'), id: '../../outside' as DocumentId };
    const archive = writeArchive(evil, undefined, [], new Map());
    await expect(
      store.importFile(new Blob([archive as Uint8Array<ArrayBuffer>])),
    ).rejects.toBeInstanceOf(StorageError);
    expect(await readFile(join(outside, 'document.json'), 'utf8')).toBe('do not overwrite');
  });

  it('still refuses to purge a project it does not know, without touching the disk', async () => {
    const base = await tempDir();
    const dir = join(base, 'store');
    const store = createNodeProjectStore(dir);
    const missing = '00000000-0000-4000-8000-000000000042' as DocumentId;
    await expect(store.purge(missing)).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(existsSync(dir)).toBe(false);
  });
});

describe('Node-fs index atomicity and locking (ADR-0075 §2)', () => {
  it('leaves the old index in place when a write does not reach the rename', async () => {
    const dir = await tempDir();
    const good = nodeIndex(join(dir, 'index.json'));
    await good.put({
      id: 'p1' as DocumentId,
      name: 'One',
      created: 'c',
      modified: 'm',
      hasThumbnail: false,
    });
    const before = await readFile(join(dir, 'index.json'), 'utf8');

    const failing = nodeIndex(join(dir, 'index.json'), {
      beforeRename: () => {
        throw new Error('power loss');
      },
    });
    await expect(
      failing.put({
        id: 'p2' as DocumentId,
        name: 'Two',
        created: 'c',
        modified: 'm',
        hasThumbnail: false,
      }),
    ).rejects.toThrow('power loss');
    // The index still names exactly the one project, and the new store reads it.
    expect(await readFile(join(dir, 'index.json'), 'utf8')).toBe(before);
    expect((await good.all()).map((s) => s.name)).toEqual(['One']);
  });

  it('keeps every version when two stores save at the same moment, holding a shared lock', async () => {
    const dir = await tempDir();
    const lock = localLock();
    const a = createNodeProjectStore(dir, { lock });
    const b = createNodeProjectStore(dir, { lock });
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
});
