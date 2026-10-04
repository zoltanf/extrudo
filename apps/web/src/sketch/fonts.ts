/**
 * Fonts for sketch text on the UI thread (P4-03, ADR-0058 §4). The bundled
 * TTFs come in as hashed asset URLs, so the precache holds them and a design
 * opens offline; `@extrudo/sketch/text` (opentype.js, ~170 kB) is imported
 * only when a document or the Text tool has text, which keeps it out of the
 * entry chunk.
 *
 * Loading a font registers the shaper with core (the entry does that on
 * import) and changes what every `placeText` gives, so `fontsStore`'s version
 * is part of the key of every cache that holds text geometry: the profile
 * cache (`profiles.ts`) and the sketch drawing.
 *
 * A font the user added to the design comes from its attachment
 * (`attachment:<id>`, P4-03b, ADR-0061 §3), which needs the open project, so
 * the page sets where to read it (`useFontAttachments`) while one is open.
 */
import {
  type AttachmentId,
  attachmentFontId,
  type DocumentStore,
  type ExtrudoDocument,
  readSketch,
} from '@extrudo/core';
import { BUNDLED_FONTS, type BundledFontId } from '@extrudo/fonts';
import type { ProjectId, ProjectStore } from '@extrudo/storage';
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import allertaStencil from '../../../../packages/fonts/fonts/allerta-stencil-regular.ttf?url';
import fredoka from '../../../../packages/fonts/fonts/fredoka-semibold.ttf?url';
import interBold from '../../../../packages/fonts/fonts/inter-bold.ttf?url';
import interRegular from '../../../../packages/fonts/fonts/inter-regular.ttf?url';
import jetbrainsMono from '../../../../packages/fonts/fonts/jetbrains-mono-regular.ttf?url';
import notoSerif from '../../../../packages/fonts/fonts/noto-serif-regular.ttf?url';

/** The bundled font files as the build's hashed asset URLs, by font ID. */
export const fontUrls: Readonly<Record<BundledFontId, string>> = {
  'inter-regular@1': interRegular,
  'inter-bold@1': interBold,
  'noto-serif-regular@1': notoSerif,
  'jetbrains-mono-regular@1': jetbrainsMono,
  'allerta-stencil-regular@1': allertaStencil,
  'fredoka-semibold@1': fredoka,
};

export interface FontsState {
  /** Bumped after fonts load: every cache keyed on text geometry reads it. */
  version: number;
}

/** The loaded fonts' version, for the caches that hold text geometry (ADR-0058 §4). */
export const fontsStore = createStore<FontsState>()(() => ({ version: 0 }));

/** The fonts a document's sketches use: every text entity's font ID. */
export function usedFonts(doc: ExtrudoDocument): Set<string> {
  const out = new Set<string>();
  for (const feature of doc.features) {
    const sketch = readSketch(feature)?.data;
    if (!sketch) continue;
    for (const entity of Object.values(sketch.entities)) {
      if (entity.type === 'text') out.add(entity.font);
    }
  }
  return out;
}

const bytes = new Map<string, Promise<ArrayBuffer | undefined>>();

/**
 * Where a design's own fonts come from (P4-03b, ADR-0061 §3): the open
 * project, its document's attachment record and the stored bytes. Without one
 * (no project is open) an `attachment:` font has no bytes, like any unknown
 * font, and the kernel warns about it.
 */
export interface AttachmentFonts {
  /**
   * The bytes of the attachment `id` in the open project, or `undefined` when
   * the design has no record of it or the file isn't stored (a name that never
   * arrived).
   */
  read(id: string): Promise<Uint8Array | undefined>;
}

let attachmentFonts: AttachmentFonts | undefined;

/**
 * The project whose attachments fonts are read from, or `undefined`. The open
 * project's page sets it (the cache follows, so one design's fonts are never
 * served for another's).
 */
export function setAttachmentFonts(source: AttachmentFonts | undefined): void {
  attachmentFonts = source;
  for (const key of [...bytes.keys()]) if (key.startsWith(ATTACHMENT_CACHE)) bytes.delete(key);
}

