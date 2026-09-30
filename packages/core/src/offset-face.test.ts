import { describe, expect, it } from 'vitest';
import {
  OFFSET_FACE_TYPE,
  OffsetFaceInputsSchema,
  offsetFaceFeature,
  offsetFaceInputs,
  offsetFaceSettings,
} from './offset-face';
import type { GeomRef } from './schema';

const face = (id: string): GeomRef => ({ kind: 'face', id });

describe('offset face inputs', () => {
  it('builds inputs from plain values and reads them back', () => {
    const inputs = offsetFaceInputs([face('a'), face('b')], '5 mm');
    expect(OffsetFaceInputsSchema.safeParse(inputs).success).toBe(true);
    expect(offsetFaceFeature.inputsSchema.safeParse(inputs).success).toBe(true);
    expect(offsetFaceSettings(inputs)).toEqual({ faces: [face('a'), face('b')] });
    expect(inputs.distance).toEqual({ kind: 'expr', expr: '5 mm', unit: 'length' });
  });

  it('needs a distance that is a length, and only faces as references', () => {
    expect(OffsetFaceInputsSchema.safeParse({}).success).toBe(false);
    const ok = offsetFaceInputs([face('a')], '1 mm');
    expect(
      OffsetFaceInputsSchema.safeParse({
        ...ok,
        faces: { kind: 'ref', refs: [{ kind: 'edge', id: 'e' }] },
      }).success,
    ).toBe(false);
    expect(
      OffsetFaceInputsSchema.safeParse({
        ...ok,
        distance: { kind: 'expr', expr: '5 deg', unit: 'angle' },
      }).success,
    ).toBe(false);
    expect(OffsetFaceInputsSchema.safeParse({ ...ok, stray: 1 }).success).toBe(false);
  });

  it('keeps an empty face list valid for the schema (the kernel says what is missing)', () => {
    expect(OffsetFaceInputsSchema.safeParse(offsetFaceInputs([], '1 mm')).success).toBe(true);
  });

  it('is a modify feature with the offset icon', () => {
    expect(OFFSET_FACE_TYPE).toBe('offsetFace');
    expect(offsetFaceFeature).toMatchObject({
      type: 'offsetFace',
      category: 'modify',
      icon: 'offset-face',
    });
  });
});
