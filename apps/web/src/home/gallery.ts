/**
 * The template gallery on the home screen (P3-12, FR-UX-05, ADR-0052): the
 * Wall bracket, built in code, and three designs the app itself made and
 * exported, kept as `.extrudo` files under `fixtures/benchmarks/` (B2, B4 and
 * B5, the same files the benchmark tests recompute). A file template goes
 * through storage's `readArchive`, so core's migrations apply to it like to any
 * file the user opens. Every card has a thumbnail checked in under
 * `home/templates/`; `RECORD_ASSETS=1 pnpm e2e e2e/record-assets.spec.ts`
 * remakes them from the app's own render.
 */
import { type DocumentId, type ExtrudoDocument, newId } from '@extrudo/core';
import { readArchive } from '@extrudo/storage';
import b2 from '../../../../fixtures/benchmarks/b2-storage-box.extrudo?url';
import b4 from '../../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url';
import b5 from '../../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url';
import { wallBracket } from '../project/templates';
import boxWithLidThumbnail from './templates/box-with-lid.png?url';
import pcbEnclosureThumbnail from './templates/pcb-enclosure.png?url';
import storageBoxThumbnail from './templates/storage-box.png?url';
import wallBracketThumbnail from './templates/wall-bracket.png?url';

export interface Template {
  id: string;
  name: string;
  /** One line for its card. */
  summary: string;
  /** A small picture of the model, a transparent PNG (URL). */
  thumbnail: string;
  /** The `.extrudo` file a template comes from (URL); absent for one built in code. */
  file?: string;
  /** The design to start from: a document with an ID of its own, named like the template. */
  create(): Promise<ExtrudoDocument>;
}

/** A template's document: the same design under a new ID, named and dated as a new one. */
export function fromTemplate(doc: ExtrudoDocument, name: string): ExtrudoDocument {
  return {
    ...doc,
    id: newId<DocumentId>(),
    name,
    meta: { ...doc.meta, created: new Date().toISOString() },
  };
}

/** A template's design from the bytes of its `.extrudo` file. */
export function templateFromBytes(bytes: Uint8Array, name: string): ExtrudoDocument {
  return fromTemplate(readArchive(bytes).doc, name);
}

function fileTemplate(t: Omit<Template, 'create'> & { file: string }): Template {
  return {
    ...t,
    async create() {
      const response = await fetch(t.file);
      if (!response.ok) throw new Error(`Couldn't load the ${t.name} template.`);
      return templateFromBytes(new Uint8Array(await response.arrayBuffer()), t.name);
    },
  };
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'wall-bracket',
    name: 'Wall bracket',
    summary: 'Parameters, fillets and a timeline to explore.',
    thumbnail: wallBracketThumbnail,
    create: async () => wallBracket(),
  },
  fileTemplate({
    id: 'storage-box',
    name: 'Storage box',
    summary: 'An open box cut from a solid. Change its width, depth and walls.',
    thumbnail: storageBoxThumbnail,
    file: b2,
  }),
  fileTemplate({
    id: 'box-with-lid',
    name: 'Box with a lid',
    summary: 'Two bodies that fit, with a clearance parameter.',
    thumbnail: boxWithLidThumbnail,
    file: b4,
  }),
  fileTemplate({
    id: 'pcb-enclosure',
    name: 'PCB enclosure',
    summary: 'Screw posts, holes and a lid, patterned and mirrored.',
    thumbnail: pcbEnclosureThumbnail,
    file: b5,
  }),
];
