import { describe, expect, it } from 'vitest';
import {
  EMBOSS_FACE_ROLES,
  EMBOSS_TYPE,
  EmbossInputsSchema,
  type EmbossMethod,
  embossFeature,
  embossInputs,
  embossMethodsText,
  embossMethodText,
  embossSettings,
} from './emboss';
import { SWEEP_FACE_ROLES } from './face-roles';
import { PATTERNABLE_FEATURE_TYPES } from './pattern';

const profile = { kind: 'profile' as const, id: 'sk1/region-a' };
const text = { kind: 'sketchEntity' as const, id: 'sk1/t1' };
const face = { kind: 'face' as const, id: 'extrude:a:side:c1' };

describe('emboss inputs', () => {
  it('takes the minimal emboss: 1 mm out of a face', () => {
    const inputs = EmbossInputsSchema.parse(embossInputs([profile], face));
    expect(embossSettings(inputs)).toEqual({
      profiles: [profile],
      faces: [face],
      mode: 'emboss',
      tangent: false,
    });
  });

  it('reads every option', () => {
    const inputs = embossInputs([profile, text], face, { depth: 'tolerance', mode: 'deboss' });
    expect(EmbossInputsSchema.safeParse(inputs).success).toBe(true);
    expect(embossSettings(inputs)).toEqual({
      profiles: [profile, text],
      faces: [face],
      depth: 'depth',
      mode: 'deboss',
      tangent: false,
    });
  });

  it('round trips the tangent toggle', () => {
    expect(embossInputs([profile], face, { tangent: true }).tangent).toEqual({
      kind: 'bool',
      value: true,
    });
    // Absent stays absent, so every existing document is byte-identical.
    expect(embossInputs([profile], face).tangent).toBeUndefined();
    const inputs = embossInputs([profile], face, { tangent: true });
    const parsed = EmbossInputsSchema.parse(JSON.parse(JSON.stringify(inputs)));
    expect(parsed).toEqual(inputs);
    expect(embossSettings(parsed).tangent).toBe(true);
  });

  it('takes several faces, and one face is stored as before', () => {
    const other = { kind: 'face' as const, id: 'fillet:f:from:(e[a|b])' };
    expect(embossInputs([profile], face).face).toEqual({ kind: 'ref', refs: [face] });
    expect(embossInputs([profile], [face]).face).toEqual({ kind: 'ref', refs: [face] });
    const inputs = embossInputs([profile], [face, other], { mode: 'deboss' });
    expect(inputs.face).toEqual({ kind: 'ref', refs: [face, other] });
    const parsed = EmbossInputsSchema.parse(JSON.parse(JSON.stringify(inputs)));
    expect(parsed).toEqual(inputs);
    expect(embossSettings(parsed).faces).toEqual([face, other]);
    expect(embossSettings({ profiles: { kind: 'ref', refs: [profile] } }).faces).toEqual([]);
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
    // Faces must be faces, and profiles profiles or texts.
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

  it('names each method once, in order, with how many faces took it', () => {
    const text = (methods: EmbossMethod[]) => embossMethodsText(methods);
    expect(text(['moved'])).toBe('Moved onto the face');
    expect(text(['moved'])).toBe(embossMethodText('moved'));
    expect(text(['moved', 'wrapped-cylinder'])).toBe(
      'Moved onto the face, wrapped round the cylinder',
    );
    expect(text(['moved', 'moved', 'wrapped-cylinder'])).toBe(
      'Moved onto 2 faces, wrapped round the cylinder',
    );
    expect(text(['projected', 'projected', 'projected'])).toBe('Projected onto 3 faces');
    expect(text(['wrapped-cone', 'wrapped-cone'])).toBe('Wrapped round 2 conical faces');
    expect(text(['wrapped-cylinder', 'moved', 'wrapped-cylinder'])).toBe(
      'Wrapped round 2 cylindrical faces, moved onto the face',
    );
  });

  it('lists the sweep roles and the clip walls', () => {
    expect(embossFeature.faceRoles).toBe(EMBOSS_FACE_ROLES);
    expect(EMBOSS_FACE_ROLES.slice(0, SWEEP_FACE_ROLES.length)).toEqual(SWEEP_FACE_ROLES);
    expect(EMBOSS_FACE_ROLES.map((role) => role.pattern)).toContain('clip:<n>');
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
