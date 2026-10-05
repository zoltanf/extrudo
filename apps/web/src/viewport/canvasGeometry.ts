/**
 * What the view draws of a canvas, as pure data (P4-06, ADR-0066 §5): the
 * kernel reports the frame of the plane an image lies on and nothing else
 * (it has no geometry and no bytes), so the picture, its place in that frame,
 * its width, turn, opacity and mirror are read here from the feature's own
 * inputs and the document's parameters. World mm, no three.js, so it runs in
 * Vitest — the e2e tests read `canvasSummary` off the Viewport region.
 */
import {
  type AttachmentId,
  CANVAS_PIXEL_MM,
  CANVAS_TYPE,
  CanvasInputsSchema,
  type CanvasReport,
  canvasNumbers,
  canvasSettings,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type Feature,
  type FeatureId,
  isFeatureVisible,
  type SketchFrame,
  sketchToWorld,
  type Vec3,
  worldToSketch,
} from '@extrudo/core';

/** One canvas to draw. */
export interface CanvasDrawing {
  /** The feature's ID (what the browser row and the timeline chip name). */
  id: string;
  name: string;
  /** The plane's frame, as the kernel reported it. */
  frame: SketchFrame;
  /** The attachment the image comes from. */
  image: AttachmentId;
  /** The image's centre in the plane's frame, mm. */
  x: number;
  y: number;
  /** The image's width, mm; its height is this times the picture's aspect. */
  width: number;
  /** The turn about the plane's normal, degrees. */
  rotation: number;
  /** How opaque it is drawn (0.05…1). */
  opacity: number;
  /** Mirrors the image left–right. */
  flip: boolean;
  /** A dialog's preview: drawn as the draft's own image. */
  preview?: boolean;
  /** A preview that is out of date (an invalid input): fainter. */
  dimmed?: boolean;
}

/**
 * The drawing of a canvas feature from its inputs and the values of the
 * expressions in them, or `undefined` when its inputs don't parse (a feature
 * the document check refused): the view has nothing to draw then.
 */
export function canvasDrawing(
  feature: Pick<Feature, 'id' | 'name' | 'inputs'>,
  report: CanvasReport,
  value: (name: string) => number | undefined,
  options: { preview?: boolean; dimmed?: boolean } = {},
): CanvasDrawing | undefined {
  const parsed = CanvasInputsSchema.safeParse(feature.inputs);
  if (!parsed.success) return undefined;
  const settings = canvasSettings(parsed.data);
  const numbers = canvasNumbers(parsed.data, value);
  return {
    id: feature.id,
    name: feature.name,
    frame: report.frame,
    image: settings.image,
    ...numbers,
    flip: settings.flip,
    ...(options.preview !== undefined && { preview: options.preview }),
    ...(options.dimmed !== undefined && { dimmed: options.dimmed }),
  };
}

/**
 * Every shown canvas of a document the kernel has reported, in timeline
 * order, with each one's numbers from the document's own evaluation: `x` and
 * `y` and `width` may be expressions over parameters (ADR-0004). A canvas
 * whose feature is edited (`skip`) is left out, because its dialog draws the
 * draft instead.
 */
export function canvasDrawings(
  doc: ExtrudoDocument,
  reports: Readonly<Record<FeatureId, CanvasReport>>,
  options: { skip?: FeatureId } = {},
): CanvasDrawing[] {
  const shown = doc.features.filter(
    (feature, index) =>
      feature.type === CANVAS_TYPE &&
      index < doc.timelineMarker &&
      !feature.suppressed &&
      isFeatureVisible(feature) &&
      feature.id !== options.skip,
  );
  if (shown.length === 0) return [];
  const evaluated = evaluateParameters(doc);
  const out: CanvasDrawing[] = [];
  for (const feature of shown) {
    const report = reports[feature.id];
    if (!report) continue;
    const values = evaluated.inputs.get(feature.id);
    const drawing = canvasDrawing(feature, report, (name) => numberOf(values?.get(name)));
    if (drawing) out.push(drawing);
  }
  return out;
}

/** An evaluated input's number in mm, degrees or plain units, or `undefined`. */
const numberOf = (result: EvaluateResult | undefined): number | undefined =>
  result?.ok ? result.value : undefined;

/** The width the dialog gives an image whose pixels are `pixels` wide (100 dpi). */
export function widthForPixels(pixels: number): string {
  const mm = Math.round(pixels * CANVAS_PIXEL_MM * 1000) / 1000;
  return `${Object.is(mm, -0) ? 0 : mm} mm`;
}

/** The image's size in the plane, mm: `width` × the picture's aspect. */
export function canvasSize(
  drawing: CanvasDrawing,
  pixels: CanvasPixels | undefined,
): [number, number] {
  const aspect = pixels && pixels.width > 0 ? pixels.height / pixels.width : 1;
  return [drawing.width, drawing.width * aspect];
}

/** An image's pixel size, once the view has decoded it. */
export interface CanvasPixels {
  width: number;
  height: number;
}

const mm2 = (x: number) => `${Math.round(x * 100) / 100 + 0}`;

/**
 * The drawn canvases for tests (`data-canvases`), space separated:
 * `<feature id>:<w>x<h>:<origin>` per canvas, mm to 0.01 ("c1:20x10:0,0,0").
 * A canvas whose image hasn't been decoded yet is left out: its height would
 * be a guess, and the tests wait for the picture.
 */
export function canvasSummary(
  drawings: readonly CanvasDrawing[],
  pixels: Readonly<Record<string, CanvasPixels>>,
): string | undefined {
  const parts: string[] = [];
  for (const drawing of drawings) {
    const size = pixels[drawing.image];
    if (!size) continue;
    const [width, height] = canvasSize(drawing, size);
    parts.push(
      `${drawing.id}:${mm2(width)}x${mm2(height)}:${drawing.frame.origin.map(mm2).join(',')}`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * The width a calibration gives: what the image is now wide, with the two
 * marked points at their real distance instead (ADR-0066 §5), rounded to
 * 0.01 mm as a plain value.
 */
export function calibratedWidth(width: number, real: number, measured: number): number | undefined {
  if (!(width > 0) || !(measured > 0) || !(real > 0)) return undefined;
  return Math.round(((width * real) / measured) * 100) / 100;
}

/**
 * How far apart two clicked points are, in the plane they were clicked on
 * (mm): the distance in the plane's own sketch frame, so a clicked distance
 * in a tilted view measures the picture, not the projection of it.
 */
export function planeDistance(a: Vec3, b: Vec3, frame: SketchFrame): number {
  const [ax, ay] = worldToSketch(frame, a);
  const [bx, by] = worldToSketch(frame, b);
  return Math.hypot(bx - ax, by - ay);
}

/** The four corners of a canvas in world mm, in the plane's frame: the tests draw with them. */
export function canvasCorners(drawing: CanvasDrawing, pixels: CanvasPixels | undefined): Vec3[] {
  const [width, height] = canvasSize(drawing, pixels);
  const turn = (drawing.rotation * Math.PI) / 180;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const half = width / 2;
  const up = height / 2;
  const corners: [number, number][] = [
    [-half, -up],
    [half, -up],
    [half, up],
    [-half, up],
  ];
  // `rotation` about the normal from the frame's X; `flip` mirrors u, which
  // walks the corners round the other way.
  return corners.map(([u, v]) => {
    const across = drawing.flip ? -u : u;
    return sketchToWorld(drawing.frame, [
      drawing.x + across * c - v * s,
      drawing.y + across * s + v * c,
    ]);
  });
}
