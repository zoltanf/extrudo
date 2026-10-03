import { describe, expect, it } from 'vitest';
import {
  CoilInputsSchema,
  coilInputs,
  coilSectionExtent,
  coilSectionShift,
  coilSettings,
  coilTurns,
} from './coil';
import { LoftInputsSchema, loftInputs, loftSettings } from './loft';
import { PATTERNABLE_FEATURE_TYPES } from './pattern';
import { DEFAULT_PLACEMENT } from './primitives';
import { SweepInputsSchema, sweepInputs, sweepSettings } from './sweep';

const profile = { kind: 'profile' as const, id: 'S/r1' };
const line = { kind: 'sketchEntity' as const, id: 'P/l1' };

describe('sweep inputs', () => {
  it('a minimal sweep is profiles and a path: follow, no twist or scale, a new body', () => {
    const inputs = sweepInputs([profile], [line]);
    expect(SweepInputsSchema.safeParse(inputs).success).toBe(true);
    expect(sweepSettings(inputs)).toEqual({
      profiles: [profile],
      path: [line],
      orientation: 'follow',
      operation: 'new-body',
      bodies: [],
    });
  });

  it('names the twist and scale inputs when present, with their units', () => {
    const inputs = sweepInputs([profile], [line], {
      orientation: 'fixed',
      twist: '30 deg',
      scale: '0.5',
      operation: 'cut',
      bodies: ['B:0'],
    });
    expect(SweepInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs.twist).toEqual({ kind: 'expr', expr: '30 deg', unit: 'angle' });
    expect(inputs.scale).toEqual({ kind: 'expr', expr: '0.5', unit: 'unitless' });
    expect(sweepSettings(inputs)).toMatchObject({
      orientation: 'fixed',
      twist: 'twist',
      scale: 'scale',
      bodies: ['B:0'],
    });
  });

  it('refuses a path of faces and a twist in millimetres', () => {
    expect(
      SweepInputsSchema.safeParse(sweepInputs([profile], [{ kind: 'face', id: 'f' }])).success,
    ).toBe(false);
    const inputs = { ...sweepInputs([profile], [line]), twist: { kind: 'expr', expr: '3 mm' } };
    expect(SweepInputsSchema.safeParse(inputs).success).toBe(false);
  });
});

describe('loft inputs', () => {
  it('takes profiles, faces and points, smooth and open by default', () => {
    const sections = [profile, { kind: 'face' as const, id: 'f' }, { kind: 'point' as const, id: 'Q' }];
    const inputs = loftInputs(sections);
    expect(LoftInputsSchema.safeParse(inputs).success).toBe(true);
    expect(loftSettings(inputs)).toEqual({
      sections,
      ruled: false,
      closed: false,
      operation: 'new-body',
      bodies: [],
    });
    expect(loftSettings(loftInputs(sections, { ruled: true, closed: true }))).toMatchObject({
      ruled: true,
      closed: true,
    });
    expect(LoftInputsSchema.safeParse(loftInputs([{ kind: 'body', id: 'B' }])).success).toBe(false);
  });
});

describe('coil inputs', () => {
  it('a minimal coil is {}: on XY, revolutions and height, counter-clockwise, a round wire on the diameter', () => {
    expect(CoilInputsSchema.safeParse({}).success).toBe(true);
    expect(coilSettings({})).toEqual({
      plane: DEFAULT_PLACEMENT,
      type: 'revolutions-height',
      direction: 'counter-clockwise',
      section: 'circle',
      position: 'on',
      operation: 'new-body',
      bodies: [],
      exprs: new Set(),
    });
  });

  it('builds inputs with units, and knows its numbers', () => {
    const inputs = coilInputs({
      type: 'height-pitch',
      section: 'square',
      numbers: { height: '30 mm', pitch: '3 mm', taper: '5 deg', revolutions: '2' },
    });
    expect(CoilInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs.taper).toEqual({ kind: 'expr', expr: '5 deg', unit: 'angle' });
    expect(inputs.revolutions).toEqual({ kind: 'expr', expr: '2', unit: 'unitless' });
    expect([...coilSettings(inputs).exprs].sort()).toEqual(['height', 'pitch', 'revolutions', 'taper']);
    expect(() => coilInputs({ numbers: { width: '3 mm' } })).toThrow(/no number "width"/);
  });

  it('works out the third of revolutions, height and pitch', () => {
    const n = { revolutions: 4, height: 20, pitch: 3 };
    expect(coilTurns('revolutions-height', n)).toEqual({ turns: 4, pitch: 5, height: 20 });
    expect(coilTurns('revolutions-pitch', n)).toEqual({ turns: 4, pitch: 3, height: 12 });
    expect(coilTurns('height-pitch', n)).toEqual({ turns: 20 / 3, pitch: 3, height: 20 });
  });

  it('measures sections and where they sit against the diameter', () => {
    expect(coilSectionExtent('circle', 2)).toEqual({ along: 2, across: 2 });
    expect(coilSectionExtent('triangle-out', 2).across).toBeCloseTo(Math.sqrt(3));
    expect(coilSectionShift('square', 2, 'inside')).toBe(-1);
    expect(coilSectionShift('square', 2, 'on')).toBe(0);
    expect(coilSectionShift('triangle-in', 2, 'outside')).toBeCloseTo(Math.sqrt(3) / 2);
  });
});

it('patterns and mirrors can repeat sweeps, lofts and coils', () => {
  expect(PATTERNABLE_FEATURE_TYPES).toEqual(expect.arrayContaining(['sweep', 'loft', 'coil']));
});
