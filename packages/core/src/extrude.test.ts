import { describe, expect, it } from 'vitest';
import {
  EXTRUDE_TYPE,
  ExtrudeInputsSchema,
  extrudeFeature,
  extrudeInputs,
  extrudeSettings,
} from './extrude';
import type { GeomRef } from './schema';

const profile: GeomRef = { kind: 'profile', id: 'S/r1' };

describe('extrude inputs', () => {
  it('needs nothing but profiles and a distance', () => {
    const inputs = extrudeInputs([profile], { distance: '10 mm' });
    expect(inputs).toEqual({
      profiles: { kind: 'ref', refs: [profile] },
      distance: { kind: 'expr', expr: '10 mm', unit: 'length' },
    });
    expect(ExtrudeInputsSchema.safeParse(inputs).success).toBe(true);
    expect(extrudeSettings(inputs)).toEqual({
      profiles: [profile],
      direction: 'one-side',
      sides: [{ extent: 'distance', distance: 'distance' }],
      flip: false,
      operation: 'new-body',
      bodies: [],
    });
  });

  it('accepts the Wall bracket template, whose extrudes have no profiles yet', () => {
    const template = {
      distance: { kind: 'expr', expr: 'inner / 4', paramName: 'd1', unit: 'length' },
      taper: { kind: 'expr', expr: 'tilt / 3', paramName: 'd2', unit: 'angle' },
    };
    expect(ExtrudeInputsSchema.safeParse(template).success).toBe(true);
    expect(extrudeSettings(ExtrudeInputsSchema.parse(template)).profiles).toEqual([]);
    expect(ExtrudeInputsSchema.safeParse({}).success).toBe(true);
  });

  it('reads every option, and side 2 only for two sides', () => {
    const plane: GeomRef = { kind: 'plane', id: 'origin:xy' };
    const all = extrudeInputs([profile, { kind: 'face', id: 'extrude:E:cap:end' }], {
      direction: 'two-sides',
      extent: 'to-object',
      toObject: plane,
      taper: '5 deg',
      extent2: 'through-all',
      distance2: '3 mm',
      taper2: '-2 deg',
      flip: true,
      operation: 'cut',
      bodies: ['E:0'],
    });
    expect(ExtrudeInputsSchema.safeParse(all).success).toBe(true);
    const settings = extrudeSettings(all);
    expect(settings.sides).toEqual([
      { extent: 'to-object', toObject: plane, taper: 'taper' },
      { extent: 'through-all', distance: 'distance2', taper: 'taper2' },
    ]);
    expect(settings).toMatchObject({ flip: true, operation: 'cut', bodies: ['E:0'] });
    const symmetric = extrudeSettings({ ...all, direction: { kind: 'enum', value: 'symmetric' } });
    expect(symmetric.sides).toHaveLength(1);
  });

  it('refuses wrong units, reference kinds and values', () => {
    const bad = (inputs: unknown) => ExtrudeInputsSchema.safeParse(inputs).success;
    expect(bad({ distance: { kind: 'expr', expr: '5 deg', unit: 'angle' } })).toBe(false);
    expect(bad({ taper: { kind: 'expr', expr: '5' } })).toBe(false);
    expect(bad({ profiles: { kind: 'ref', refs: [{ kind: 'edge', id: 'e[a|b]' }] } })).toBe(false);
    expect(
      bad({
        toObject: {
          kind: 'ref',
          refs: [
            { kind: 'face', id: 'a' },
            { kind: 'face', id: 'b' },
          ],
        },
      }),
    ).toBe(false);
    expect(bad({ bodies: { kind: 'ref', refs: [{ kind: 'face', id: 'a' }] } })).toBe(false);
    expect(bad({ operation: { kind: 'enum', value: 'subtract' } })).toBe(false);
    expect(bad({ height: { kind: 'expr', expr: '1' } })).toBe(false);
  });

  it('is registered under its type', () => {
    expect(extrudeFeature).toMatchObject({ type: EXTRUDE_TYPE, label: 'Extrude', icon: 'extrude' });
  });
});
