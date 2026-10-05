/**
 * The Import dialog and the file it reads (P4-06, ADR-0066 §0, §2): the
 * Insert tab's "Import" tile (tool `importBody`) and the File menu's "Import…"
 * pick a STEP or mesh file, store its bytes with the design and open this
 * dialog (an OpenSCAD file too, P5-04: its customizer variables are rows of
 * overrides, `ScadOverrides.tsx`); OK adds the attachment record and the
 * `import` feature **in one undo
 * step** (`spec.commitWith`, the framework's one transaction around both).
 *
 * The bytes go to storage **before** the dialog opens (ADR-0061 §2: a design
 * must never name a file that isn't there), and into the app's attachment
 * cache under its new ID (`putAttachmentBytes`), so the dialog's live preview
 * finds them through the `Recomputer`'s `addFile` before the document names
 * them. Cancel adds nothing: `collectAttachments` gathers the bytes up later.
 *
 * The dialog has no field for the file itself: replacing it is Deferred
 * (ADR-0066 §2), so the file is a read-only line, and `Units` shows for a mesh
 * only (a STEP file converts its own units).
 */
import {
  type Attachment,
  type AttachmentId,
  addAttachment,
  type Command,
  type DocumentStore,
  type ExtrudoDocument,
  type FeatureInputs,
  IMPORT_UNITS,
  IMPORT_UP,
  type ImportInputs,
  importFeature,
  importInputs,
  isMeshMediaType,
  isScadMediaType,
  mediaTypeOf,
  modelKind,
  newId,
} from '@extrudo/core';
import { type ProjectStore, sha256Hex } from '@extrudo/storage';
import { createStore } from 'zustand/vanilla';
import type { FileAccess } from '../platform';
import { putAttachmentBytes } from '../sketch/fonts';
import { ScadOverrides } from './ScadOverrides';
import { overrideInputs, overrideIssue, overrideValues } from './scadRows';
import { type DialogContext, type DialogValues, defineFeatureDialog } from './spec';
import { defaultFromInputs, shownFields } from './values';

/** What the platform's file picker is asked for: the model files of §0. */
export const IMPORT_ACCEPT = '.step,.stp,.stl,.3mf,.obj,.scad';

/** What a file the picker refuses says so, in the app's voice. */
export const IMPORT_REFUSED =
  'Extrudo imports STEP files (.step, .stp), meshes (.stl, .3mf, .obj) and OpenSCAD files (.scad).';

/** The file the dialog is about, while it is open (the picked bytes and record). */
export interface PendingImport {
  id: AttachmentId;
  /** What the record says (name, file name, media type, hash, size). */
  attachment: Attachment;
}

export const pendingImportStore = createStore<{ pending?: PendingImport }>()(() => ({}));

/** The file the Import dialog is about, or `undefined` when none is. */
export function pendingImport(): PendingImport | undefined {
  return pendingImportStore.getState().pending;
}

/**
 * Picks a model file and puts its bytes with the design (ADR-0061 §2), ready
 * for the dialog to preview: the new attachment's ID, its record, and the
 * bytes in the app's cache under that ID. `undefined` when the user cancels or
 * the file is refused, which it then says.
 */
