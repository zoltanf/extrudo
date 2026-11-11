/**
 * The shapes-only import (P6-25 S3, ADR-0144): each of a file's final shapes
 * becomes an `import` feature whose attachment is STEP the import's own
 * kernel wrote from the stored B-rep text, named, coloured and shown or
 * hidden as the file has it. Nothing is trusted because it converted: a
 * shape comes in only when the STEP read back has the stored shape's solids,
 * volume and box (decision 3). A conversion that fails, traps or runs out of
 * time leaves the shape out and the kernel is replaced (S1's amendment).
 */
import type { Design } from '@extrudo/api';
import { type AttachmentId, addAttachment, importInputs, newId } from '@extrudo/core';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_BYTES, sha256Hex } from '@extrudo/storage';
import type { FinalShape } from './final-shapes';
import type { ImportKernel, ShapeMeasure, StoredShapeStep } from './import-kernel';
import { type FcDocument, storedShapeText } from './model';

/**
 * How far the STEP read back may differ from the stored shape in volume,
 * relative. The 60-file library's largest drift through STEP is 1.3e-4
 * (S1's amendment; S3's run in the ADR): ten times that leaves room and
 * still catches a shape that lost or gained a piece.
 */
export const VOLUME_TOLERANCE = 1e-3;
/** How far a box corner may move through STEP, relative to the box's diagonal (plus 1e-6 mm). */
export const BOX_TOLERANCE = 1e-4;
/** One shape's conversion (read, place, write, read back). The library's slowest takes about a second. */
export const SHAPE_TIMEOUT_MS = 60_000;
/** The whole import. The library's slowest file takes about ten seconds. */
export const IMPORT_TIMEOUT_MS = 10 * 60_000;
/** How many times a failed kernel is replaced before the rest of the shapes are left out. */
export const MAX_RESTARTS = 3;

export type LeftOutReason =
  /** A mesh object (S12). */
  | 'mesh'
  /** The object stores no shape, or an empty one. */
  | 'empty'
  /** FreeCAD's binary shape form, which is not read. */
  | 'binary'
  /** The stored shape is missing from the file or can't be read out of it. */
  | 'unreadable'
  /** The stored shape has no solid. */
  | 'no-solid'
  /** The STEP read back differs from the stored shape. */
  | 'check'
  /** Its STEP is over the 25 MB a file attachment may be. */
  | 'too-large'
  /** It would take the design's attachments over 100 MB. */
  | 'design-full'
  /** The kernel refused it or failed on it. */
  | 'kernel'
  /** Its conversion ran over its time. */
  | 'time'
  /** The import's own time ran out before it. */
  | 'import-time'
  /** The kernel failed too often before it. */
  | 'restarts';

export interface LeftOutShape {
  /** The FreeCAD object's internal name (`Pad001`), unique in its file. */
  readonly object: string;
  /** Its label, the name the user knows. */
  readonly name: string;
  readonly reason: LeftOutReason;
  /** What exactly: the kernel's message, the measures that differ. */
  readonly detail?: string;
}

export interface ImportedShape {
  /** The FreeCAD object's internal name, unique in its file. */
  readonly object: string;
  /** Its label: the body's name. */
  readonly name: string;
  /** The `import` feature that holds it. */
  readonly feature: string;
  readonly solids: number;
  /** How far the STEP's volume is from the stored shape's, relative. */
  readonly drift: number;
  readonly stepBytes: number;
}

export interface ShapeImportOptions {
  readonly kernel: ImportKernel;
  readonly shapeTimeoutMs?: number;
  readonly importTimeoutMs?: number;
  readonly maxRestarts?: number;
  /** Hears each shape done (in, left out or failed), of how many. */
  readonly onProgress?: (done: number, total: number) => void;
  /** The clock, for the budgets (`Date.now` by default). */
  readonly now?: () => number;
}

export interface ShapeImportResult {
  readonly imported: ImportedShape[];
  readonly leftOut: LeftOutShape[];
  /** The STEP bytes of the attachments made, by ID: write them before the document. */
  readonly files: Map<AttachmentId, Uint8Array>;
  /** How many times the kernel was replaced. */
  readonly restarts: number;
}

/**
 * FreeCAD's default shape colour, which every shape the author never
 * coloured carries (207 of the library's 383 final shapes): such a body
 * takes Extrudo's own default instead of a stored grey.
 */
