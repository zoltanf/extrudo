/**
 * The `canvas` feature (P4-06, ADR-0066 §5, FR-IO-07): a reference image
 * laid on a plane, for tracing. It makes **no geometry** — not even faces —
 * so it is the view that draws it, from a frame the kernel reports (like a
 * construction feature, ADR-0040). The image travels with the design as an
 * attachment (ADR-0061) and is read on the UI thread (`createImageBitmap`
 * from its bytes, so the CSP is untouched); **the worker never gets an
 * image's bytes**.
 *
 * | Input | Type | Default |
 * |---|---|---|
 * | `plane` | ref (origin plane, construction plane, flat face) | XY |
 * | `image` | string, an `AttachmentId` with an `image/*` media type | – |
 * | `x`, `y` | expr length (the image's centre, in the plane's frame) | 0 |
 * | `width` | expr length (the height follows the image's aspect) | the dialog's: the pixel width × {@link CANVAS_PIXEL_MM} |
 * | `rotation` | expr angle about the plane's normal | 0 |
 * | `opacity` | expr number, 0.05…1 | 0.5 |
 * | `flip` | bool (mirror left–right) | false |
 *
 * `width`'s default is the one thing the document can't work out: an
 * attachment record holds a hash and a size, not the picture's pixel size,
 * so **the dialog reads the pixels when the file is picked and writes the
 * width** (`CANVAS_PIXEL_MM` a pixel). The schema's own default
 * ({@link CANVAS_DEFAULT_WIDTH} mm) is what a canvas gets when nobody set
 * one, and what the view falls back on.
 */