export async function pickImportFile(deps: {
  files: Pick<FileAccess, 'pick'>;
  projects: ProjectStore;
  store: DocumentStore;
  notify(tone: 'info' | 'error', message: string): void;
}): Promise<PendingImport | undefined> {
  const file = await deps.files.pick(IMPORT_ACCEPT);
  if (!file) return undefined;
  const mediaType = mediaTypeOf(file.name);
  if (!modelKind(mediaType)) {
    deps.notify('error', IMPORT_REFUSED);
    return undefined;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = deps.store.getState().doc;
  const sha256 = sha256Hex(bytes);
  // The same file twice is one attachment (the bytes are content-addressed).
  const stored = Object.entries(doc.attachments ?? {}).find(([, a]) => a.sha256 === sha256);
  if (stored) {
    const pending = { id: stored[0] as AttachmentId, attachment: stored[1] as Attachment };
    pendingImportStore.setState({ pending });
    return pending;
  }
  const id = newId<AttachmentId>();
  try {
    await deps.projects.writeAttachment(doc.id, sha256, bytes);
  } catch (error) {
    deps.notify('error', error instanceof Error ? error.message : String(error));
    return undefined;
  }
  const pending: PendingImport = {
    id,
    attachment: {
      name: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      // `modelKind` said yes, so this is one of the model types.
      mediaType: mediaType as Attachment['mediaType'],
      sha256,
      size: bytes.length,
    },
  };
  // In the cache before the document names it, so the dialog's preview (which
  // asks the kernel through `addFile`) finds the bytes (ADR-0066 §0).
  putAttachmentBytes(id, bytes);
  pendingImportStore.setState({ pending });
  return pending;
}

/** Forgets the picked file: the dialog was cancelled, or its feature is stored. */
export function clearPendingImport(): void {
  pendingImportStore.setState({ pending: undefined });
}

/**
 * The attachment an Import dialog is about: the one just picked, or (editing)
 * the file the stored feature names.
 */
export function importedFile(ctx: DialogContext): PendingImport | undefined {
  if (ctx.feature) {
    const file = ctx.feature.inputs.file;
    if (file?.kind === 'file') {
      const attachment = ctx.doc.attachments?.[file.id];
      if (attachment) return { id: file.id, attachment };
    }
  }
  return pendingImport();
}

/**
 * The media type of a file the design carries, or of one just picked and not in
 * the document yet (the dialog previews it before OK adds the record): what the
 * `Recomputer` sends with the bytes (ADR-0066 §0).
 */
export function fileMediaType(id: AttachmentId, doc: ExtrudoDocument): string | undefined {
  const pending = pendingImport();
  if (pending?.id === id) return pending.attachment.mediaType;
  return doc.attachments?.[id]?.mediaType;
}

/**
 * What a file the design carries is called, the way `fileMediaType` says what
 * it is: a message from the kernel about a file the dialog previews names the
 * file the user picked, not the ID it doesn't have a record for yet.
 */
export function fileName(id: AttachmentId, doc: ExtrudoDocument): string | undefined {
  const pending = pendingImport();
  if (pending?.id === id) return pending.attachment.fileName;
  return doc.attachments?.[id]?.fileName;
}

/** Whether the dialog's file is a mesh: then it has a `units` field. */
function isMesh(ctx: DialogContext): boolean {
  return isMeshMediaType(importedFile(ctx)?.attachment.mediaType);
}

export const importDialog = defineFeatureDialog({
  ...importFeature,
  command: 'importBody',
  fields: [
    {
      kind: 'info',
      name: 'file',
      label: 'File',
      text: (_values, ctx) => {
        const file = importedFile(ctx);
        if (!file) return 'No file';
        const kind = isScadMediaType(file.attachment.mediaType) ? ' · OpenSCAD' : '';
        return `${file.attachment.fileName} · ${formatSize(file.attachment.size)}${kind}`;
      },
    },
    {
      kind: 'choice',
      name: 'units',
      label: 'Units',
      // Meshes only: a STEP file carries its own units (ADR-0066 §2).
      shown: (_values, ctx) => (ctx ? isMesh(ctx) : false),
      options: IMPORT_UNITS.map((value) => ({
        value,
        label: value === 'auto' ? 'As the file says' : value.toUpperCase(),
      })),
      default: 'auto',
      hint: "What unit the file's numbers are in. Extrudo assumes millimetres.",
    },
    {
      kind: 'choice',
      name: 'up',
      label: 'Up',
      options: IMPORT_UP.map((value) => ({
        value,
        label: value === 'z' ? 'Z up' : 'Y up',
      })),
      default: 'z',
      hint: 'Which way the file points up. Y-up files are turned a quarter turn about X.',
    },
  ],
  toInputs(values: DialogValues, ctx: DialogContext): ImportInputs {
    // With no file the inputs are invalid, and `validate` says so in the
    // dialog's own words; the framework shows that instead of this.
    const file = importedFile(ctx);
    // A hidden field makes no input (as everywhere): `units` is a mesh's only.
    const units = shownFields(importDialog, values, ctx).some((f) => f.name === 'units');
    const inputs = importInputs({
      file: file?.id ?? ('' as AttachmentId),
      ...(units && values.choices.units && { units: values.choices.units as 'auto' | 'mm' }),
      up: (values.choices.up ?? 'z') as 'z' | 'y',
    });
    // An OpenSCAD file's overrides, packed in the rows' order (ADR-0071 §5).
    return isScadMediaType(file?.attachment.mediaType)
      ? { ...inputs, ...overrideInputs(values, ctx.doc) }
      : inputs;
  },
  fromInputs(inputs: FeatureInputs, _ctx: DialogContext) {
    const stored = defaultFromInputs(importDialog, inputs);
    const scad = overrideValues(inputs);
    return {
      ...stored,
      exprs: { ...stored.exprs, ...scad.exprs },
      labels: { ...stored.labels, ...scad.labels },
    };
  },
  validate(values: DialogValues, ctx: DialogContext) {
    const file = importedFile(ctx);
    if (!file) return { message: 'Pick a file to import.', field: 'file' };
    return isScadMediaType(file.attachment.mediaType) ? overrideIssue(values, ctx.doc) : undefined;
  },
  // An OpenSCAD file's variables, one row each (P5-04 slice 2).
  extra: ScadOverrides,
  // The attachment record, in the same undo step as the feature (ADR-0066 §0).
  commitWith(_values: DialogValues, ctx: DialogContext): readonly Command<unknown>[] {
    const file = importedFile(ctx);
    if (!file || ctx.feature) return [];
    // The same file added again is the attachment that is already there.
    if (ctx.doc.attachments?.[file.id]) return [];
    // Committed: the picked file is the design's now.
    clearPendingImport();
    return [addAttachment({ id: file.id, attachment: file.attachment })];
  },
});

/** A file size as the dialog shows it: bytes, then kB and MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}
