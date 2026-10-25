import { type AttachmentId, createDocument, type ExtrudoDocument } from '@extrudo/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { writeArchive } from './archive';
import { memoryFiles } from './files';
import { memoryIndex } from './idb';
import { createProjectStore } from './project-store';
import { sha256Hex } from './sha256';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_BYTES } from './types';

const MB = 1024 * 1024;

/** Five individually valid files whose combined bytes exceed the design limit. */
let attachments: Map<string, Uint8Array>;
let records: NonNullable<ExtrudoDocument['attachments']>;

beforeAll(() => {
  attachments = new Map();
  records = {};
  for (let i = 0; i < 5; i++) {
    const bytes = new Uint8Array(21 * MB).fill(i);
    const sha256 = sha256Hex(bytes);
    attachments.set(sha256, bytes);
    records[`file-${i}` as AttachmentId] = {
      name: `Model ${i}`,
      fileName: `model-${i}.stl`,
      mediaType: 'model/stl',
      sha256,
      size: bytes.length,
    };
  }
}, 60_000);

function setup() {
  const files = memoryFiles();
  const store = createProjectStore({ index: memoryIndex(), files });
  return { files, store };
}

function record(index: number) {
  const entry = records[`file-${index}` as AttachmentId];
  if (!entry) throw new Error(`Missing fixture attachment ${index}.`);
  return entry;
}

function document(indices = [0, 1, 2, 3, 4]): ExtrudoDocument {
  return {
    ...createDocument({ name: 'Attachment budget' }),
    attachments: Object.fromEntries(indices.map((i) => [`file-${i}`, record(i)])),
  };
}

function archive(doc: ExtrudoDocument, versions: ExtrudoDocument[] = [], files = attachments) {
  const bytes = writeArchive(
    doc,
    undefined,
    versions.map((version, index) => ({
      doc: version,
      summary: {
        number: index + 1,
        name: version.name,
        description: 'Earlier design',
        created: version.meta.created,
      },
    })),
    files,
  );
  return new Blob([bytes as Uint8Array<ArrayBuffer>]);
}

describe('attachment budgets for imported and copied projects', () => {
  it.each([
    ['new project', false],
    ['existing ID', false],
    ['new project', true],
    ['existing ID', true],
  ] as const)(
    'refuses 105 MB before writing anything (%s, understated sizes: %s)',
    async (mode, understate) => {
      const { files, store } = setup();
      const doc = document();
      if (understate) {
        doc.attachments = Object.fromEntries(
          Object.entries(records).map(([id, record]) => [id, { ...record, size: 1 }]),
        );
      }
      if (mode === 'existing ID') await store.save({ ...doc, attachments: {} });
      const beforeFiles = files.paths();
      const beforeProjects = await store.list();

      await expect(store.importFile(archive(doc))).rejects.toThrow('they may be at most 100 MB');

      expect(files.paths()).toEqual(beforeFiles);
      expect(await store.list()).toEqual(beforeProjects);
    },
    60_000,
  );

  it.each(['new project', 'existing ID'])(
    'also checks a saved version before writing anything (%s)',
    async (mode) => {
      const { files, store } = setup();
      const current = document([]);
      const old = { ...document(), id: current.id };
      if (mode === 'existing ID') await store.save(current);
      const beforeFiles = files.paths();
      const beforeProjects = await store.list();

      await expect(store.importFile(archive(current, [old]))).rejects.toThrow(
        'they may be at most 100 MB',
      );

      expect(files.paths()).toEqual(beforeFiles);
      expect(await store.list()).toEqual(beforeProjects);
    },
    60_000,
  );

  it('refuses to duplicate an oversized project left by an older importer', async () => {
    const { files, store } = setup();
    const doc = document();
    await store.save(doc);
    // This is the state older importers persisted, before the batch check.
    for (const [sha256, bytes] of attachments) {
      await files.write(`projects/${doc.id}/attachments/${sha256}`, bytes);
    }
    const beforeFiles = files.paths();
    const beforeProjects = await store.list();

    await expect(store.duplicate(doc.id)).rejects.toThrow('they may be at most 100 MB');

    expect(files.paths()).toEqual(beforeFiles);
    expect(await store.list()).toEqual(beforeProjects);
  }, 60_000);

  it('accepts exactly 100 MB, with no file larger than 25 MB', async () => {
    const { store } = setup();
    const doc = document([]);
    const files = new Map<string, Uint8Array>();
    for (let i = 0; i < 4; i++) {
      const bytes = new Uint8Array(MAX_ATTACHMENT_BYTES).fill(i + 10);
      const sha256 = sha256Hex(bytes);
      files.set(sha256, bytes);
      doc.attachments ??= {};
      doc.attachments[`file-${i}` as AttachmentId] = {
        ...record(0),
        sha256,
        size: bytes.length,
      };
    }
    expect([...files.values()].reduce((sum, bytes) => sum + bytes.length, 0)).toBe(
      MAX_ATTACHMENTS_BYTES,
    );

    const imported = await store.importFile(archive(doc, [], files));

    expect((await store.load(imported.id)).attachments).toEqual(doc.attachments);
    expect((await store.readAttachment(imported.id, [...files.keys()][0] as string))?.length).toBe(
      MAX_ATTACHMENT_BYTES,
    );
  }, 60_000);

  it.each(['new project', 'existing ID'])(
    'keeps history whose states fit, even when their distinct files total 105 MB (%s)',
    async (mode) => {
      const { store } = setup();
      const current = document([0, 1, 2]);
      const old = { ...document([3, 4]), id: current.id };
      if (mode === 'existing ID') await store.save({ ...current, attachments: {} });

      const imported = await store.importFile(archive(current, [old]));

      expect((await store.load(imported.id)).attachments).toEqual(current.attachments);
      expect((await store.loadVersion(imported.id, 1)).attachments).toEqual(old.attachments);
      for (const sha256 of attachments.keys()) {
        expect((await store.readAttachment(imported.id, sha256))?.length).toBe(21 * MB);
      }
    },
    60_000,
  );

  it('counts the same content once when several attachment records name it', async () => {
    const { store } = setup();
    const doc = document();
    const first = record(0);
    doc.attachments = Object.fromEntries(Object.keys(records).map((id) => [id, { ...first }]));
    const files = new Map([[first.sha256, attachments.get(first.sha256) as Uint8Array]]);

    const imported = await store.importFile(archive(doc, [], files));

    expect((await store.load(imported.id)).attachments).toEqual(doc.attachments);
    expect((await store.readAttachment(imported.id, first.sha256))?.length).toBe(21 * MB);
  }, 60_000);
});
