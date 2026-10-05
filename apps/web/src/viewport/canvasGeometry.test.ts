// What the view draws of a canvas (P4-06, ADR-0066 §5): the numbers read
// from a feature's own inputs and the document's parameters, the size the
// picture's aspect gives, the test summary, and the calibration's maths.
import {
  AttachmentIdSchema,
  CANVAS_TYPE,
  canvasInputs,
  createDocument,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  originPlaneRef,
  type ParameterId,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  calibratedWidth,
  canvasCorners,
  canvasDrawing,
  canvasDrawings,
  canvasSize,
  canvasSummary,
  planeDistance,
  widthForPixels,
} from './canvasGeometry';

const IMAGE = AttachmentIdSchema.parse('a-1');
const XZ = originPlaneRef('origin:xz');

/**
 * A canvas feature with the given inputs (the image aside) and the document
 * it is in, as a design would hold it.
 */
function design(inputs: Feature['inputs'] = {}, parameters: Record<string, string> = {}) {
  const feature: Feature = {
    id: 'c1' as FeatureId,
    type: CANVAS_TYPE,
    name: 'Canvas1',
    suppressed: false,
    inputs: { image: { kind: 'file', id: IMAGE }, ...inputs },
  };
  const doc: ExtrudoDocument = {
    ...createDocument(),
    features: [feature],
    timelineMarker: 1,
    parameters: Object.entries(parameters).map(([name, expression]) => ({
      id: `p-${name}` as ParameterId,
      name,
      expression,
      unit: 'length',
    })),
    attachments: {
      [IMAGE]: {
        name: 'plan',
        fileName: 'plan.png',
        mediaType: 'image/png',
        sha256: 'a'.repeat(64),
        size: 10,
      },
    },
  };
  return { doc, feature };
}

/** The frame a canvas on the XY plane reports (what a sketch there gets). */
const XY_FRAME = {
  origin: [0, 0, 0],
  x: [1, 0, 0],
  y: [0, 1, 0],
  normal: [0, 0, 1],
} as const;

const report = { kind: 'canvas', frame: XY_FRAME } as const;

