import { describe, expect, it } from 'vitest';
import {
  CHAMFER_MAX_SETS,
  ChamferInputsSchema,
  chamferAngleKey,
  chamferDistanceBKey,
  chamferDistanceKey,
  chamferEdgesKey,
  chamferFlipKey,
  chamferInputs,
  chamferModeKey,
  chamferModeOf,
  chamferSets,
} from './chamfer';
import type { GeomRef } from './schema';

const edge = (id: string): GeomRef => ({ kind: 'edge', id });

describe('chamfer inputs', () => {
  it('names the inputs of each set: set 1 plain, the others numbered', () => {
    const keys = (n: number) => [
      chamferEdgesKey(n),
      chamferModeKey(n),
      chamferDistanceKey(n),
      chamferDistanceBKey(n),
      chamferAngleKey(n),
      chamferFlipKey(n),
    ];
    expect(keys(1)).toEqual(['edges', 'mode', 'distance', 'distanceB', 'angle', 'flip']);
    expect(keys(3)).toEqual(['edges3', 'mode3', 'distance3', 'distanceB3', 'angle3', 'flip3']);
  });

  it('builds inputs from sets and reads them back, each set with its own mode', () => {
    const inputs = chamferInputs([
      { edges: [edge('a'), edge('b')], distance: '2 mm' },
      {
        edges: [edge('c')],
        mode: 'two-distances',
        distance: '3 mm',
        distanceB: '1 mm',
        flip: true,
      },
      { edges: [edge('d')], mode: 'distance-angle', distance: 'wall', angle: '30 deg' },
    ]);
    expect(ChamferInputsSchema.safeParse(inputs).success).toBe(true);
    expect(chamferSets(inputs)).toEqual([
      {
        n: 1,
        edges: [edge('a'), edge('b')],
        mode: 'equal',
        flip: false,
        distance: 'distance',
        distanceB: undefined,
        angle: undefined,
      },
      {
        n: 2,
        edges: [edge('c')],
        mode: 'two-distances',
        flip: true,
        distance: 'distance2',
        distanceB: 'distanceB2',
        angle: undefined,
      },
      {
        n: 3,
        edges: [edge('d')],
        mode: 'distance-angle',
        flip: false,
        distance: 'distance3',
        distanceB: undefined,
        angle: 'angle3',
      },
    ]);
  });

  it('skips sets without edges and treats a missing or unknown mode as equal distance', () => {
    const inputs = chamferInputs([{ edges: [edge('a')], distance: '1 mm' }]);
    delete inputs.mode;
    inputs.edges2 = { kind: 'ref', refs: [] };
    inputs.edges3 = { kind: 'ref', refs: [edge('z')] };
    inputs.mode3 = { kind: 'enum', value: 'bevelled' };
    expect(chamferSets(inputs).map((s) => [s.n, s.mode, s.distance])).toEqual([
      [1, 'equal', 'distance'],
      [3, 'equal', undefined],
    ]);
    expect(chamferModeOf(inputs, 2)).toBe('equal');
  });

  it('accepts edge references, length distances, angle angles and known modes only', () => {
    const face: GeomRef = { kind: 'face', id: 'f' };
    const ok = (inputs: object) => ChamferInputsSchema.safeParse(inputs).success;
    expect(ok({})).toBe(true);
    expect(ok({ edges: { kind: 'ref', refs: [face] } })).toBe(false);
    expect(ok({ distance: { kind: 'expr', expr: '1 deg', unit: 'angle' } })).toBe(false);
    expect(ok({ angle: { kind: 'expr', expr: '1 mm', unit: 'length' } })).toBe(false);
    expect(ok({ mode: { kind: 'enum', value: 'bevelled' } })).toBe(false);
    expect(ok({ flip: { kind: 'bool', value: true } })).toBe(true);
  });

  it('refuses unknown inputs and sets beyond the maximum', () => {
    expect(ChamferInputsSchema.safeParse({ size: { kind: 'bool', value: true } }).success).toBe(
      false,
    );
    const beyond = chamferEdgesKey(CHAMFER_MAX_SETS + 1);
    expect(
      ChamferInputsSchema.safeParse({ [beyond]: { kind: 'ref', refs: [edge('a')] } }).success,
    ).toBe(false);
  });
});
