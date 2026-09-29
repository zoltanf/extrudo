import { describe, expect, it } from 'vitest';
import {
  FILLET_MAX_SETS,
  FilletInputsSchema,
  filletEdgesKey,
  filletInputs,
  filletRadiusKey,
  filletSets,
} from './fillet';
import type { GeomRef } from './schema';

const edge = (id: string): GeomRef => ({ kind: 'edge', id });

describe('fillet inputs', () => {
  it('names the inputs of each set: edges/radius, edges2/radius2 …', () => {
    expect([1, 2, 3].map(filletEdgesKey)).toEqual(['edges', 'edges2', 'edges3']);
    expect([1, 2, 3].map(filletRadiusKey)).toEqual(['radius', 'radius2', 'radius3']);
  });

  it('builds inputs from sets and reads the sets back in order', () => {
    const inputs = filletInputs([
      { edges: [edge('a'), edge('b')], radius: '2 mm' },
      { edges: [edge('c')], radius: 'wall / 2' },
    ]);
    expect(FilletInputsSchema.safeParse(inputs).success).toBe(true);
    expect(filletSets(inputs)).toEqual([
      { n: 1, edges: [edge('a'), edge('b')], radius: 'radius' },
      { n: 2, edges: [edge('c')], radius: 'radius2' },
    ]);
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
  });
});
