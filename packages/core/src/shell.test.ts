import { describe, expect, it } from 'vitest';
import type { GeomRef } from './schema';
import {
  SHELL_DIRECTIONS,
  ShellInputsSchema,
  shellFeature,
  shellInputs,
  shellSettings,
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
    });
    expect([...SHELL_DIRECTIONS]).toEqual(['inside', 'outside']);
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
