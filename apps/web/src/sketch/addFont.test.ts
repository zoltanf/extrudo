/**
 * "Add font…" (P4-03b, ADR-0061 §3): a font file the user picks becomes an
 * attachment of the design — the bytes in storage under their SHA-256, the
 * metadata in the document — and its `attachment:<id>` font ID goes into the
 * Font select. A file Extrudo can't read stores nothing at all.
 */

import { readFileSync } from 'node:fs';
import { createDocument, createDocumentStore, type DocumentStore } from '@extrudo/core';
import { memoryProjectStore, type ProjectStore, sha256Hex } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { addFontFile } from './addFont';

/** A real font file, so the parser's verdict is the one a user would get. */
const FONT_BYTES = readFileSync(
  new URL('../../../../packages/fonts/fonts/fredoka-semibold.ttf', import.meta.url),
);

interface Harness {
  store: DocumentStore;
  projects: ProjectStore;
  /** The messages the user was shown, as `[tone, message]`. */
  told: [string, string][];
  /** Sets the file the next pick returns (or `undefined` for a cancel). */
  picked(file: File | undefined): void;
  /** Adds a font with `file`, as the Font select's "Add font…" does. */
  add(): Promise<string | undefined>;
}

async function setup(): Promise<Harness> {
  const projects = memoryProjectStore();
  const store = createDocumentStore(createDocument());
  await projects.save(store.getState().doc);
  let next: File | undefined;
  const told: [string, string][] = [];
  const files = {
    projects,
    store,
    files: {
      pick: async () => next,
    },
    notify: (tone: 'info' | 'error', message: string) => told.push([tone, message]),
  };
  return {
    store,
    projects,
    told,
    picked: (file) => {
      next = file;
    },
    add: () => addFontFile(files),
  };
}

const font = (name: string, bytes: Uint8Array) =>
  new File([bytes as BlobPart], name, { type: 'application/octet-stream' });

describe('adding a font', () => {
  it('stores the bytes under their hash and names the font for the document', async () => {
    const h = await setup();
    h.picked(font('fredoka-semibold.ttf', FONT_BYTES));
    const id = await h.add();

    // The ID is the attachment's, so a text stores `attachment:<id>` and knows
    // what it needs wherever the design travels.
    expect(id).toMatch(/^attachment:[0-9a-f-]+$/);
    const attachmentId = (id ?? '').slice('attachment:'.length);
    const attachment = h.store.getState().doc.attachments?.[attachmentId as never];
    expect(attachment).toEqual({
      name: 'Fredoka Light',
      fileName: 'fredoka-semibold.ttf',
      mediaType: 'font/ttf',
      sha256: sha256Hex(FONT_BYTES),
      size: FONT_BYTES.length,
    });
    // The bytes are in the project's attachment folder, under that hash.
    const stored = await h.projects.readAttachment(
      h.store.getState().doc.id,
      attachment?.sha256 ?? '',
    );
    expect([...(stored ?? [])]).toEqual([...FONT_BYTES]);
    expect(h.told).toEqual([]);

    // One undo step takes the metadata away again (the bytes wait for
    // storage's collection).
    h.store.getState().undo();
    expect(h.store.getState().doc.attachments).toBeUndefined();
  });

  it('reuses the attachment when the same file is added again', async () => {
    const h = await setup();
    h.picked(font('fredoka-semibold.ttf', FONT_BYTES));
    const first = await h.add();
    // The same bytes under another name: still the same font.
    h.picked(font('fredoka-copy.ttf', FONT_BYTES));
    const second = await h.add();

    expect(second).toBe(first);
    expect(Object.keys(h.store.getState().doc.attachments ?? {})).toHaveLength(1);
    expect(h.store.getState().doc.attachments?.[(first ?? '').slice(11) as never]?.fileName).toBe(
      'fredoka-semibold.ttf',
    );
  });

  it('refuses a file that is not a font, and stores nothing', async () => {
    const h = await setup();
    h.picked(font('notes.ttf', new TextEncoder().encode('hello world')));
    expect(await h.add()).toBeUndefined();
    expect(h.told).toEqual([
      ['error', "This file isn't a font Extrudo can read: it doesn't look like a font file."],
    ]);
    expect(h.store.getState().doc.attachments).toBeUndefined();
  });

  it('says why a WOFF2 cannot be added, without reading it', async () => {
    const h = await setup();
    h.picked(font('inter.woff2', FONT_BYTES));
    expect(await h.add()).toBeUndefined();
    expect(h.told).toEqual([
      ['error', "WOFF2 isn't supported; convert the font to TTF or OTF first."],
    ]);
    expect(h.store.getState().doc.attachments).toBeUndefined();
  });

  it('takes the media type from the file name', async () => {
    const h = await setup();
    h.picked(font('my-font.woff', FONT_BYTES));
    await h.add();
    const only = Object.values(h.store.getState().doc.attachments ?? {});
    expect(only[0]?.mediaType).toBe('font/woff');
    expect(only[0]?.name).toBe('Fredoka Light');
  });

  it('refuses a file whose name is not a font format', async () => {
    const h = await setup();
    h.picked(font('notes.txt', FONT_BYTES));
    expect(await h.add()).toBeUndefined();
    expect(h.told[0]?.[1]).toContain('Extrudo reads TrueType (.ttf), OpenType (.otf) and WOFF');
    expect(h.store.getState().doc.attachments).toBeUndefined();
  });

  it('says nothing when the user cancels', async () => {
    const h = await setup();
    h.picked(undefined);
    expect(await h.add()).toBeUndefined();
    expect(h.told).toEqual([]);
    expect(h.store.getState().doc.attachments).toBeUndefined();
  });
});
