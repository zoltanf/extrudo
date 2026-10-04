import { describe, expect, it } from 'vitest';
import {
  EMBOSS_TYPE,
  EmbossInputsSchema,
  embossFeature,
  embossInputs,
  embossSettings,
} from './emboss';
import { PATTERNABLE_FEATURE_TYPES } from './pattern';

const profile = { kind: 'profile' as const, id: 'sk1/region-a' };
const text = { kind: 'sketchEntity' as const, id: 'sk1/t1' };
const face = { kind: 'face' as const, id: 'extrude:a:side:c1' };

describe('emboss inputs', () => {
  it('takes the minimal emboss: 1 mm out of a face', () => {
    const inputs = EmbossInputsSchema.parse(embossInputs([profile], face));
    expect(embossSettings(inputs)).toEqual({
      profiles: [profile],
      face,
      mode: 'emboss',
    });
  });

  it('reads every option', () => {
    const inputs = embossInputs([profile, text], face, { depth: 'tolerance', mode: 'deboss' });
    expect(EmbossInputsSchema.safeParse(inputs).success).toBe(true);
    expect(embossSettings(inputs)).toEqual({
      profiles: [profile, text],
      face,
      depth: 'depth',
      mode: 'deboss',
    });
  });

  it('round trips through the schema', () => {
    const inputs = embossInputs([text], face, { depth: '2 mm', mode: 'deboss' });
    const parsed = EmbossInputsSchema.parse(JSON.parse(JSON.stringify(inputs)));
    expect(parsed).toEqual(inputs);
    expect(embossSettings(parsed)).toEqual(embossSettings(inputs));
  });

  it('refuses what an emboss is not', () => {
    // The depth must be an expression (of a length), not a number or a length unit.
    expect(
      EmbossInputsSchema.safeParse({ ...embossInputs([profile], face), depth: 2 }).success,
    ).toBe(false);
    expect(
      EmbossInputsSchema.safeParse({
        ...embossInputs([profile], face),
        depth: { kind: 'expr', expr: '2 deg', unit: 'angle' },
      }).success,
    ).toBe(false);
    // Only two modes.
    expect(
      EmbossInputsSchema.safeParse({
        ...embossInputs([profile], face),
        mode: { kind: 'enum', value: 'engrave' },
      }).success,
    ).toBe(false);
    // The face must be one face, and profiles profiles or texts.
    expect(
      EmbossInputsSchema.safeParse({
        profiles: { kind: 'ref', refs: [profile] },
        face: { kind: 'ref', refs: [face, face] },
      }).success,
    ).toBe(false);
    expect(
      EmbossInputsSchema.safeParse({
        profiles: { kind: 'ref', refs: [face] },
        face: { kind: 'ref', refs: [face] },
      }).success,
    ).toBe(false);
    expect(
      EmbossInputsSchema.safeParse({
        profiles: { kind: 'ref', refs: [profile] },
        face: { kind: 'ref', refs: [{ kind: 'edge' as const, id: 'e[a|b]' }] },
      }).success,
    ).toBe(false);
  });

  it('is a create feature patterns and mirrors can repeat', () => {
    expect(embossFeature).toMatchObject({
      type: EMBOSS_TYPE,
      label: 'Emboss',
      category: 'create',
      icon: 'emboss',
    });
    expect(PATTERNABLE_FEATURE_TYPES).toContain(EMBOSS_TYPE);
  });
});
