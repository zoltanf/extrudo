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
import { KernelBudget } from './budget';
import type { FinalShape } from './final-shapes';
import type { ImportKernel, ShapeMeasure, StoredShapeStep } from './import-kernel';
import {
  binaryFormProblem,
  type FcDocument,
  MAX_STORED_BREP_BYTES,
  storedShapeText,
} from './model';
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
export { IMPORT_TIMEOUT_MS, MAX_RESTARTS, NONSENSE_REPLY, SHAPE_TIMEOUT_MS } from './budget';
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
  /** The budget to share with what ran before (the history walk); a new one from the options below when absent. */
  readonly budget?: KernelBudget;
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

/**
 * Whether one measure from the import kernel has the shape it must: a whole
 * solid count from 0 to `MAX_SOLIDS_PER_SHAPE`, finite volume, area, box
 * and centre of mass.
 */
/** The most faces or edges a measure may count (more means the kernel read something it shouldn't have). */
const MAX_ELEMENT_COUNT = 100_000_000;

export function saneMeasure(m: unknown): m is ShapeMeasure {
  if (typeof m !== 'object' || m === null) return false;
  const { solids, volume, area, box, centre, faces, edges } = m as Partial<ShapeMeasure>;
  const count = (n: unknown) =>
    n === undefined ||
    (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_ELEMENT_COUNT);
  return (
    count(faces) &&
    count(edges) &&
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
    [...box.min, ...box.max].every(Number.isFinite) &&
    Array.isArray(centre) &&
    centre.length === 3 &&
    centre.every(Number.isFinite)
  );
}

/**
 * Whether a reply from the import kernel has the shape it must: a string
 * STEP, whole solid counts from 0 to `MAX_SOLIDS_PER_SHAPE`, finite measures.
 * The kernel may have been corrupted by the text it read, so nothing else
 * about its reply is taken on trust.
 */
export function saneReply(reply: unknown): reply is StoredShapeStep {
  if (typeof reply !== 'object' || reply === null) return false;
  const r = reply as Partial<StoredShapeStep>;
  const read = r.read;
  return typeof r.step === 'string' && saneMeasure(read) && saneMeasure(r);
}

/** `|Δvolume| / volume`. */
export function volumeDrift(read: ShapeMeasure, back: ShapeMeasure): number {
  const scale = Math.max(Math.abs(read.volume), Math.abs(back.volume));
  return scale === 0 ? 0 : Math.abs(read.volume - back.volume) / scale;
}

/**
 * The B-rep text of a final shape, or why there is none. Problems the reader
 * records on the way become the left-out line's detail, not a second line.
 */
function precheck(
  doc: FcDocument,
  shape: FinalShape,
): { text: '' } | { reason: LeftOutReason; detail?: string } {
  if (shape.format === 'mesh') return { reason: 'mesh' };
  if (shape.entry === undefined) return { reason: 'empty' };
  // The sizes are the archive's own: nothing is inflated until the text is read.
  const size = doc.entries.size(shape.entry);
  if (size === undefined)
    return { reason: 'unreadable', detail: 'its stored shape is missing from the file' };
  if (size === 0) return { reason: 'empty' };
  if (shape.entry.endsWith('.bin')) return { reason: 'binary' };
  if (size > MAX_STORED_BREP_BYTES)
    return {
      reason: 'unreadable',
      detail: `its stored shape is ${Math.round(size / (1024 * 1024))} MB, more than the import's kernel reads`,
    };
  return { text: '' };
}