/** The project's page tells this module where its design's fonts live. */
export function useFontAttachments(
  projectId: string,
  store: DocumentStore,
  projects: ProjectStore,
): void {
  useEffect(() => {
    setAttachmentFonts({
      read: (id) => {
        const attachment = store.getState().doc.attachments?.[id as AttachmentId];
        return attachment
          ? projects.readAttachment(projectId as ProjectId, attachment.sha256)
          : Promise.resolve(undefined);
      },
    });
    return () => setAttachmentFonts(undefined);
  }, [projectId, store, projects]);
}

const ATTACHMENT_CACHE = 'attachment:';

/**
 * A font's bytes, once: a bundled font's asset is fetched, a design font's are
 * read from storage. `undefined` for a font nothing knows (a missing
 * attachment, a bundled file that didn't load), which is what the kernel and
 * the view take as "no font" — neither needs to know why.
 */
export function fontBytes(id: string): Promise<ArrayBuffer | undefined> {
  const attachmentId = attachmentFontId(id);
  if (attachmentId) return attachmentBytes(attachmentId);
  const known = bytes.get(id);
  if (known) return known;
  const url = (fontUrls as Readonly<Record<string, string>>)[id];
  const promise = url
    ? fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : undefined))
        .catch(() => undefined)
    : Promise.resolve(undefined);
  bytes.set(id, promise);
  return promise;
}

/** One attachment's bytes, read once per open project and kept in the cache. */
function attachmentBytes(id: AttachmentId): Promise<ArrayBuffer | undefined> {
  const key = `${ATTACHMENT_CACHE}${id}`;
  const known = bytes.get(key);
  if (known) return known;
  const source = attachmentFonts;
  const promise = (source ? source.read(id) : Promise.resolve(undefined))
    .then((data) => {
      if (!data) return undefined;
      // A copy in its own buffer: the store's view may sit in a bigger one.
      const copy = new Uint8Array(data.length);
      copy.set(data);
      return copy.buffer;
    })
    .catch(() => undefined);
  bytes.set(key, promise);
  return promise;
}

/** The fonts loaded on the UI thread. */
const loaded = new Set<string>();

/** Whether the UI thread can draw with this font. */
export function hasUiFont(id: string): boolean {
  return loaded.has(id);
}

/** The text module, once `@extrudo/sketch/text` has been imported. */
let shaper: Promise<typeof import('@extrudo/sketch/text')> | undefined;

function loadText(): Promise<typeof import('@extrudo/sketch/text')> {
  shaper ??= import('@extrudo/sketch/text');
  return shaper;
}

/** The text module for code outside this file (adding a font, P4-03b). */
export function textModule(): Promise<typeof import('@extrudo/sketch/text')> {
  return loadText();
}

/**
 * Makes the fonts in `ids` drawable on the UI thread: imports the shaper and
 * loads the bundled files that aren't in yet, then bumps `fontsStore`'s
 * version so the caches that hold text geometry come right. A font no source
 * knows is skipped (the kernel warns about it).
 */
export async function ensureUiFonts(ids: Iterable<string>): Promise<void> {
  const wanted = [...new Set(ids)].filter((id) => !loaded.has(id));
  if (wanted.length === 0) return;
  const text = await loadText();
  let added = false;
  for (const id of wanted) {
    const data = await fontBytes(id);
    if (!data) continue;
    try {
      text.loadFont(id, data);
      loaded.add(id);
      added = true;
    } catch (error) {
      console.warn(`[fonts] ${id} didn't load:`, error);
    }
  }
  if (added) fontsStore.setState((s) => ({ version: s.version + 1 }));
}

/**
 * Keeps the UI thread's fonts in step with the open document: called where
 * the project sets up its recomputer, so the kernel and the view learn of a
 * font at the same time.
 */
export function useDocumentFonts(store: DocumentStore): void {
  const doc = useStore(store, (s) => s.doc);
  const wanted = [...usedFonts(doc)].sort().join(' ');
  useEffect(() => {
    void ensureUiFonts(wanted.length > 0 ? wanted.split(' ') : []);
  }, [wanted]);
}

export { BUNDLED_FONTS };
