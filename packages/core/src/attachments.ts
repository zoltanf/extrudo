/**
 * Attachments: files that travel with the design (P4-03b, ADR-0061 §1). The
 * document holds only what each file *is* (name, media type, SHA-256, size);
 * the bytes live beside it in storage and in the `.extrudo` file, shared:
 * one SHA-256 is stored once however many attachments or versions name it.
 *
 * The commands here change the metadata alone. Writing the bytes belongs to
 * the caller (`ProjectStore.writeAttachment`, before the document that names
 * it is saved), so undoing an add leaves them behind, which is harmless:
 * `collectAttachments` gathers them up later (ADR-0061 §2).
 */
import { CommandError, type DocumentDraft, defineCommand } from './commands';
import type { AttachmentId } from './ids';
import { type Attachment, AttachmentSchema, type ExtrudoDocument } from './schema';
import { readSketch } from './sketch/feature';
import type { SketchData } from './sketch/schema';
import { attachmentFontId } from './sketch/schema';

export const addAttachment = defineCommand<{ id: AttachmentId; attachment: Attachment }>(
  'attachment.add',
  'Add attachment',
  (draft, { id, attachment }) => {
    const parsed = AttachmentSchema.safeParse(attachment);
    if (!parsed.success) {
      const reasons = parsed.error.issues.map((i) => i.message).join('; ');
      throw new CommandError(`This file can't be added to the design: ${reasons}.`);
    }
    if (draft.attachments?.[id]) {
      throw new CommandError(`This design already has a file with the ID ${id}.`);
    }
    draft.attachments ??= {};
    draft.attachments[id] = parsed.data;
  },
);

/**
 * Drops a file's metadata. Refused, naming the sketches, while a text is
 * shaped with it: such a text would lose its letters (ADR-0061 §1). The
 * bytes go when storage collects them, not here.
 */
export const removeAttachment = defineCommand<{ id: AttachmentId }>(
  'attachment.remove',
  'Remove attachment',
  (draft, { id }) => {
    const users = sketchesUsingAttachment(draft, id);
    if (users.length > 0) {
      throw new CommandError(`Fonts in use can't be removed: ${listOf(users)}.`);
    }
    if (!draft.attachments?.[id]) {
      throw new CommandError(`This design has no file with the ID ${id}.`);
    }
    delete draft.attachments[id];
  },
);

/** The attachments the design's text entities name, by attachment ID. */
export function usedAttachments(doc: Pick<ExtrudoDocument, 'features'>): Set<AttachmentId> {
  const out = new Set<AttachmentId>();
  for (const feature of doc.features) {
    const entities = readSketch(feature)?.data.entities;
    for (const entity of Object.values(entities ?? {})) {
      if (entity.type !== 'text') continue;
      const attachment = attachmentFontId(entity.font);
      if (attachment) out.add(attachment);
    }
  }
  return out;
}

/**
 * Every attachment's SHA-256: the bytes one state of the design needs. The
 * export walks this over the document and every saved version (storage,
 * ADR-0061 §2); garbage collection walks it to keep the files in use.
 */
export function attachmentHashes(doc: Pick<ExtrudoDocument, 'attachments'>): Set<string> {
  return new Set(Object.values(doc.attachments ?? {}).map((a) => a.sha256));
}

/** The names of the sketches with a text shaped with `id`. */
function sketchesUsingAttachment(draft: DocumentDraft, id: AttachmentId): string[] {
  const names = new Set<string>();
  for (const feature of draft.features) {
    for (const input of Object.values(feature.inputs)) {
      if (input.kind === 'sketchData' && usesAttachment(input.sketch, id)) {
        names.add(feature.name);
      }
    }
  }
  return [...names];
}

/** Whether a sketch has a text shaped with `id`. */
function usesAttachment(sketch: SketchData, id: AttachmentId): boolean {
  return Object.values(sketch.entities).some(
    (entity) => entity.type === 'text' && attachmentFontId(entity.font) === id,
  );
}

function listOf(items: string[]): string {
  return items.length === 1
    ? (items[0] as string)
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