import { z } from 'zod';
import { exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { AttachmentId } from './ids';
import { IMAGE_MEDIA_TYPES } from './media-types';
import { DEFAULT_PLACEMENT, PLACEMENT_KINDS } from './primitives';
import {
  BoolInputSchema,
  type ExprInput,
  type Feature,
  type FeatureInputs,
  FileInputSchema,
  type GeomRef,
} from './schema';
import type { SketchFrame } from './sketch/planes';

export const CANVAS_TYPE = 'canvas';

/** The feature type's label, and the base of its default names ("Canvas1"). */
export const CANVAS_LABEL = 'Canvas';

/** The media types a canvas image may have (ADR-0066 §0). */
export const CANVAS_MEDIA_TYPES = IMAGE_MEDIA_TYPES;

/**
 * What a pixel of an imported image is worth in mm until the user says
 * otherwise: 100 dpi, the usual screen resolution (ADR-0066 §5).
 */
export const CANVAS_PIXEL_MM = 0.1;

/** `width` without an input (mm). The dialog writes the picture's own width. */
export const CANVAS_DEFAULT_WIDTH = 100;

/** How opaque a canvas is drawn without an `opacity` input. */
export const CANVAS_DEFAULT_OPACITY = 0.5;

/** The bounds of `opacity`, which the kernel and the dialog both keep to. */
export const CANVAS_OPACITY_RANGE = { min: 0.05, max: 1 } as const;

/** One number input of a canvas: where it lies, how big, how turned, how clear. */
export interface CanvasNumber {
  name: string;
  label: string;
  unit: 'length' | 'angle' | 'unitless';
  /** The expression the dialog starts with. */
  default: string;
  /** Its value in mm, degrees or plain units: what the kernel and view use without the input. */
  value: number;
  /** A value that must be greater than 0 (a width may not be 0 or negative). */
  positive?: boolean;
}

/** Every number input of a canvas, in the order the dialog lists them. */
export const CANVAS_NUMBERS: readonly CanvasNumber[] = [
  { name: 'x', label: 'X', unit: 'length', default: '0 mm', value: 0 },
  { name: 'y', label: 'Y', unit: 'length', default: '0 mm', value: 0 },
  {
    name: 'width',
    label: 'Width',
    unit: 'length',
    default: `${CANVAS_DEFAULT_WIDTH} mm`,
    value: CANVAS_DEFAULT_WIDTH,
    positive: true,
  },
  { name: 'rotation', label: 'Rotation', unit: 'angle', default: '0 deg', value: 0 },
  {
    name: 'opacity',
    label: 'Opacity',
    unit: 'unitless',
    default: String(CANVAS_DEFAULT_OPACITY),
    value: CANVAS_DEFAULT_OPACITY,
  },
];

const length = () => exprOf('length').optional();

export const CanvasInputsSchema = z.strictObject({
  /**
   * The plane the image lies on: an origin plane, a construction plane or a
   * flat face. Missing: the XY plane.
   */
  plane: refsOf(PLACEMENT_KINDS, 1)
    .optional()
    .describe(
      'The plane the image lies on: an origin plane, a construction plane or a flat face. Default the XY plane.',
    ),
  /** The image: an attachment of the design with an `image/*` media type. */
  image: FileInputSchema.describe(
    'The picture: an attachment of this design with an `image/*` media type (PNG, JPEG or WebP). Required.',
  ),
  /** The image's centre along the plane frame's X, default 0. */
  x: length().describe("The image's centre along the plane frame's X; a length. Default 0."),
  y: length().describe("The image's centre along the plane frame's Y; a length. Default 0."),
  /** The image's width; the height follows its aspect. Default 100 mm. */
  width: length().describe(
    "The image's width; a length, the height follows its aspect. Default 100 mm.",
  ),
  /** Turns the image about the plane's normal (right-handed), from the frame's X. Default 0°. */
  rotation: exprOf('angle')
    .optional()
    .describe(
      "Turns the image about the plane's normal, right-handed, from the frame's X; an angle. Default 0 deg.",
    ),
  /** How opaque it is drawn, 0.05…1. Default 0.5. */
  opacity: exprOf('unitless')
    .optional()
    .describe('How opaque it is drawn, 0.05 to 1. Default 0.5.'),
  /** Mirrors the image left–right. Default false. */
  flip: BoolInputSchema.optional().describe('Mirrors the image left to right. Default false.'),
});
export type CanvasInputs = z.infer<typeof CanvasInputsSchema>;

export const canvasFeature: FeatureDefinition<CanvasInputs> = {
  type: CANVAS_TYPE,
  label: CANVAS_LABEL,
  category: 'create',
  icon: 'canvas',
  inputsSchema: CanvasInputsSchema,
};

/** A canvas's inputs with every default filled in. */
export interface CanvasSettings {
  /** Where it lies; the XY plane without an input. */
  plane: GeomRef;
  image: AttachmentId;
  /**
   * The `expr` inputs present, by name: the kernel reads their values with
   * `ctx.value`, the view with the document's evaluation (`canvasNumbers`).
   */
  exprs: ReadonlySet<string>;
  flip: boolean;
}

/** Reads a canvas's (valid) inputs with their defaults. */
export function canvasSettings(inputs: CanvasInputs): CanvasSettings {
  const exprs = new Set<string>();
  for (const [name, input] of Object.entries(inputs)) {
    if ((input as { kind?: string } | undefined)?.kind === 'expr') exprs.add(name);
  }
  return {
    plane: inputs.plane?.refs[0] ?? DEFAULT_PLACEMENT,
    image: inputs.image.id,
    exprs,
    flip: inputs.flip?.value ?? false,
  };
}

/** A canvas's numbers with every default filled in: mm, degrees, plain units. */
export interface CanvasNumbers {
  /** The image's centre in the plane's frame, mm. */
  x: number;
  y: number;
  /** The image's width, mm; its height follows the picture's aspect. */
  width: number;
  /** The turn about the plane's normal, degrees. */
  rotation: number;
  /** How opaque the view draws it. */
  opacity: number;
}

/**
 * A canvas's numbers in their own units, from its inputs and the values of
 * the expressions in them (`value` gives a number, or `undefined` while the
 * expression doesn't evaluate). The kernel passes `ctx.value`, the view the
 * document's evaluation, so both draw the same canvas (ADR-0066 §5).
 */
export function canvasNumbers(
  inputs: CanvasInputs,
  value: (name: string) => number | undefined,
): CanvasNumbers {
  const at = (name: string): number => {
    const input = (inputs as unknown as Record<string, ExprInput | undefined>)[name];
    const fallback = CANVAS_NUMBERS.find((n) => n.name === name)?.value ?? 0;
    if (input?.kind !== 'expr') return fallback;
    return value(name) ?? fallback;
  };
  return {
    x: at('x'),
    y: at('y'),
    width: at('width'),
    rotation: at('rotation'),
    opacity: at('opacity'),
  };
}

export interface CanvasInputOptions {
  /** The attachment the image comes from; the caller writes its bytes first (ADR-0061 §2). */
  image: AttachmentId;
  /** An origin plane or a construction plane; default the XY plane (no input). */
  plane?: GeomRef;
  /** Size and placement expressions by input name: `{ width: '40 mm' }`. */
  numbers?: Readonly<Record<string, string>>;
  flip?: boolean;
}

/**
 * A canvas feature's inputs from plain options (tests, scripts; the dialog
 * builds the same shape). Expressions get their unit; `paramName`s are left
 * to the caller, as for any feature. An unknown number name throws.
 */
export function canvasInputs(options: CanvasInputOptions): CanvasInputs {
  const inputs: Record<string, unknown> = { image: { kind: 'file', id: options.image } };
  if (options.plane) inputs.plane = { kind: 'ref', refs: [options.plane] };
  for (const [name, expr] of Object.entries(options.numbers ?? {})) {
    const number = CANVAS_NUMBERS.find((n) => n.name === name);
    if (!number) throw new Error(`A canvas has no number "${name}".`);
    inputs[name] = { kind: 'expr', expr, unit: number.unit } satisfies ExprInput;
  }
  if (options.flip !== undefined) inputs.flip = { kind: 'bool', value: options.flip };
  return inputs as CanvasInputs;
}

// ------------------------------------------------------------------- report

/**
 * What the kernel reports about a canvas (ADR-0066 §5): the frame of the
 * plane it lies on, which is all the geometry it has. The view reads the
 * rest (the image, the width, the turn) from the feature's own inputs, and
 * the app's `ModelState.canvases` holds these (`FeatureOutput.report`).
 */
export interface CanvasReport {
  kind: 'canvas';
  /** The plane's frame: the one a sketch on it would get (`faceSketchFrame`). */
  frame: SketchFrame;
}

/** Whether a kernel report is a canvas report (the others are a sketch's or construction's). */
export function isCanvasReport(report: unknown): report is CanvasReport {
  return (report as { kind?: unknown } | null | undefined)?.kind === 'canvas';
}

/** The attachment a canvas names, or `undefined` for any other feature (or unparsable inputs). */
export function canvasImageOf(feature: Pick<Feature, 'type' | 'inputs'>): AttachmentId | undefined {
  if (feature.type !== CANVAS_TYPE) return undefined;
  const parsed = CanvasInputsSchema.safeParse(feature.inputs as FeatureInputs);
  return parsed.success ? parsed.data.image.id : undefined;
}
