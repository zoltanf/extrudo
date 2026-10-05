// The `canvas` feature in the document (P4-06, ADR-0066 §5): its inputs and
// their defaults, the `image` attachment it needs, and what the schema says
// about a canvas that names a file the design doesn't carry or one that is
// not a picture.
import { describe, expect, it } from 'vitest';
import {
  AttachmentIdSchema,
  CANVAS_DEFAULT_OPACITY,
  CANVAS_DEFAULT_WIDTH,
  CANVAS_NUMBERS,
  CANVAS_OPACITY_RANGE,
  CANVAS_PIXEL_MM,
  CANVAS_TYPE,
  type CanvasInputs,
  CanvasInputsSchema,
  canvasImageOf,
  canvasInputs,
  canvasNumbers,
  canvasSettings,
  DocumentSchema,
  isCanvasReport,
  originPlaneRef,
} from './index';

const IMAGE = AttachmentIdSchema.parse('a-1');

const document = (inputs: Record<string, unknown>, mediaType?: string) => ({
  format: 'extrudo',
  formatVersion: 1,
  id: 'd1',
  name: 'Design',
  settings: { units: 'mm', precision: 2 },
  parameters: [],
  features: [
    {
      id: 'f1',
      type: CANVAS_TYPE,
      name: 'Canvas1',
      suppressed: false,
      inputs,
    },
  ],
  timelineMarker: 1,
  bodies: {},
  views: [],
  attachments: {
    'a-1': {
      name: 'plan',
      fileName: 'plan.png',
      mediaType: mediaType ?? 'image/png',
      sha256: 'a'.repeat(64),
      size: 10,
    },
  },
  meta: {
    created: '2026-10-04T00:00:00.000Z',
    modified: '2026-10-04T00:00:00.000Z',
    appVersion: '0.4.0',
  },
});

