import { describe, expect, it } from 'vitest';
import { DRAFT_TYPE, DraftInputsSchema, draftFeature, draftInputs, draftSettings } from './draft';
import type { GeomRef } from './schema';

const face = (id: string): GeomRef => ({ kind: 'face', id });
const XY: GeomRef = { kind: 'plane', id: 'origin:xy' };

describe('draft inputs', () => {
  it('builds inputs from plain values and reads them back', () => {
    const inputs = draftInputs([face('a'), face('b'), face('a')], XY, '3 deg');
    expect(DraftInputsSchema.safeParse(inputs).success).toBe(true);
    expect(draftSettings(inputs)).toEqual({
      faces: [face('a'), face('b')],
      plane: XY,
      flip: false,
    });
    expect(inputs.angle).toEqual({ kind: 'expr', expr: '3 deg', unit: 'angle' });
    expect(draftSettings(draftInputs([face('a')], XY, '3 deg', true)).flip).toBe(true);
  });

  it('takes a flat face as the neutral plane; the angle must be an angle', () => {
    expect(DraftInputsSchema.safeParse(draftInputs([face('a')], face('b'), '2 deg')).success).toBe(
      true,
    );
    const ok = draftInputs([face('a')], XY, '2 deg');
    expect(
      DraftInputsSchema.safeParse({ ...ok, angle: { kind: 'expr', expr: '2 mm', unit: 'length' } })
        .success,
    ).toBe(false);
    expect(
      DraftInputsSchema.safeParse({
        ...ok,
        faces: { kind: 'ref', refs: [{ kind: 'body', id: 'B' }] },
      }).success,
    ).toBe(false);
    expect(DraftInputsSchema.safeParse({ ...ok, stray: 1 }).success).toBe(false);
  });

  it('keeps empty picks valid for the schema (the kernel says what is missing)', () => {
    expect(DraftInputsSchema.safeParse(draftInputs([], undefined, '1 deg')).success).toBe(true);
  });

  it('is a modify feature with the draft icon', () => {
    expect(DRAFT_TYPE).toBe('draft');
    expect(draftFeature).toMatchObject({ type: 'draft', category: 'modify', icon: 'draft' });
  });
});
