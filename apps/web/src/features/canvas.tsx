/**
 * The Canvas tool, its dialog and the calibration of its image (P4-06,
 * ADR-0066 §5, FR-IO-07): the Insert tab's "Canvas" tile picks a PNG, JPEG
 * or WebP, stores its bytes with the design and opens the dialog, which
 * previews the picture on its plane. OK adds the attachment record and the
 * `canvas` feature **in one undo step** (`spec.commitWith`, as for an
 * `import`).
 *
 * The bytes go to storage **before** the dialog opens (ADR-0061 §2: a design
 * must never name a file that isn't there) and into the app's attachment
 * cache under its new ID (`putAttachmentBytes`), so the view decodes the very
 * picture the dialog previews without asking the worker for anything: **a
 * canvas's image never reaches the kernel** (ADR-0066 §5). Cancel adds
 * nothing; `collectAttachments` gathers the bytes up later.
 *
 * **Calibrate** (the dialog's own UI, `spec.extra`): a picture comes in at
 * 100 dpi, which is a guess. Calibrate takes the next two clicks on the
 * canvas's plane (the plane picker's world point, as a hole's `placeAt`,
 * ADR-0049) as two points of known length; the dialog then asks what that
 * length really is, and Apply makes the width the one that matches
 * (`calibratedWidth`). The points are drawn in the view as two dots and the
 * line between them.
 */
import {
  type Attachment,
  type AttachmentId,
  addAttachment,
  CANVAS_MEDIA_TYPES,
  CANVAS_NUMBERS,
  type CanvasInputs,
  type Command,
  canvasFeature,
  canvasInputs,
  DEFAULT_PLACEMENT,
  type DocumentStore,
  type FeatureId,
  formatQuantity,
  LENGTH,
  mediaTypeOf,
  newId,
  type SketchFrame,
  type UnitKind,
  type Vec3,
  worldToSketch,
} from '@extrudo/core';
import { type ProjectStore, sha256Hex } from '@extrudo/storage';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { Button } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import type { FileAccess } from '../platform';
import { putAttachmentBytes } from '../sketch/fonts';
import { calibratedWidth, planeDistance, widthForPixels } from '../viewport/canvasGeometry';
import { canvasPixels, rememberCanvasPixels } from '../viewport/canvasImages';
import { placementFrame } from './primitives';
import {
  type DialogContext,
  type DialogExtraProps,
  type DialogValues,
  defineFeatureDialog,
  type ManipulatorContext,
  type ProposeContext,
} from './spec';
import { shownFields } from './values';

/** What the platform's file picker is asked for: the pictures of §0. */
export const CANVAS_ACCEPT = '.png,.jpg,.jpeg,.webp';

/** What a file the picker refuses says so, in the app's voice. */
export const CANVAS_REFUSED =
  'Extrudo reads a canvas image from a PNG, JPEG or WebP file (.png, .jpg, .jpeg, .webp).';

/** The real distance a calibration asks for until the user types one, mm. */
export const DEFAULT_REAL_DISTANCE = '10 mm';

// ------------------------------------------------------------------- picking

/** The file the dialog is about, while it is open: the picked bytes and record. */
export interface PendingCanvas {
  id: AttachmentId;
  /** What the record says (name, file name, media type, hash, size). */
  attachment: Attachment;
}

export const pendingCanvasStore = createStore<{ pending?: PendingCanvas }>()(() => ({}));

/** The file the Canvas dialog is about, or `undefined` when none is. */
export function pendingCanvas(): PendingCanvas | undefined {
  return pendingCanvasStore.getState().pending;
}

/** Forgets the picked file: the dialog was cancelled, or its feature is stored. */
export function clearPendingCanvas(): void {
  pendingCanvasStore.setState({ pending: undefined });
}

/**
 * Picks an image and puts its bytes with the design (ADR-0061 §2), ready for
 * the dialog to preview: the new attachment's ID, its record, the bytes in
 * the app's cache under that ID and the picture's pixel size (the width the
 * dialog proposes comes from it). `undefined` when the user cancels or the
 * file is refused, which it then says.
 */