export const FREECAD_DEFAULT_COLOUR = '#cccccc';

/** `#rrggbb` from 0–1 channels. */
export function hexColour(rgb: readonly [number, number, number]): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Why the STEP read back is not the stored shape, or `undefined` when it is. */
export function disagreement(read: ShapeMeasure, back: ShapeMeasure): string | undefined {
  if (back.solids !== read.solids)
    return `${read.solids} solid${read.solids === 1 ? '' : 's'} stored, ${back.solids} after STEP`;
  const drift = volumeDrift(read, back);
  if (!(drift <= VOLUME_TOLERANCE))
    return `the volume differs by ${(drift * 100).toPrecision(2)} %`;
  const diagonal = Math.hypot(...read.box.max.map((v, i) => v - (read.box.min[i] as number)));
  const allowed = BOX_TOLERANCE * diagonal + 1e-6;
  const corners = [...read.box.min, ...read.box.max];
  const after = [...back.box.min, ...back.box.max];
  const moved = Math.max(...corners.map((v, i) => Math.abs(v - (after[i] as number))));
  if (!(moved <= allowed)) return `the bounding box moved by ${moved.toPrecision(3)} mm`;
  return undefined;
}

/** `|Δvolume| / volume`. */
export function volumeDrift(read: ShapeMeasure, back: ShapeMeasure): number {
  const scale = Math.max(Math.abs(read.volume), Math.abs(back.volume));
  return scale === 0 ? 0 : Math.abs(read.volume - back.volume) / scale;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Outcome =
  | { kind: 'done'; value: StoredShapeStep }
  | { kind: 'failed'; error: string }
  | { kind: 'time' };

/** `work` or its time running out, whichever comes first; a late result is dropped. */
async function within(work: Promise<StoredShapeStep>, ms: number): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const out = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'time' }), Math.max(0, ms));
  });
  try {
    return await Promise.race([
      work.then(
        (value): Outcome => ({ kind: 'done', value }),
        (error: unknown): Outcome => ({ kind: 'failed', error: message(error) }),
      ),
      out,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The B-rep text of a final shape, or why there is none. Problems the reader
 * records on the way become the left-out line's detail, not a second line.
 */
function textOf(
  doc: FcDocument,
  shape: FinalShape,
): { text: string } | { reason: LeftOutReason; detail?: string } {
  if (shape.format === 'mesh') return { reason: 'mesh' };
  if (shape.entry === undefined) return { reason: 'empty' };
  // The sizes are the archive's own: nothing is inflated until the text is read.
  const size = doc.entries.size(shape.entry);
  if (size === undefined)
    return { reason: 'unreadable', detail: 'its stored shape is missing from the file' };
  if (size === 0) return { reason: 'empty' };
  if (shape.entry.endsWith('.bin')) return { reason: 'binary' };
  const before = doc.problems.length;
  const text = storedShapeText(doc, shape.source);
  const said = doc.problems.splice(before);
  if (text !== undefined) return { text };
  const detail = said.join(' ');
  return { reason: /binary form/.test(detail) ? 'binary' : 'unreadable', detail };
}

interface Converted {
  shape: FinalShape;
  step: StoredShapeStep;
  bytes: Uint8Array;
}

/**
 * Converts the final shapes through the kernel, then adds one `import`
 * feature per shape that passed, in document order, as one undo step.
 */
export async function importShapes(
  doc: FcDocument,
  shapes: readonly FinalShape[],
  design: Design,
  options: ShapeImportOptions,
): Promise<ShapeImportResult> {
  const { kernel } = options;
  const now = options.now ?? Date.now;
  const shapeMs = options.shapeTimeoutMs ?? SHAPE_TIMEOUT_MS;
  const importMs = options.importTimeoutMs ?? IMPORT_TIMEOUT_MS;
  const maxRestarts = options.maxRestarts ?? MAX_RESTARTS;
  const start = now();
  const leftOut: LeftOutShape[] = [];
  const converted: Converted[] = [];
  let restarts = 0;
  let broken = false;
  let done = 0;

  for (const shape of shapes) {
    const name = shape.name;
    const leave = (reason: LeftOutReason, detail?: string) =>
      leftOut.push({ object: shape.object.name, name, reason, ...(detail ? { detail } : {}) });
    try {
      const found = textOf(doc, shape);
      if (!('text' in found)) {
        leave(found.reason, found.detail);
        continue;
      }
      if (broken) {
        leave('restarts');
        continue;
      }
      const left = start + importMs - now();
      if (left <= 0) {
        leave('import-time');
        continue;
      }
      const outcome = await within(
        // No name or colour in the STEP: the body's metadata carries them, and
        // two objects with the same shape then share one attachment.
        kernel.storedShapeToStep(found.text, shape.chain),
        Math.min(shapeMs, left),
      );
      if (outcome.kind !== 'done') {
        if (outcome.kind === 'time')
          leave(
            shapeMs <= left ? 'time' : 'import-time',
            `over ${Math.round(Math.min(shapeMs, left) / 1000)} s`,
          );
        else leave('kernel', outcome.error);
        // A failed kernel may be corrupted: nothing more from it.
        if (restarts >= maxRestarts) {
          broken = true;
          continue;
        }
        restarts++;
        try {
          await kernel.restart();
        } catch {
          // No new kernel: the shapes after this one are left out as `restarts`.
          broken = true;
        }
        continue;
      }
      const step = outcome.value;
      if (step.read.solids === 0 || step.step === '') {
        leave('no-solid');
        continue;
      }
      const wrong = disagreement(step.read, step);
      if (wrong) {
        leave('check', wrong);
        continue;
      }
      converted.push({ shape, step, bytes: new TextEncoder().encode(step.step) });
    } finally {
      done++;
      options.onProgress?.(done, shapes.length);
    }
  }

  const imported: ImportedShape[] = [];
  const files = new Map<AttachmentId, Uint8Array>();
  if (converted.length === 0) return { imported, leftOut, files, restarts };
  const sizes = new Map<string, number>();
  for (const a of Object.values(design.doc.attachments ?? {})) sizes.set(a.sha256, a.size);
  let total = [...sizes.values()].reduce((a, b) => a + b, 0);
  const byHash = new Map<string, AttachmentId>();
  for (const [id, a] of Object.entries(design.doc.attachments ?? {}))
    byHash.set(a.sha256, id as AttachmentId);

  design.transaction("Import the file's shapes", () => {
    for (const { shape, step, bytes } of converted) {
      const name = shape.name;
      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        leftOut.push({
          object: shape.object.name,
          name,
          reason: 'too-large',
          detail: `${mb(bytes.length)} MB of STEP`,
        });
        continue;
      }
      const sha256 = sha256Hex(bytes);
      let attachment = byHash.get(sha256);
      if (attachment === undefined) {
        if (total + bytes.length > MAX_ATTACHMENTS_BYTES) {
          leftOut.push({
            object: shape.object.name,
            name,
            reason: 'design-full',
            detail: `${mb(bytes.length)} MB of STEP`,
          });
          continue;
        }
        attachment = newId<AttachmentId>();
        design.state.dispatch(
          addAttachment({
            id: attachment,
            attachment: {
              name,
              fileName: `${name}.step`,
              mediaType: 'model/step',
              sha256,
              size: bytes.length,
            },
          }),
        );
        total += bytes.length;
        byHash.set(sha256, attachment);
        files.set(attachment, bytes);
      }
      const feature = design.add('import', importInputs({ file: attachment, up: 'z' }), {
        name: `Import ${name}`,
      });
      const colour = shape.colour ? hexColour(shape.colour) : undefined;
      // The import names a feature's bodies `<feature>:0`, `<feature>:1` … (ADR-0030).
      for (let i = 0; i < step.solids; i++) {
        design.setBody(`${feature.id}:${i}`, {
          name: i === 0 ? name : `${name} ${i + 1}`,
          ...(colour && colour !== FREECAD_DEFAULT_COLOUR ? { color: colour } : {}),
          ...(shape.transparency !== undefined && shape.transparency > 0
            ? { opacity: Math.max(0.1, Math.min(1, 1 - shape.transparency)) }
            : {}),
          ...(shape.visible ? {} : { visible: false }),
        });
      }
      imported.push({
        object: shape.object.name,
        name,
        feature: feature.id,
        solids: step.solids,
        drift: volumeDrift(step.read, step),
        stepBytes: bytes.length,
      });
    }
  });
  return { imported, leftOut, files, restarts };
}

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
