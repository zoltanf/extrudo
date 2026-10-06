import { describe, expect, it } from 'vitest';
import type { GeomRef } from './schema';
import {
  SHELL_DIRECTIONS,
  SHELL_MAX_WALLS,
  ShellInputsSchema,
  shellFeature,
  shellInputs,
  shellSettings,
  shellWallFacesKey,
  shellWallSets,
  shellWallThicknessKey,
} from './shell';

const face = (id: string): GeomRef => ({ kind: 'face', id });

describe('shell inputs', () => {
  it('builds inputs from plain values and reads them back with the defaults', () => {
    const inputs = shellInputs([face('a'), face('b')], '2 mm');
    expect(ShellInputsSchema.safeParse(inputs).success).toBe(true);
    expect(shellFeature.inputsSchema.safeParse(inputs).success).toBe(true);
    expect(shellSettings(inputs)).toEqual({
      faces: [face('a'), face('b')],
      bodies: [],
      direction: 'inside',
      walls: [],
    });
    expect(inputs.thickness).toEqual({ kind: 'expr', expr: '2 mm', unit: 'length' });
  });

  it('takes bodies to hollow closed and a direction', () => {
    const inputs = shellInputs([], 'wall / 2', { bodies: ['B:0', 'C:0'], direction: 'outside' });
    expect(ShellInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs.faces).toBeUndefined();
    expect(shellSettings(inputs)).toEqual({
      faces: [],
      bodies: ['B:0', 'C:0'],
      direction: 'outside',
      walls: [],
    });
    expect([...SHELL_DIRECTIONS]).toEqual(['inside', 'outside']);
  });

  it('takes wall sets: faces with a thickness of their own (P4-12)', () => {
    const inputs = shellInputs([face('top')], '2 mm', {
      walls: [
        { faces: [face('floor')], thickness: '4 mm' },
        { faces: [face('front'), face('back')], thickness: 'wall * 1.5' },
      ],
    });
    expect(ShellInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs[shellWallFacesKey(2)]).toEqual({
      kind: 'ref',
      refs: [face('front'), face('back')],
    });
    expect(inputs[shellWallThicknessKey(2)]).toEqual({
      kind: 'expr',
      expr: 'wall * 1.5',
      unit: 'length',
    });
    expect(shellSettings(inputs).walls).toEqual([
      { n: 1, faces: [face('floor')] },
      { n: 2, faces: [face('front'), face('back')] },
    ]);
    // An empty set does nothing; sets past SHELL_MAX_WALLS and other keys are refused.
    expect(shellWallSets({ ...inputs, wallFaces: { kind: 'ref', refs: [] } })).toEqual([
      { n: 2, faces: [face('front'), face('back')] },
    ]);
    expect(SHELL_MAX_WALLS).toBe(8);
    const tooMany = { ...inputs, [`wallFaces${SHELL_MAX_WALLS + 1}`]: inputs.wallFaces };
    expect(ShellInputsSchema.safeParse(tooMany).success).toBe(false);
    const notLength = { ...inputs, wallThickness: { kind: 'expr', expr: '4', unit: 'angle' } };
    expect(ShellInputsSchema.safeParse(notLength).success).toBe(false);
  });

  it('needs a thickness, and only faces and bodies as references', () => {
    expect(ShellInputsSchema.safeParse({}).success).toBe(false);
    const ok = shellInputs([face('a')], '1 mm');
    expect(
      ShellInputsSchema.safeParse({
        ...ok,
        faces: { kind: 'ref', refs: [{ kind: 'edge', id: 'e' }] },
      }).success,
    ).toBe(false);
    expect(
      ShellInputsSchema.safeParse({
        ...ok,
        thickness: { kind: 'expr', expr: '5 deg', unit: 'angle' },
      }).success,
    ).toBe(false);
    expect(
      ShellInputsSchema.safeParse({ ...ok, direction: { kind: 'enum', value: 'sideways' } })
        .success,
    ).toBe(false);
    expect(ShellInputsSchema.safeParse({ ...ok, stray: 1 }).success).toBe(false);
  });

  it('is a modify feature with the shell icon', () => {
    expect(shellFeature).toMatchObject({ type: 'shell', category: 'modify', icon: 'shell' });
  });
});
