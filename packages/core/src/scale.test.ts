import { describe, expect, it } from 'vitest';
import { SCALE_TYPE, ScaleInputsSchema, scaleFeature, scaleInputs, scaleSettings } from './scale';
import type { GeomRef } from './schema';

describe('scale inputs', () => {
  it('reads defaults: uniform, about the box centre, in place', () => {
    const inputs = scaleInputs(['Body1', 'Body1']);
    expect(ScaleInputsSchema.safeParse(inputs).success).toBe(true);
    expect(scaleSettings(inputs)).toEqual({
      bodies: [{ kind: 'body', id: 'Body1' }],
      point: undefined,
      mode: 'uniform',
      copy: false,
    });
  });

  it('builds every option as plain-number expressions', () => {
    const point: GeomRef = { kind: 'point', id: 'Point1' };
    const inputs = scaleInputs(['B'], {
      mode: 'non-uniform',
      x: '2',
      y: '1 + s / 100',
      z: '0.5',
      point,
      copy: true,
    });
    expect(ScaleInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs.y).toEqual({ kind: 'expr', expr: '1 + s / 100', unit: 'unitless' });
    expect(scaleSettings(inputs)).toMatchObject({ mode: 'non-uniform', point, copy: true });
    expect(scaleInputs(['B'], { factor: '2' }).factor?.unit).toBe('unitless');
  });

  it('refuses lengths as factors, edges as the point and stray keys', () => {
    const ok = scaleInputs(['B'], { factor: '2' });
    expect(
      ScaleInputsSchema.safeParse({ ...ok, factor: { kind: 'expr', expr: '2 mm', unit: 'length' } })
        .success,
    ).toBe(false);
    expect(
      ScaleInputsSchema.safeParse({
        ...ok,
        point: { kind: 'ref', refs: [{ kind: 'edge', id: 'e' }] },
      }).success,
    ).toBe(false);
    expect(ScaleInputsSchema.safeParse({ ...ok, stray: 1 }).success).toBe(false);
  });

  it('is a modify feature with the scale icon', () => {
    expect(SCALE_TYPE).toBe('scale');
    expect(scaleFeature).toMatchObject({ type: 'scale', category: 'modify', icon: 'scale' });
  });
});