describe('canvas drawings (P4-06, ADR-0066 §5)', () => {
  it('reads the numbers from the feature, with the defaults', () => {
    const drawing = canvasDrawing(
      { id: 'c1' as FeatureId, name: 'Canvas1', inputs: canvasInputs({ image: IMAGE }) },
      report,
      () => undefined,
    );
    expect(drawing).toMatchObject({
      id: 'c1',
      name: 'Canvas1',
      image: IMAGE,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 0.5,
      flip: false,
    });
    expect(drawing?.frame.origin).toEqual([0, 0, 0]);
  });

  it('takes each input from the evaluation that goes with it', () => {
    const inputs = canvasInputs({
      image: IMAGE,
      numbers: { x: '10 mm', y: '-5 mm', width: '40 mm', rotation: '30 deg', opacity: '0.8' },
      flip: true,
    });
    const values: Record<string, number> = { x: 10, y: -5, width: 40, rotation: 30, opacity: 0.8 };
    expect(
      canvasDrawing(
        { id: 'c1' as FeatureId, name: 'Canvas1', inputs },
        report,
        (name) => values[name],
      ),
    ).toMatchObject({ ...values, flip: true });
    // An expression that doesn't evaluate keeps the default, not `undefined`.
    expect(
      canvasDrawing({ id: 'c1' as FeatureId, name: 'Canvas1', inputs }, report, () => undefined),
    ).toMatchObject({ x: 0, y: 0, width: 100, rotation: 0, opacity: 0.5 });
  });

  it('has nothing to draw for inputs that do not parse', () => {
    expect(
      canvasDrawing({ id: 'c1' as FeatureId, name: 'Canvas1', inputs: {} }, report, () => 1),
    ).toBeUndefined();
  });

  it("collects a document's shown canvases, skipping hidden, rolled back and suppressed", () => {
    const { doc, feature } = design();
    const reports = { [feature.id]: report } as Record<FeatureId, typeof report>;
    expect(canvasDrawings(doc, reports).map((d) => d.id)).toEqual(['c1']);
    // The eye (Feature.visible, ADR-0021), the timeline marker and Suppress.
    const hidden = canvasDrawings({ ...doc, features: [{ ...feature, visible: false }] }, reports);
    expect(hidden).toEqual([]);
    expect(canvasDrawings({ ...doc, timelineMarker: 0 }, reports)).toEqual([]);
    expect(
      canvasDrawings({ ...doc, features: [{ ...feature, suppressed: true }] }, reports),
    ).toEqual([]);
    // The one a dialog edits is left out: its draft is the preview.
    expect(canvasDrawings(doc, reports, { skip: feature.id })).toEqual([]);
    // A canvas the kernel hasn't reported (it errored) isn't drawn.
    expect(canvasDrawings(doc, {})).toEqual([]);
  });

  it('reads a width that is an expression over a parameter', () => {
    const { doc, feature } = design(canvasInputs({ image: IMAGE, numbers: { width: 'picture' } }), {
      picture: '40 mm',
    });
    const reports = { [feature.id]: report };
    expect(canvasDrawings(doc, reports)[0]?.width).toBe(40);
    // A parameter change brings the drawing with it (ADR-0004).
    const changed = {
      ...doc,
      parameters: doc.parameters.map((p) => ({ ...p, expression: '80 mm' })),
    };
    expect(canvasDrawings(changed, reports)[0]?.width).toBe(80);
  });

  it('gives the width a picked picture has: its pixels at 100 dpi', () => {
    expect(widthForPixels(200)).toBe('20 mm');
    expect(widthForPixels(0)).toBe('0 mm');
    expect(widthForPixels(960)).toBe('96 mm');
  });

  it('takes the height from the picture itself', () => {
    const drawing = canvasDrawing(
      {
        id: 'c1' as FeatureId,
        name: 'Canvas1',
        inputs: canvasInputs({ image: IMAGE, numbers: { width: '20 mm' } }),
      },
      report,
      () => 20,
    ) as NonNullable<ReturnType<typeof canvasDrawing>>;
    expect(canvasSize(drawing, { width: 200, height: 100 })).toEqual([20, 10]);
    // Nothing decoded yet: square, until the picture says otherwise.
    expect(canvasSize(drawing, undefined)).toEqual([20, 20]);
  });

  it('summarises the drawn canvases for `data-canvases`', () => {
    const { doc, feature } = design({ width: { kind: 'expr', expr: '20 mm', unit: 'length' } });
    const drawings = canvasDrawings(doc, { [feature.id]: report });
    expect(canvasSummary(drawings, { [IMAGE]: { width: 200, height: 100 } })).toBe(
      'c1:20x10:0,0,0',
    );
    // Without the picture's size there is no height to say: the test waits.
    expect(canvasSummary(drawings, {})).toBeUndefined();
    expect(canvasSummary([], {})).toBeUndefined();
  });

  it('turns and mirrors the corners the way the picture is drawn', () => {
    const corners = (options: { numbers: Record<string, string>; flip?: boolean }) => {
      const turn = Number(options.numbers.rotation?.replace(' deg', '') ?? 0);
      return canvasCorners(
        canvasDrawing(
          {
            id: 'c1' as FeatureId,
            name: 'Canvas1',
            inputs: canvasInputs({ image: IMAGE, ...options }),
          },
          report,
          (name) => ({ width: 20, x: 0, y: 0, rotation: turn })[name as 'width'],
        ) as NonNullable<ReturnType<typeof canvasDrawing>>,
        { width: 200, height: 100 },
      ).map((p) => p.map((v) => Math.round(v * 1000) / 1000));
    };

    expect(corners({ numbers: { width: '20 mm' } })).toEqual([
      [-10, -5, 0],
      [10, -5, 0],
      [10, 5, 0],
      [-10, 5, 0],
    ]);
    // Flip mirrors left–right: the same quad, the other way round.
    expect(corners({ numbers: { width: '20 mm' }, flip: true })).toEqual([
      [10, -5, 0],
      [-10, -5, 0],
      [-10, 5, 0],
      [10, 5, 0],
    ]);
    // A quarter turn about the normal swaps the corners.
    expect(corners({ numbers: { width: '20 mm', rotation: '90 deg' } })).toEqual([
      [5, -10, 0],
      [5, 10, 0],
      [-5, 10, 0],
      [-5, -10, 0],
    ]);
  });

  it('draws on the plane it reports, wherever that is', () => {
    const tilted = {
      origin: [0, 0, 15],
      x: [1, 0, 0],
      y: [0, 1, 0],
      normal: [0, 0, 1],
    } as const;
    const drawing = canvasDrawing(
      {
        id: 'c1' as FeatureId,
        name: 'Canvas1',
        inputs: canvasInputs({ image: IMAGE, plane: XZ, numbers: { width: '20 mm' } }),
      },
      { kind: 'canvas', frame: tilted },
      () => 20,
    ) as NonNullable<ReturnType<typeof canvasDrawing>>;
    expect(canvasCorners(drawing, { width: 200, height: 100 })[0]).toEqual([-10, -5, 15]);
  });
});

describe('the calibration of a canvas (ADR-0066 §5)', () => {
  it('measures the marked points in the plane, not in the view', () => {
    // Two points 15 mm apart along the frame's X.
    expect(planeDistance([-7.5, 0, 0], [7.5, 0, 0], XY_FRAME)).toBeCloseTo(15, 9);
    // On a tilted plane, two world points that are further apart in the view are
    // not further apart on the picture: only their in-plane distance counts.
    const half = Math.SQRT1_2;
    const tilted = {
      origin: [0, 0, 0],
      x: [1, 0, 0],
      y: [0, half, half],
      normal: [0, -half, half],
    } as const;
    expect(planeDistance([0, 0, 0], [0, 10 * half, 10 * half], tilted)).toBeCloseTo(10, 9);
  });

  it('makes the width the one the real distance gives', () => {
    // A 20 mm wide picture whose 150 px marks measure 15 mm, said to be 30 mm.
    expect(calibratedWidth(20, 30, 15)).toBe(40);
    // Halved, doubled, and to the hundredth of a millimetre.
    expect(calibratedWidth(20, 7.5, 15)).toBe(10);
    expect(calibratedWidth(20, 45, 15)).toBe(60);
    expect(calibratedWidth(33.333, 30, 15)).toBe(66.67);
    // Nothing sensible without a width, a measurement and a real distance.
    expect(calibratedWidth(0, 30, 15)).toBeUndefined();
    expect(calibratedWidth(20, 0, 15)).toBeUndefined();
    expect(calibratedWidth(20, 30, 0)).toBeUndefined();
  });
});
