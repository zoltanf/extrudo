import {
  type AttachmentId,
  addAttachment,
  addToSketch,
  createDocument,
  createDocumentStore,
  createSketch,
  type DocumentStore,
  type FeatureId,
  newId,
  originPlaneRef,
  type SketchEntityId,
} from '@extrudo/core';
import { BUNDLED_FONTS } from '@extrudo/fonts';
import { memoryProjectStore, type ProjectStore, sha256Hex } from '@extrudo/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { fontBytes, fontUrls, setAttachmentFonts, usedFonts } from './fonts';

const eid = (id: string) => id as SketchEntityId;

/** A document with one sketch holding a text entity of `font`. */
function documentWithText(font: string) {
  const store = createDocumentStore(createDocument());
  const sketch = newId<FeatureId>();
  store.getState().dispatch(createSketch({ id: sketch, plane: originPlaneRef('origin:xy') }));
  store.getState().dispatch(
    addToSketch({
      feature: sketch,
      entities: {
        [eid('anchor')]: { type: 'point', x: 0, y: 0 },
        [eid('top')]: { type: 'point', x: 0, y: 10 },
        [eid('word')]: {
          type: 'text',
          anchor: eid('anchor'),
          top: eid('top'),
          text: 'Ag',
          font,
          align: 'left',
          construction: false,
        },
      },
      constraints: {},
      dimensions: {},
    }),
  );
  return store.getState().doc;
}

describe('usedFonts', () => {
  it('collects the fonts of every text entity of every sketch', () => {
    const doc = documentWithText('inter-bold@1');
    expect([...usedFonts(doc)]).toEqual(['inter-bold@1']);
    expect([...usedFonts(createDocument())]).toEqual([]);
  });

  it('counts a font once, however many texts use it', () => {
    const store = createDocumentStore(createDocument());
    const sketch = newId<FeatureId>();
    store.getState().dispatch(createSketch({ id: sketch, plane: originPlaneRef('origin:xy') }));
    const text = (id: string, anchor: SketchEntityId, top: SketchEntityId) => ({
      [eid(id)]: {
        type: 'text' as const,
        anchor,
        top,
        text: id,
        font: 'jetbrains-mono-regular@1',
        align: 'center' as const,
        construction: false,
      },
    });
    store.getState().dispatch(
      addToSketch({
        feature: sketch,
        entities: {
          [eid('a')]: { type: 'point', x: 0, y: 0 },
          [eid('b')]: { type: 'point', x: 0, y: 10 },
          [eid('c')]: { type: 'point', x: 20, y: 0 },
          [eid('d')]: { type: 'point', x: 20, y: 10 },
          ...text('one', eid('a'), eid('b')),
          ...text('two', eid('c'), eid('d')),
        },
        constraints: {},
        dimensions: {},
      }),
    );
    expect([...usedFonts(store.getState().doc)]).toEqual(['jetbrains-mono-regular@1']);
  });
});

describe('fontUrls', () => {
  it('has an asset URL for every bundled font', () => {
    for (const font of BUNDLED_FONTS) {
      const url = (fontUrls as Record<string, string | undefined>)[font.id];
      expect(url, font.id).toBeDefined();
      expect(url).toMatch(/\.ttf$/);
    }
  });

  it('names exactly the bundled fonts', () => {
    expect(Object.keys(fontUrls).sort()).toEqual(BUNDLED_FONTS.map((f) => f.id).sort());
  });
});

/** A stored project with `bytes` as one attachment, and its store. */
async function projectWithAttachment(bytes: Uint8Array): Promise<{
  id: AttachmentId;
  font: string;
  store: DocumentStore;
  projects: ProjectStore;
}> {
  const projects = memoryProjectStore();
  const store = createDocumentStore(createDocument());
  await projects.save(store.getState().doc);
  const id = newId<AttachmentId>();
  const sha256 = sha256Hex(bytes);
  await projects.writeAttachment(store.getState().doc.id, sha256, bytes);
  store.getState().dispatch(
    addAttachment({
      id,
      attachment: {
        name: 'Fredoka SemiBold',
        fileName: 'fredoka-semibold.ttf',
        mediaType: 'font/ttf',
        sha256,
        size: bytes.length,
      },
    }),
  );
  return { id, font: `attachment:${id}`, store, projects };
}

describe('fontBytes of a design font', () => {
  afterEach(() => setAttachmentFonts(undefined));

  it('reads the bytes of the attachment, once', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const { font, store, projects } = await projectWithAttachment(bytes);
    const projectId = store.getState().doc.id;
    let reads = 0;
    setAttachmentFonts({
      read: (id) => {
        const record = store.getState().doc.attachments?.[id as AttachmentId];
        reads += 1;
        return record
          ? projects.readAttachment(projectId, record.sha256)
          : Promise.resolve(undefined);
      },
    });
    const first = await fontBytes(font);
    expect([...new Uint8Array(first ?? new ArrayBuffer(0))]).toEqual([...bytes]);
    // The second call is the cache, not storage again.
    expect((await fontBytes(font))?.byteLength).toBe(bytes.length);
    expect(reads).toBe(1);
  });

  it('has no bytes without an open project, or for a name nothing stores', async () => {
    const { font, store, projects } = await projectWithAttachment(new Uint8Array([1, 2, 3]));
    const projectId = store.getState().doc.id;
    // No project open: nothing to read the attachment from.
    expect(await fontBytes(font)).toBeUndefined();
    setAttachmentFonts({
      read: (id) => {
        const record = store.getState().doc.attachments?.[id as AttachmentId];
        return record
          ? projects.readAttachment(projectId, record.sha256)
          : Promise.resolve(undefined);
      },
    });
    // An attachment the document doesn't name, and one whose file never arrived.
    expect(await fontBytes(`attachment:${newId<AttachmentId>()}`)).toBeUndefined();
    expect(await fontBytes('attachment:not-an-id')).toBeUndefined();
  });

  it('keeps one design out of another', async () => {
    const mine = await projectWithAttachment(new Uint8Array([9, 9]));
    setAttachmentFonts({ read: () => Promise.resolve(undefined) });
    // The other project's file store has nothing under this ID, and the cache
    // for this font was dropped when the source changed.
    expect(await fontBytes(mine.font)).toBeUndefined();
  });
});
