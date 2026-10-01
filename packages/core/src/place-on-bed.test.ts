import { describe, expect, it } from 'vitest';
import { PlaceOnBedInputsSchema, placeOnBedFeature, placeOnBedInputs } from './place-on-bed';

describe('place on bed inputs', () => {
  it('takes one face', () => {
    const inputs = placeOnBedInputs({ kind: 'face', id: 'extrude:E:cap:end' });
    expect(PlaceOnBedInputsSchema.safeParse(inputs).success).toBe(true);
    expect(placeOnBedFeature.type).toBe('placeOnBed');
  });

  it('takes several faces (one per body) and an optional spin angle', () => {
    const a = { kind: 'face', id: 'a' } as const;
    const b = { kind: 'face', id: 'b' } as const;
    const inputs = placeOnBedInputs([a, b], '45 deg');
    expect(inputs.face.refs).toEqual([a, b]);
    expect(inputs.spin).toEqual({ kind: 'expr', expr: '45 deg', unit: 'angle' });
    expect(PlaceOnBedInputsSchema.safeParse(inputs).success).toBe(true);
    expect(placeOnBedInputs(a).spin).toBeUndefined();
  });

  it('refuses a spin that is not an angle, and anything but a face', () => {
    const face = { kind: 'face', id: 'a' } as const;
    expect(
      PlaceOnBedInputsSchema.safeParse({
        face: { kind: 'ref', refs: [face] },
        spin: { kind: 'expr', expr: '5 mm', unit: 'length' },
      }).success,
    ).toBe(false);
    expect(
      PlaceOnBedInputsSchema.safeParse({
        face: { kind: 'ref', refs: [{ kind: 'edge', id: 'e' }] },
      }).success,
    ).toBe(false);
    expect(PlaceOnBedInputsSchema.safeParse({ face: { kind: 'ref', refs: [] } }).success).toBe(
      true,
    );
    expect(PlaceOnBedInputsSchema.safeParse({}).success).toBe(false);
  });
});
