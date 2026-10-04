import { describe, expect, it } from 'vitest';
import { PATTERNABLE_FEATURE_TYPES } from './pattern';
import {
  RIB_CURVE_KINDS,
  RIB_DEFAULT_THICKNESS,
  RIB_SIDES,
  RIB_TYPE,
  RibInputsSchema,
  ribFeature,
  ribInputs,
  ribSettings,
} from './rib';

const line = { kind: 'sketchEntity' as const, id: 'sk1/l0' };

describe('rib inputs', () => {
  it('takes the minimal rib: 2 mm centred on the sketch plane', () => {
    const inputs = RibInputsSchema.parse(ribInputs(line));
    expect(ribSettings(inputs)).toEqual({ curve: line, side: 'both', flip: false });
    expect(RIB_DEFAULT_THICKNESS).toBe(2);
    expect(RIB_SIDES).toEqual(['both', 'one', 'other']);
    expect(RIB_CURVE_KINDS).toEqual(['sketchEntity']);
  });

  it('reads every option', () => {
    const inputs = ribInputs(line, { thickness: 'tolerance', side: 'other', flip: true });
    expect(RibInputsSchema.safeParse(inputs).success).toBe(true);
    expect(ribSettings(inputs)).toEqual({
      curve: line,
      thickness: 'thickness',
      side: 'other',
      flip: true,
    });
  });

  it('round trips through the schema', () => {
    const inputs = ribInputs(line, { thickness: '3 mm', side: 'one', flip: true });
    const parsed = RibInputsSchema.parse(JSON.parse(JSON.stringify(inputs)));
    expect(parsed).toEqual(inputs);
    expect(ribSettings(parsed)).toEqual(ribSettings(inputs));
  });

  it('refuses what a rib is not', () => {
    // The thickness must be an expression of a length.
    expect(RibInputsSchema.safeParse({ ...ribInputs(line), thickness: 2 }).success).toBe(false);
    expect(
      RibInputsSchema.safeParse({
        ...ribInputs(line),
        thickness: { kind: 'expr', expr: '2 deg', unit: 'angle' },
      }).success,
    ).toBe(false);
    // Only three sides.
    expect(
      RibInputsSchema.safeParse({
        ...ribInputs(line),
        side: { kind: 'enum', value: 'left' },
      }).success,
    ).toBe(false);
    // One sketch line, nothing else.
    expect(
      RibInputsSchema.safeParse({
        curve: { kind: 'ref', refs: [line, line] },
      }).success,
    ).toBe(false);
    expect(
      RibInputsSchema.safeParse({
        curve: { kind: 'ref', refs: [{ kind: 'edge' as const, id: 'e[a|b]' }] },
      }).success,
    ).toBe(false);
    expect(
      RibInputsSchema.safeParse({
        curve: { kind: 'ref', refs: [{ kind: 'profile' as const, id: 'sk1/region-a' }] },
      }).success,
    ).toBe(false);
  });

  it('is a create feature patterns and mirrors can repeat (it joins)', () => {
    expect(ribFeature).toMatchObject({
      type: RIB_TYPE,
      label: 'Rib',
      category: 'create',
      icon: 'rib',
    });
    expect(PATTERNABLE_FEATURE_TYPES).toContain(RIB_TYPE);
  });
});
