import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { loadDocument } from './migrations';
import {
  OFFSET_FACE_TYPE,
  type OffsetFaceInputs,
  OffsetFaceInputsSchema,
  offsetFaceFeature,
  offsetFaceInputs,
  offsetFaceSettings,
} from './offset-face';
import type { GeomRef } from './schema';
import { feature } from './testing';

const face = (id: string): GeomRef => ({ kind: 'face', id });

describe('offset face inputs', () => {
  it('builds inputs from plain values and reads them back', () => {
    const inputs = offsetFaceInputs([face('a'), face('b')], '5 mm');
    expect(OffsetFaceInputsSchema.safeParse(inputs).success).toBe(true);
    expect(offsetFaceFeature.inputsSchema.safeParse(inputs).success).toBe(true);
    expect(offsetFaceSettings(inputs)).toEqual({
      faces: [face('a'), face('b')],
      keepRounds: true,
    });
    expect(inputs.distance).toEqual({ kind: 'expr', expr: '5 mm', unit: 'length' });
    expect(inputs.keepRounds).toEqual({ kind: 'bool', value: true });
    expect(offsetFaceSettings(offsetFaceInputs([face('a')], '5 mm', false)).keepRounds).toBe(false);
  });

  it('reads an offset without keepRounds (saved before it existed) as off', () => {
    const { keepRounds: _, ...old } = offsetFaceInputs([face('a')], '1 mm');
    expect(OffsetFaceInputsSchema.safeParse(old).success).toBe(true);
    expect(offsetFaceSettings(old).keepRounds).toBe(false);
    // A whole saved document loads without a migration and keeps the old meaning.
    const doc = createDocument();
    doc.features = [{ ...feature('o1', OFFSET_FACE_TYPE), inputs: old }];
    doc.timelineMarker = 1;
    const loaded = loadDocument(JSON.parse(JSON.stringify(doc)));
    expect(loaded.migrated).toBe(false);
    expect(loaded.dropped).toEqual([]);
    const inputs = loaded.doc.features[0]?.inputs as OffsetFaceInputs;
    expect(inputs.keepRounds).toBeUndefined();
    expect(offsetFaceSettings(inputs).keepRounds).toBe(false);
  });

  it('takes keepRounds only as a bool input', () => {
    const ok = offsetFaceInputs([face('a')], '1 mm');
    expect(
      OffsetFaceInputsSchema.safeParse({ ...ok, keepRounds: { kind: 'bool', value: 'yes' } })
        .success,
    ).toBe(false);
    expect(OffsetFaceInputsSchema.safeParse({ ...ok, keepRounds: true }).success).toBe(false);
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