export async function pickCanvasFile(deps: {
  files: Pick<FileAccess, 'pick'>;
  projects: ProjectStore;
  store: DocumentStore;
  notify(tone: 'info' | 'error', message: string): void;
}): Promise<PendingCanvas | undefined> {
  const file = await deps.files.pick(CANVAS_ACCEPT);
  if (!file) return undefined;
  const mediaType = mediaTypeOf(file.name);
  if (!mediaType || !CANVAS_MEDIA_TYPES.includes(mediaType)) {
    deps.notify('error', CANVAS_REFUSED);
    return undefined;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = deps.store.getState().doc;
  const sha256 = sha256Hex(bytes);
  // The same picture twice is one attachment (the bytes are content-addressed).
  const stored = Object.entries(doc.attachments ?? {}).find(([, a]) => a.sha256 === sha256);
  const id = (stored?.[0] as AttachmentId | undefined) ?? newId<AttachmentId>();
  if (!stored) {
    try {
      await deps.projects.writeAttachment(doc.id, sha256, bytes);
    } catch (error) {
      deps.notify('error', error instanceof Error ? error.message : String(error));
      return undefined;
    }
    // In the cache before the document names it, so the dialog's preview and
    // the view find the picture (ADR-0066 §0, §5).
    putAttachmentBytes(id, bytes);
  }
  const pending: PendingCanvas = {
    id,
    attachment: stored?.[1] ?? {
      name: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      // `CANVAS_MEDIA_TYPES` said yes, so this is one of the image types.
      mediaType: mediaType as Attachment['mediaType'],
      sha256,
      size: bytes.length,
    },
  };
  await rememberPixels(id, bytes.slice());
  pendingCanvasStore.setState({ pending });
  return pending;
}

/** What a picked picture is in pixels, for the width the dialog proposes. */
async function rememberPixels(id: AttachmentId, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    rememberCanvasPixels(id, { width: bitmap.width, height: bitmap.height });
    bitmap.close();
  } catch {
    // A picture nothing can decode: the width keeps its default and the view
    // draws nothing, which is what an unreadable image is worth.
  }
}

/**
 * The image the dialog is about: the one just picked, or (editing) the file
 * the stored feature names.
 */
export function canvasFile(ctx: Pick<DialogContext, 'doc' | 'feature'>): PendingCanvas | undefined {
  const input = ctx.feature?.inputs.image;
  if (input?.kind === 'file') {
    const attachment = ctx.doc.attachments?.[input.id];
    if (attachment) return { id: input.id, attachment };
  }
  return pendingCanvas();
}

// ------------------------------------------------------------------- fields

/** What each number field says about itself, under the field and in its tooltip. */
const NUMBER_HINTS: Record<string, string> = {
  x: 'Where the picture sits along the plane, from the plane origin.',
  y: 'Where the picture sits along the plane, from the plane origin.',
  width: 'How wide the picture is. The height follows the picture itself.',
  rotation: 'Turns the picture about the plane normal.',
  opacity: 'How strongly the picture shows over the model.',
};

/** The dialog's number fields, in the order it lists them (`CANVAS_NUMBERS`). */
const numberFields = CANVAS_NUMBERS.map((number) => ({
  kind: 'expression' as const,
  name: number.name,
  label: number.label,
  unit: number.unit as UnitKind,
  default: number.default,
  hint: NUMBER_HINTS[number.name],
}));

/** The width a canvas of this image starts at: its pixels at 100 dpi, or nothing. */
export function proposedWidth(ctx: DialogContext): string | undefined {
  const file = canvasFile(ctx);
  if (!file) return undefined;
  const pixels = canvasPixels(file.id);
  return pixels ? widthForPixels(pixels.width) : undefined;
}

/**
 * What the dialog proposes for what the user hasn't set: the XY plane (as a
 * primitive does, ADR-0032) and the image's own width at 100 dpi, which the
 * document can't work out by itself (ADR-0066 §5).
 */
