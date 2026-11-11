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
import { binaryFormProblem, type FcDocument, storedShapeText } from './model';
import { cleanName, clip, stepFileName } from './names';

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
/**
 * The most solids one stored shape may come back with. The import makes a
 * body (and a metadata record) per solid, so the count bounds what one reply
 * can make the design hold; the library's largest is 86. A reply above it
 * comes from a kernel that read something it shouldn't have, and is refused.
 */
export const MAX_SOLIDS_PER_SHAPE = 10_000;

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
  /** The most STEP bytes held at once while converting (kept files plus the shape at hand). */
  readonly peakBytes: number;
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

const finiteMeasure = (m: unknown): boolean => {
  if (typeof m !== 'object' || m === null) return false;
  const { solids, volume, area, box } = m as Partial<ShapeMeasure>;
  return (
    Number.isInteger(solids) &&
    (solids as number) >= 0 &&
    (solids as number) <= MAX_SOLIDS_PER_SHAPE &&
    Number.isFinite(volume) &&
    Number.isFinite(area) &&
    typeof box === 'object' &&
    box !== null &&
    Array.isArray(box.min) &&
    Array.isArray(box.max) &&
    box.min.length === 3 &&
    box.max.length === 3 &&
    [...box.min, ...box.max].every(Number.isFinite)
  );
};

/**
 * Whether a reply from the import kernel has the shape it must: a string
 * STEP, whole solid counts from 0 to `MAX_SOLIDS_PER_SHAPE`, finite measures.
 * The kernel may have been corrupted by the text it read, so nothing else
 * about its reply is taken on trust.
 */
export function saneReply(reply: unknown): reply is StoredShapeStep {
  if (typeof reply !== 'object' || reply === null) return false;
  const r = reply as Partial<StoredShapeStep>;
  return typeof r.step === 'string' && finiteMeasure(r) && finiteMeasure(r.read);
}

/** The left-out detail for a reply `saneReply` refuses. */
export const NONSENSE_REPLY = "the kernel's answer makes no sense";

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
  const binary = said.includes(binaryFormProblem(`${shape.source.name}.Shape`));
  return { reason: binary ? 'binary' : 'unreadable', detail: said.join(' ') };
}

/** A shape that passed: its measures and where its bytes are kept (no STEP text). */
interface Converted {
  shape: FinalShape;
  name: string;
  solids: number;
  drift: number;
  sha256: string;
  size: number;
}

/**
 * Converts the final shapes through the kernel, then adds one `import`
 * feature per shape that passed, in document order, as one undo step. The
 * attachment limits apply as each shape passes, so the bytes held never pass
 * the design's limit by more than the one shape being looked at.
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
  // The design's own attachments, by hash, and the bytes this import keeps.
  const existing = new Map<string, AttachmentId>();
  let total = 0;
  for (const [id, a] of Object.entries(design.doc.attachments ?? {})) {
    if (!existing.has(a.sha256)) total += a.size;
    existing.set(a.sha256, id as AttachmentId);
  }
  const kept = new Map<string, Uint8Array>();
  let keptBytes = 0;
  let peakBytes = 0;
  let restarts = 0;
  let broken = false;
  let done = 0;

  for (const shape of shapes) {
    const name = cleanName(shape.name, shape.object.name);
    const leave = (reason: LeftOutReason, detail?: string) =>
      leftOut.push({
        object: shape.object.name,
        name,
        reason,
        ...(detail ? { detail: clip(detail) } : {}),
      });
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
      let failed = outcome.kind !== 'done';
      if (outcome.kind === 'time')
        leave(
          shapeMs <= left ? 'time' : 'import-time',
          `over ${Math.round(Math.min(shapeMs, left) / 1000)} s`,
        );
      else if (outcome.kind === 'failed') leave('kernel', outcome.error);
      else if (!saneReply(outcome.value)) {
        leave('kernel', NONSENSE_REPLY);
        failed = true;
      }
      if (failed || outcome.kind !== 'done') {
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
      // From here on only the bytes and the measures: the STEP text goes.
      const bytes = new TextEncoder().encode(step.step);
      peakBytes = Math.max(peakBytes, keptBytes + bytes.length);
      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        leave('too-large', `${mb(bytes.length)} MB of STEP`);
        continue;
      }
      const sha256 = sha256Hex(bytes);
      if (!existing.has(sha256) && !kept.has(sha256)) {
        if (total + bytes.length > MAX_ATTACHMENTS_BYTES) {
          leave('design-full', `${mb(bytes.length)} MB of STEP`);
          continue;
        }
        kept.set(sha256, bytes);
        keptBytes += bytes.length;
        total += bytes.length;
      }
      converted.push({
        shape,
        name,
        solids: step.solids,
        drift: volumeDrift(step.read, step),
        sha256,
        size: bytes.length,
      });
    } finally {
      done++;
      options.onProgress?.(done, shapes.length);
    }
  }

  const imported: ImportedShape[] = [];
  const files = new Map<AttachmentId, Uint8Array>();
  if (converted.length === 0) return { imported, leftOut, files, restarts, peakBytes };
  const byHash = new Map(existing);
  design.transaction("Import the file's shapes", () => {
    for (const { shape, name, solids, drift, sha256, size } of converted) {
      let attachment = byHash.get(sha256);
      if (attachment === undefined) {
        attachment = newId<AttachmentId>();
        design.state.dispatch(
          addAttachment({
            id: attachment,
            attachment: {
              name,
              fileName: stepFileName(name),
              mediaType: 'model/step',
              sha256,
              size,
            },
          }),
        );
        byHash.set(sha256, attachment);
        files.set(attachment, kept.get(sha256) as Uint8Array);
      }
      const feature = design.add('import', importInputs({ file: attachment, up: 'z' }), {
        name: `Import ${name}`,
      });
      const colour = shape.colour ? hexColour(shape.colour) : undefined;
      // The import names a feature's bodies `<feature>:0`, `<feature>:1` … (ADR-0030).
      for (let i = 0; i < solids; i++) {
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
        solids,
        drift,
        stepBytes: size,
      });
    }
  });
  return { imported, leftOut, files, restarts, peakBytes };
}

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