/** The inputs schema's verdict on some canvas inputs, as messages. */
function issuesOf(inputs: Record<string, unknown>) {
  const parsed = CanvasInputsSchema.safeParse(inputs);
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('the canvas inputs (P4-06, ADR-0066 §5)', () => {
  it('needs an image and takes nothing else', () => {
    expect(issuesOf({})).toHaveLength(1);
    expect(issuesOf({ image: { kind: 'file', id: IMAGE }, nope: 1 })[0]).toMatch(/nope/);
  });

  it('reads every input with its default', () => {
    const settings = canvasSettings({ image: { kind: 'file', id: IMAGE } });
    // The XY plane, the origin, no turn, half opaque, the other way round.
    expect(settings.plane).toEqual(originPlaneRef('origin:xy'));
    expect(settings.image).toBe(IMAGE);
    expect([...settings.exprs]).toEqual([]);
    expect(settings.flip).toBe(false);
    expect(CANVAS_DEFAULT_WIDTH).toBe(100);
    expect(CANVAS_DEFAULT_OPACITY).toBe(0.5);
    expect(CANVAS_OPACITY_RANGE).toEqual({ min: 0.05, max: 1 });
    // 100 dpi: a 200 px picture is 20 mm wide until the user says otherwise.
    expect(CANVAS_PIXEL_MM * 200).toBeCloseTo(20);
  });

  it('takes a plane, the numbers and the flip', () => {
    const inputs = canvasInputs({
      image: IMAGE,
      plane: originPlaneRef('origin:xz'),
      numbers: { x: '10 mm', y: '-5 mm', width: '40 mm', rotation: '30 deg', opacity: '0.8' },
      flip: true,
    }) as CanvasInputs;
    expect(inputs.plane?.refs[0]).toEqual(originPlaneRef('origin:xz'));
    expect(inputs.x).toEqual({ kind: 'expr', expr: '10 mm', unit: 'length' });
    expect(inputs.rotation).toEqual({ kind: 'expr', expr: '30 deg', unit: 'angle' });
    expect(inputs.opacity).toEqual({ kind: 'expr', expr: '0.8', unit: 'unitless' });
    expect(inputs.flip).toEqual({ kind: 'bool', value: true });
    const settings = canvasSettings(inputs);
    expect([...settings.exprs].sort()).toEqual(['opacity', 'rotation', 'width', 'x', 'y']);
    expect(settings.flip).toBe(true);
    // The values are the caller's to give (the kernel's `ctx.value`, the
    // view's evaluation); an input without one takes its default.
    const values = { x: 10, y: -5, width: 40, rotation: 30, opacity: 0.8 };
    expect(canvasNumbers(inputs, (name) => values[name as keyof typeof values])).toEqual(values);
    expect(canvasNumbers(inputs, () => undefined)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 0.5,
    });
  });

  it('has one number per input the dialog offers, and refuses a name it does not', () => {
    expect(CANVAS_NUMBERS.map((n) => n.name)).toEqual(['x', 'y', 'width', 'rotation', 'opacity']);
    for (const { name, unit } of CANVAS_NUMBERS) {
      const inputs = canvasInputs({ image: IMAGE, numbers: { [name]: '1' } }) as Record<
        string,
        unknown
      >;
      expect(inputs[name]).toEqual({ kind: 'expr', expr: '1', unit });
    }
    expect(() => canvasInputs({ image: IMAGE, numbers: { height: '1' } })).toThrow(/no number/);
  });

  it('keeps the units apart: a length is not an angle, a number is not a length', () => {
    const ok = (inputs: Record<string, unknown>) =>
      CanvasInputsSchema.safeParse({ image: { kind: 'file', id: IMAGE }, ...inputs }).success;
    expect(ok({ width: { kind: 'expr', expr: '40 mm', unit: 'length' } })).toBe(true);
    expect(ok({ width: { kind: 'expr', expr: '40 deg', unit: 'angle' } })).toBe(false);
    expect(ok({ rotation: { kind: 'expr', expr: '40 mm', unit: 'length' } })).toBe(false);
    expect(ok({ opacity: { kind: 'expr', expr: '0.5', unit: 'unitless' } })).toBe(true);
    expect(ok({ opacity: { kind: 'expr', expr: '0.5', unit: 'length' } })).toBe(false);
    // A plane is a plane or a flat face, nothing else.
    expect(ok({ plane: { kind: 'ref', refs: [originPlaneRef('origin:xy')] } })).toBe(true);
    expect(ok({ plane: { kind: 'ref', refs: [{ kind: 'edge', id: 'b:1' }] } })).toBe(false);
  });

  it('reads the attachment a feature names', () => {
    expect(canvasImageOf({ type: CANVAS_TYPE, inputs: canvasInputs({ image: IMAGE }) })).toBe(
      IMAGE,
    );
    expect(canvasImageOf({ type: 'box', inputs: canvasInputs({ image: IMAGE }) })).toBeUndefined();
    expect(canvasImageOf({ type: CANVAS_TYPE, inputs: {} })).toBeUndefined();
  });

  it('knows its own report', () => {
    expect(isCanvasReport({ kind: 'canvas', frame: {} })).toBe(true);
    expect(isCanvasReport({ kind: 'plane' })).toBe(false);
    expect(isCanvasReport(undefined)).toBe(false);
  });
});

describe('a canvas in the document (ADR-0066 §0, §5)', () => {
  it("is refused when the image is not one of the design's", () => {
    expect(issuesOfDocument(document({ image: { kind: 'file', id: 'a-2' } }))).toEqual([
      'features.0.inputs.image: is attachment "a-2", which this design doesn\'t carry',
    ]);
  });

  it('is refused when the file is not a picture', () => {
    expect(
      issuesOfDocument(
        document(canvasInputs({ image: IMAGE }) as Record<string, unknown>, 'model/step'),
      ),
    ).toEqual([
      'features.0.inputs.image: is "plan.png", whose media type model/step isn\'t one this feature reads',
    ]);
  });

  it('is read when the image is a PNG, a JPEG or a WebP', () => {
    for (const mediaType of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(
        issuesOfDocument(
          document(canvasInputs({ image: IMAGE }) as Record<string, unknown>, mediaType),
        ),
        mediaType,
      ).toEqual([]);
    }
  });
});

/** The document schema's verdict on a document with one canvas, as messages. */
function issuesOfDocument(doc: ReturnType<typeof document>): string[] {
  const parsed = DocumentSchema.safeParse(doc);
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}