export function proposeCanvas(
  values: DialogValues,
  ctx: Pick<ProposeContext, 'doc' | 'bodies' | 'construction' | 'sketches' | 'value' | 'chosen'>,
): Partial<DialogValues> | undefined {
  const out: { refs?: DialogValues['refs']; exprs?: Record<string, string> } = {};
  if ((values.refs.plane?.length ?? 0) === 0) out.refs = { plane: [DEFAULT_PLACEMENT] };
  if (!ctx.chosen?.('width')) {
    const width = proposedWidth(ctx);
    if (width) out.exprs = { width };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A canvas feature's inputs from the dialog's values, with the image's attachment. */
export function canvasDialogInputs(values: DialogValues, ctx: DialogContext): CanvasInputs {
  const file = canvasFile(ctx);
  const shown = new Set(shownFields(canvasDialog, values, ctx).map((f) => f.name));
  const numbers: Record<string, string> = {};
  for (const number of CANVAS_NUMBERS) {
    if (!shown.has(number.name)) continue;
    const expr = values.exprs[number.name];
    numbers[number.name] = expr && expr.trim().length > 0 ? expr : number.default;
  }
  return canvasInputs({
    image: file?.id ?? ('' as AttachmentId),
    ...(values.refs.plane?.[0] && { plane: values.refs.plane[0] }),
    numbers,
    flip: values.toggles.flip ?? false,
  });
}

/**
 * What keeps the dialog's OK disabled, beyond the fields' own: a canvas with
 * no picture, which only Cancel can leave behind. **The numbers are the
 * kernel's business** (a width of nothing, an opacity out of 0.05…1,
 * ADR-0066 §5): its verdict comes back with the live preview and keeps OK
 * disabled, like every other feature's.
 */
export function checkCanvas(
  _values: DialogValues,
  ctx: Pick<DialogContext, 'doc' | 'feature'>,
): { message: string; field: string } | undefined {
  return canvasFile(ctx)
    ? undefined
    : { message: 'Pick a picture to put on the plane.', field: 'image' };
}

/**
 * A click on the canvas's plane: while a calibration runs it marks a point
 * (the dialog's Calibrate panel takes it from there, `markCalibrationPoint`);
 * otherwise it moves the picture's centre to where the click was, in the
 * plane's own frame (as a hole's click places a hole, ADR-0049).
 */
export function canvasPlaceAt(
  world: Vec3,
  values: DialogValues,
  ctx: ManipulatorContext,
): Partial<DialogValues> | undefined {
  // A calibration takes the clicks for itself: the two marks, nothing else.
  if (calibration().dialog !== undefined) {
    markCalibrationPoint(world);
    return undefined;
  }
  const frame = placementFrame(values.refs.plane?.[0], ctx);
  if (!frame) return undefined;
  const [x, y] = worldToSketch(frame, world);
  return { exprs: { x: mm(x), y: mm(y) } };
}

/** A length in mm as an expression, to the micrometre. */
function mm(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${Object.is(rounded, -0) ? 0 : rounded} mm`;
}

// --------------------------------------------------------------- calibration

/**
 * The points a calibration marked. The one running calibration of the open
 * project: the dialog's Calibrate panel writes it, `placeAt` adds to it and
 * the view reads it for the two dots and their line.
 */
export interface Calibration {
  /** The dialog the calibration belongs to; it ends when that closes. */
  dialog: FeatureId | undefined;
  /** The clicks on the plane, in world mm, up to two. */
  points: Vec3[];
}

/** The one calibration running (a project has one open dialog at a time). */
export const calibrationStore = createStore<Calibration>()(() => ({
  dialog: undefined,
  points: [],
}));

/** The calibration as it is, for code outside the component. */
export function calibration(): Calibration {
  return calibrationStore.getState();
}

/** Starts a calibration (or starts it again, dropping what was marked). */
export function startCalibration(dialog: FeatureId): void {
  calibrationStore.setState({ dialog, points: [] });
}

/** Marks a point on the canvas's plane; the second one finishes the pair. */
export function markCalibrationPoint(world: Vec3): void {
  const { points } = calibration();
  calibrationStore.setState({ points: [...points, world].slice(0, 2) });
}

/** Forgets a calibration: Esc, a new one, or the dialog closing. */
export function clearCalibration(): void {
  calibrationStore.setState({ dialog: undefined, points: [] });
}

/**
 * What a calibration makes of the marked points: the width the image gets
 * when they really measure `real` mm. Their own distance on the plane
 * (`measured`) is what they measure on the picture now. `undefined` until two
 * points are marked, or while the plane or a number is missing.
 */
export function calibratedCanvasWidth(options: {
  points: readonly Vec3[];
  frame: SketchFrame | undefined;
  /** The image's width now, mm. */
  width: number | undefined;
  /** What the user says the two points measure, mm. */
  real: number | undefined;
}): { width: number; measured: number } | undefined {
  const { points, frame, width, real } = options;
  if (points.length < 2 || !frame || width === undefined || real === undefined) return undefined;
  const measured = planeDistance(points[0] as Vec3, points[1] as Vec3, frame);
  const next = calibratedWidth(width, real, measured);
  return next === undefined ? undefined : { width: next, measured };
}

// ---------------------------------------------------------------- the dialog

export const canvasDialog = defineFeatureDialog({
  ...canvasFeature,
  command: 'canvas',
  fields: [
    {
      kind: 'info',
      name: 'image',
      label: 'Picture',
      text: (_values, ctx) => {
        const file = canvasFile(ctx);
        if (!file) return 'No picture';
        return `${file.attachment.fileName} · ${formatSize(file.attachment.size)}`;
      },
    },
    {
      kind: 'selection',
      name: 'plane',
      label: 'Plane',
      accepts: ['plane', 'face'],
      min: 0,
      max: 1,
      prompt: 'XY plane',
      hint: 'The plane the picture lies on: an origin plane, a construction plane or a flat face.',
    },
    ...numberFields,
    {
      kind: 'toggle',
      name: 'flip',
      label: 'Flip',
      default: false,
      hint: 'Mirrors the picture left–right.',
    },
  ],
  toInputs: canvasDialogInputs,
  validate: checkCanvas,
  propose: (values, ctx) => proposeCanvas(values, ctx),
  placeAt: canvasPlaceAt,
  // While a calibration runs the clicks are its two marks, so the plane the
  // picture lies on stays as it is (ADR-0066 §5).
  placeAtOnly: () => calibration().dialog !== undefined,
  extra: CanvasCalibrate,
  // The attachment record, in the same undo step as the feature (ADR-0066 §0).
  commitWith(_values, ctx): readonly Command<unknown>[] {
    const file = canvasFile(ctx);
    if (!file || ctx.feature) return [];
    // The same picture added again is the attachment that is already there.
    if (ctx.doc.attachments?.[file.id]) return [];
    // Committed: the picked picture is the design's now.
    clearPendingCanvas();
    return [addAttachment({ id: file.id, attachment: file.attachment })];
  },
});

/** A file size as the dialog shows it: bytes, then kB and MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

// ------------------------------------------------------- the Calibrate panel

/**
 * The dialog's own UI: **Calibrate**, then the two clicks are made in the
 * view and the real distance appears with **Apply** (`spec.extra`). The
 * marked points live in `calibrationStore` (the view draws them, `placeAt`
 * adds them), and the panel clears the calibration when the dialog closes.
 * Esc cancels the calibration rather than the dialog.
 */
export function CanvasCalibrate({ open, controller }: DialogExtraProps) {
  const state = useStore(calibrationStore);
  const [real, setReal] = useState(DEFAULT_REAL_DISTANCE);
  const ctx = controller.context();
  const running = state.dialog === open.id;
  const points = running ? state.points : [];
  // A closed dialog takes its calibration with it.
  useEffect(() => {
    return () => {
      if (calibrationStore.getState().dialog === open.id) clearCalibration();
    };
  }, [open.id]);
  const onKeyDown = (event: KeyboardEvent) => {
    // Esc in a text field is the field's own (it reverts its text); anywhere
    // else it stops the calibration, not the dialog.
    if (event.key !== 'Escape' || !running) return;
    event.preventDefault();
    clearCalibration();
  };
  const frame = ctx ? placementFrame(open.values.refs.plane?.[0], ctx) : undefined;
  const evaluated = controller.evaluate('width', real);
  const result = calibratedCanvasWidth({
    points,
    frame,
    width: ctx?.value('width'),
    real: evaluated.ok ? evaluated.value : undefined,
  });
  const settings = ctx?.doc.settings ?? { units: 'mm' as const, precision: 2 };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards Escape for the calibration.
    <div className="flex flex-col gap-1.5" onKeyDown={onKeyDown}>
      <Button
        data-calibrate={points.length}
        aria-pressed={running}
        onClick={() => (running ? clearCalibration() : startCalibration(open.id))}
      >
        {running ? 'Calibrating…' : 'Calibrate'}
      </Button>
      {running && points.length < 2 && (
        <p className="text-xs text-muted">
          Click {points.length === 0 ? 'the first' : 'the second'} point on the picture.
        </p>
      )}
      {result && (
        <>
          <p className="text-xs text-muted">
            {`${formatQuantity(result.measured, LENGTH, settings)} apart on the picture.`}
          </p>
          <ExpressionInput
            label="Real distance"
            value={real}
            onCommit={setReal}
            onDraftChange={(expr) => setReal(expr)}
            // The distance isn't an input: it is measured against the width,
            // so it evaluates in the draft's context like a field would.
            evaluate={(expr) => controller.evaluate('width', expr)}
            format={(r) => formatQuantity(r.value, r.dim, settings)}
          />
          <Button
            variant="primary"
            onClick={() => controller.setExpr('width', `${result.width} mm`)}
          >
            Apply
          </Button>
        </>
      )}
    </div>
  );
}
