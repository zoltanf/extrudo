/**
 * "Add font…": the user brings a font to the design (P4-03b, ADR-0061 §3).
 * The bytes go into the project's attachment folder under their SHA-256 and
 * only the metadata goes into the document (`addAttachment`), so the design
 * carries the font wherever it goes. The file is read and parsed *before*
 * anything is stored: a file that isn't a readable font leaves no trace, which
 * also means the shaper has proved it can shape with it.
 *
 * Sizes are the store's business (`writeAttachment` refuses a file over 10 MB
 * and a design over 50 MB, ADR-0061 §2), so this shows whatever it says.
 */
import {
  type Attachment,
  type AttachmentId,
  addAttachment,
  type DocumentStore,
  newId,
} from '@extrudo/core';
import { type ProjectStore, sha256Hex } from '@extrudo/storage';
import type { FileAccess } from '../platform';
import { textModule } from './fonts';

/** What the platform's file picker is asked for: the formats opentype.js reads. */
export const FONT_ACCEPT = '.ttf,.otf,.woff,font/ttf,font/otf,font/woff';

/** The entry a Font select offers for this, its value in the select. */
export const ADD_FONT_VALUE = 'add';

/** The hint under a Font select when the design's own font is chosen. */
export const FONT_HINT = 'Saved inside this design. Only add fonts whose licence allows embedding.';

export interface AddFontDeps extends FontPicker {
  store: DocumentStore;
  /** Tells the user what happened, as any other refused edit is told. */
  notify(tone: 'info' | 'error', message: string): void;
}

/**
 * What a Font select needs to bring a font into the design: the platform's
 * file picker and the open project's storage. The platform has both (ADR-0009),
 * so the shell passes this rather than the whole platform.
 */
export interface FontPicker {
  /** Picks one file; only `pick` of the platform's file access is needed. */
  files: Pick<FileAccess, 'pick'>;
  /** The open project's storage: the bytes go there before the document names them. */
  projects: ProjectStore;
}

/** The media type a font file's extension gives, or why it can't be added. */
function mediaTypeOf(fileName: string): Attachment['mediaType'] | 'woff2' | undefined {
  if (/\.woff2$/i.test(fileName)) return 'woff2';
  if (/\.ttf$/i.test(fileName)) return 'font/ttf';
  if (/\.otf$/i.test(fileName)) return 'font/otf';
  if (/\.woff$/i.test(fileName)) return 'font/woff';
  return undefined;
}

/** A file name without its extension: what a font with no name of its own is called. */
function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || fileName;
}

/**
 * The font ID for a file the user picked, or `undefined` when they cancelled
 * or the file was refused (which it then says). The ID is
 * `attachment:<id>`: the same file added again reuses the attachment that is
 * already in the design, since the bytes are content-addressed (ADR-0061 §1).
 */
export async function addFontFile(deps: AddFontDeps): Promise<string | undefined> {
  const file = await deps.files.pick(FONT_ACCEPT);
  if (!file) return undefined;
  const doc = deps.store.getState().doc;
  const mediaType = mediaTypeOf(file.name);
  if (mediaType === 'woff2') {
    deps.notify('error', "WOFF2 isn't supported; convert the font to TTF or OTF first.");
    return undefined;
  }
  if (!mediaType) {
    deps.notify('error', 'Extrudo reads TrueType (.ttf), OpenType (.otf) and WOFF (.woff) fonts.');
    return undefined;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let name: string | undefined;
  try {
    // The parser is imported here, not at the top: a design with no text and no
    // font to add never loads it (ADR-0058 §4).
    name = (await textModule()).fontName(bytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.notify('error', `This file isn't a font Extrudo can read: ${reason}.`);
    return undefined;
  }

  const sha256 = sha256Hex(bytes);
  const stored = Object.entries(doc.attachments ?? {}).find(([, a]) => a.sha256 === sha256);
  if (stored) return `attachment:${stored[0]}`;

  const id = newId<AttachmentId>();
  try {
    // The bytes before the document that names them (ADR-0061 §2).
    await deps.projects.writeAttachment(doc.id, sha256, bytes);
  } catch (error) {
    deps.notify('error', error instanceof Error ? error.message : String(error));
    return undefined;
  }
  deps.store.getState().dispatch(
    addAttachment({
      id,
      attachment: {
        name: name ?? baseName(file.name),
        fileName: file.name,
        mediaType,
        sha256,
        size: bytes.length,
      },
    }),
  );
  return `attachment:${id}`;
}
