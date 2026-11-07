/**
 * Insert Design, Copied (P6-26, ADR-0140, issue #75): the Solid tab's Assemble ›
 * Insert Design picks another `.extrudo` file through the platform's file
 * access (a file input on the web, the native dialog on the desktop), and its
 * design comes in as one timeline feature whose bodies make one component named
 * after the file. No link to the file is kept; Move places the component.
 *
 * The files the copy needs (its fonts, its imported models) are stored with
 * this design **before** the document names them (ADR-0061 §2), and put in the
 * app's attachment cache so the kernel finds them on the first recompute.
 */
import {
  type AttachmentId,
  baseName,
  CommandError,
  type ComponentId,
  type DocumentStore,
  type FeatureId,
  FILE_EXTENSION,
  insertDesign,
  insertDesignPayload,
  newId,
} from '@extrudo/core';
import { type ProjectStore, readArchive } from '@extrudo/storage';
import type { FileAccess } from '../platform';
import { putAttachmentBytes } from '../sketch/fonts';

/** What Insert Design's picker offers: Extrudo designs (the zip type for browsers that name it so). */
export const INSERT_DESIGN_ACCEPT = `${FILE_EXTENSION},application/zip`;

/** What the app says when the picked file isn't an Extrudo design. */
export const INSERT_DESIGN_REFUSED =
  'Insert Design takes an Extrudo design (.extrudo). For STEP, mesh and OpenSCAD files use Import Model.';

/**
 * Picks an `.extrudo` file and inserts its design as a component (one undo
 * step). Answers the new component's ID, or `undefined` when the user cancels
 * or the file can't be inserted, which it then says.
 */
export async function insertDesignFile(deps: {
  files: Pick<FileAccess, 'pick'>;
  projects: Pick<ProjectStore, 'writeAttachment'>;
  store: DocumentStore;
  notify(tone: 'info' | 'error', message: string): void;
}): Promise<ComponentId | undefined> {
  const file = await deps.files.pick(INSERT_DESIGN_ACCEPT);
  if (!file) return undefined;
  if (!file.name.toLowerCase().endsWith(FILE_EXTENSION)) {
    deps.notify('error', INSERT_DESIGN_REFUSED);
    return undefined;
  }
  let archive: ReturnType<typeof readArchive>;
  try {
    archive = readArchive(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    deps.notify('error', `${file.name} can't be inserted: ${why}`);
    return undefined;
  }
  const doc = deps.store.getState().doc;
  let payload: ReturnType<typeof insertDesignPayload>;
  try {
    payload = insertDesignPayload(
      doc,
      archive.doc,
      {
        feature: newId<FeatureId>(),
        component: newId<ComponentId>(),
        attachment: () => newId<AttachmentId>(),
      },
      baseName(file.name),
    );
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    deps.notify('error', error.message);
    return undefined;
  }
  try {
    for (const [id, record] of Object.entries(payload.attachments)) {
      const bytes = archive.attachments.get(record.sha256);
      // Missing bytes are the source's own state: the feature that reads them says so.
      if (!bytes) continue;
      await deps.projects.writeAttachment(doc.id, record.sha256, bytes);
      putAttachmentBytes(id as AttachmentId, bytes);
    }
  } catch (error) {
    deps.notify('error', error instanceof Error ? error.message : String(error));
    return undefined;
  }
  try {
    deps.store.getState().dispatch(insertDesign(payload));
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    deps.notify('error', error.message);
    return undefined;
  }
  deps.notify(
    'info',
    `${file.name} is in the design as the component ${payload.component.name}. Move it into place with Move.`,
  );
  return payload.component.id;
}
