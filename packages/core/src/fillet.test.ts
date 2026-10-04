import { describe, expect, it } from 'vitest';
import {
  FILLET_MAX_SETS,
  type FilletInputs,
  FilletInputsSchema,
  filletEdgesKey,
  filletEndKey,
  filletInputs,
  filletIsVariable,
  filletRadiusKey,
  filletSets,
  filletSwapKey,
} from './fillet';
import type { GeomRef } from './schema';

const edge = (id: string): GeomRef => ({ kind: 'edge', id });

describe('fillet inputs', () => {
  it('names the inputs of each set: edges/radius, edges2/radius2 …', () => {
    expect([1, 2, 3].map(filletEdgesKey)).toEqual(['edges', 'edges2', 'edges3']);
    expect([1, 2, 3].map(filletRadiusKey)).toEqual(['radius', 'radius2', 'radius3']);
    expect([1, 2, 3].map(filletEndKey)).toEqual(['radiusEnd', 'radiusEnd2', 'radiusEnd3']);
    expect([1, 2, 3].map(filletSwapKey)).toEqual(['swap', 'swap2', 'swap3']);
  });

  it('builds inputs from sets and reads the sets back in order', () => {
    const inputs = filletInputs([
      { edges: [edge('a'), edge('b')], radius: '2 mm' },
      { edges: [edge('c')], radius: 'wall / 2' },
    ]);
    expect(FilletInputsSchema.safeParse(inputs).success).toBe(true);
    expect(filletSets(inputs)).toEqual([
      { n: 1, edges: [edge('a'), edge('b')], radius: 'radius', radiusEnd: undefined, swap: false },
      { n: 2, edges: [edge('c')], radius: 'radius2', radiusEnd: undefined, swap: false },
    ]);
    expect(filletIsVariable(inputs)).toBe(false);
  });

  it('skips sets without edges and reports a set without a radius', () => {
    const inputs = filletInputs([{ edges: [edge('a')], radius: '1 mm' }]);
    inputs.edges3 = { kind: 'ref', refs: [edge('z')] };
    inputs.edges2 = { kind: 'ref', refs: [] };
    expect(filletSets(inputs).map((s) => [s.n, s.radius])).toEqual([
      [1, 'radius'],
      [3, undefined],
    ]);
  });

  it('accepts only edge references and length expressions', () => {
    const face: GeomRef = { kind: 'face', id: 'f' };
    expect(FilletInputsSchema.safeParse({ edges: { kind: 'ref', refs: [face] } }).success).toBe(
      false,
    );
    expect(
      FilletInputsSchema.safeParse({ radius: { kind: 'expr', expr: '1 deg', unit: 'angle' } })
        .success,
    ).toBe(false);
    const notALength = { radiusEnd: { kind: 'bool', value: true } };
    expect(FilletInputsSchema.safeParse(notALength).success).toBe(false);
    const notAnExpression = { radiusEnd: { kind: 'expr', expr: '5', unit: 'angle' } };
    expect(FilletInputsSchema.safeParse(notAnExpression).success).toBe(false);
    expect(FilletInputsSchema.safeParse({}).success).toBe(true);
  });

  it('refuses unknown inputs and sets beyond the maximum', () => {
    expect(FilletInputsSchema.safeParse({ size: { kind: 'bool', value: true } }).success).toBe(
      false,
    );
    const beyond = filletEdgesKey(FILLET_MAX_SETS + 1);
    expect(
      FilletInputsSchema.safeParse({ [beyond]: { kind: 'ref', refs: [edge('a')] } }).success,
    ).toBe(false);
    const beyondEnd = filletEndKey(FILLET_MAX_SETS + 1);
    expect(
      FilletInputsSchema.safeParse({ [beyondEnd]: { kind: 'expr', expr: '1 mm', unit: 'length' } })
        .success,
    ).toBe(false);
  });
});

describe('fillet variable radius', () => {
  it('reads a set with an end radius as variable, with its swap', () => {
    const inputs = filletInputs([
      { edges: [edge('a')], radius: '2 mm', radiusEnd: '5 mm' },
      { edges: [edge('b')], radius: '1 mm' },
      { edges: [edge('c')], radius: '1 mm', radiusEnd: 'taper', swap: true },
    ]);
    expect(FilletInputsSchema.safeParse(inputs).success).toBe(true);
    expect(filletSets(inputs).map((s) => [s.n, s.radius, s.radiusEnd, s.swap])).toEqual([
      [1, 'radius', 'radiusEnd', false],
      [2, 'radius2', undefined, false],
      [3, 'radius3', 'radiusEnd3', true],
    ]);
    expect(filletIsVariable(inputs)).toBe(true);
  });

  it('leaves the swap out of the inputs when it is off', () => {
    const inputs = filletInputs([
      { edges: [edge('a')], radius: '2 mm', radiusEnd: '5 mm', swap: false },
    ]);
    expect(inputs.swap).toBeUndefined();
    expect(inputs.radiusEnd).toEqual({ kind: 'expr', expr: '5 mm', unit: 'length' });
    expect(filletSets(inputs)[0]?.swap).toBe(false);
  });

  it('reads a swap without an end radius as a constant fillet', () => {
    const inputs: FilletInputs = {
      edges: { kind: 'ref', refs: [edge('a')] },
      radius: { kind: 'expr', expr: '1 mm', unit: 'length' },
      swap: { kind: 'bool', value: true },
    };
    expect(filletSets(inputs)[0]?.radiusEnd).toBeUndefined();
    expect(filletIsVariable(inputs)).toBe(false);
  });
});
