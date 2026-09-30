import { describe, expect, it } from 'vitest';
import { PlaceOnBedInputsSchema, placeOnBedFeature, placeOnBedInputs } from './place-on-bed';

describe('place on bed inputs', () => {
  it('takes one face', () => {
    const inputs = placeOnBedInputs({ kind: 'face', id: 'extrude:E:cap:end' });
    expect(PlaceOnBedInputsSchema.safeParse(inputs).success).toBe(true);
    expect(placeOnBedFeature.type).toBe('placeOnBed');
  });

  it('refuses two faces, and anything but a face', () => {
    const face = { kind: 'face', id: 'a' } as const;
    expect(
      PlaceOnBedInputsSchema.safeParse({ face: { kind: 'ref', refs: [face, face] } }).success,
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