/** The B-rep text of a shape `precheck` passed, decoded now (after the budget's own check). */
function decodeText(
  doc: FcDocument,
  shape: FinalShape,
): { text: string } | { reason: LeftOutReason; detail?: string } {
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
  const budget = options.budget ?? new KernelBudget(options.kernel, options);
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
      const checked = precheck(doc, shape);
      if (!('text' in checked)) {
        leave(checked.reason, checked.detail);
        continue;
      }
      // Nothing is decoded once the kernel has failed too often or the time is up.
      if (budget.broken) {
        leave('restarts');
        continue;
      }
      if (budget.left() <= 0) {
        leave('import-time');
        continue;
      }
      const found = decodeText(doc, shape);
      if (!('text' in found)) {
        leave(found.reason, found.detail);
        continue;
      }
      const conv = await convertStored(budget, found.text, shape.chain);
      if (conv.kind === 'out') {
        if (conv.size !== undefined) peakBytes = Math.max(peakBytes, keptBytes + conv.size);
        leave(conv.reason, conv.detail);
        continue;
      }
      const { bytes, sha256 } = conv;
      peakBytes = Math.max(peakBytes, keptBytes + bytes.length);
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
        solids: conv.solids,
        drift: conv.drift,
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
  if (converted.length === 0)
    return { imported, leftOut, files, restarts: budget.restarts, peakBytes };
  const byHash = new Map(existing);
  design.transaction("Import the file's shapes", () => {
    for (const { shape, name, solids, drift, sha256, size } of converted) {
      let attachment = byHash.get(sha256);
      if (attachment === undefined) {
        attachment = addStepAttachment(design, name, sha256, size);
        byHash.set(sha256, attachment);
        files.set(attachment, kept.get(sha256) as Uint8Array);
      }
      const feature = design.add('import', importInputs({ file: attachment, up: 'z' }), {
        name: `Import ${name}`,
      });
      // The import names a feature's bodies `<feature>:0`, `<feature>:1` … (ADR-0030).
      setBodies(
        design,
        Array.from({ length: solids }, (_, i) => `${feature.id}:${i}`),
        shape,
        name,
      );
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
  return { imported, leftOut, files, restarts: budget.restarts, peakBytes };
}

/** What converting one stored shape came to: its STEP bytes and measures, or why it can't come in. */
export type Conversion =
  | {
      readonly kind: 'ok';
      readonly bytes: Uint8Array;
      readonly sha256: string;
      readonly solids: number;
      /** How far the STEP's volume is from the stored shape's, relative. */
      readonly drift: number;
      /** The stored shape as read, before STEP (the measure a step's rebuilt import is checked against). */
      readonly read: ShapeMeasure;
    }
  | {
      readonly kind: 'out';
      readonly reason: LeftOutReason;
      readonly detail?: string;
      /** The STEP's size, when it was made (over 25 MB). */
      readonly size?: number;
    };

/**
 * One stored shape through the import kernel (S3's conversion and checks):
 * STEP written and read back, a solid, the check against the shape as read,
 * at most `MAX_ATTACHMENT_BYTES`. The one conversion every stored shape the
 * import brings in goes through: the final shapes (`importShapes`) and a
 * body's stored-shape steps (S8, `bodies.ts`).
 */
export async function convertStored(
  budget: KernelBudget,
  text: string,
  chain: FinalShape['chain'],
): Promise<Conversion> {
  const outcome = await budget.call(
    // No name or colour in the STEP: the body's metadata carries them, and
    // two objects with the same shape then share one attachment.
    () => budget.kernel.storedShapeToStep(text, chain),
    saneReply,
  );
  // The budget restarted the kernel where it could; nothing more from the old one.
  if (outcome.kind !== 'done')
    return {
      kind: 'out',
      reason: outcome.kind,
      ...('detail' in outcome && outcome.detail ? { detail: outcome.detail } : {}),
    };
  const step = outcome.value;
  if (step.read.solids === 0 || step.step === '') return { kind: 'out', reason: 'no-solid' };
  const wrong = disagreement(step.read, step);
  if (wrong) return { kind: 'out', reason: 'check', detail: wrong };
  // From here on only the bytes and the measures: the STEP text goes.
  const bytes = new TextEncoder().encode(step.step);
  if (bytes.length > MAX_ATTACHMENT_BYTES)
    return {
      kind: 'out',
      reason: 'too-large',
      detail: `${mb(bytes.length)} MB of STEP`,
      size: bytes.length,
    };
  return {
    kind: 'ok',
    bytes,
    sha256: sha256Hex(bytes),
    solids: step.solids,
    drift: volumeDrift(step.read, step),
    read: step.read,
  };
}

/** Adds a STEP file's metadata to the design, named after `name`; returns its ID. */
export function addStepAttachment(
  design: Design,
  name: string,
  sha256: string,
  size: number,
): AttachmentId {
  const id = newId<AttachmentId>();
  design.state.dispatch(
    addAttachment({
      id,
      attachment: { name, fileName: stepFileName(name), mediaType: 'model/step', sha256, size },
    }),
  );
  return id;
}

/** The bytes the design's attachments hold, each distinct file once (ADR-0066's 100 MB counts these). */
export function attachmentBytes(design: Design, without?: AttachmentId): number {
  const seen = new Set<string>();
  let total = 0;
  for (const [id, a] of Object.entries(design.doc.attachments ?? {})) {
    if (id === without || seen.has(a.sha256)) continue;
    seen.add(a.sha256);
    total += a.size;
  }
  return total;
}

/**
 * Gives `bodies` the file's name ("Label", "Label 2" …), colour, opacity and
 * visibility of `shape`: S3's imported bodies and S5's rebuilt ones alike.
 */
export function setBodies(
  design: Design,
  bodies: readonly string[],
  shape: Pick<FinalShape, 'colour' | 'transparency' | 'visible'>,
  name: string,
): void {
  const colour = shape.colour ? hexColour(shape.colour) : undefined;
  bodies.forEach((id, i) => {
    design.setBody(id, {
      name: i === 0 ? name : `${name} ${i + 1}`,
      ...(colour && colour !== FREECAD_DEFAULT_COLOUR ? { color: colour } : {}),
      ...(shape.transparency !== undefined && shape.transparency > 0
        ? { opacity: Math.max(0.1, Math.min(1, 1 - shape.transparency)) }
        : {}),
      ...(shape.visible ? {} : { visible: false }),
    });
  });
}

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
