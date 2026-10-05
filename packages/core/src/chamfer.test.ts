import { describe, expect, it } from 'vitest';
import {
  CHAMFER_MAX_SETS,
  ChamferInputsSchema,
  chamferAngleKey,
  chamferDistanceBKey,
  chamferDistanceKey,
  chamferEdgesKey,
  chamferFaceKey,
  chamferFlipKey,
  chamferInputs,
  chamferModeKey,
  chamferModeOf,
  chamferSets,
} from './chamfer';
import type { GeomRef } from './schema';

const edge = (id: string): GeomRef => ({ kind: 'edge', id });
const face = (id: string): GeomRef => ({ kind: 'face', id });

describe('chamfer inputs', () => {
  it('names the inputs of each set: set 1 plain, the others numbered', () => {
    const keys = (n: number) => [
      chamferEdgesKey(n),
      chamferModeKey(n),
      chamferDistanceKey(n),
      chamferDistanceBKey(n),
      chamferAngleKey(n),
      chamferFlipKey(n),
      chamferFaceKey(n),
    ];
    expect(keys(1)).toEqual(['edges', 'mode', 'distance', 'distanceB', 'angle', 'flip', 'face']);
    expect(keys(3)).toEqual([
      'edges3',
      'mode3',
      'distance3',
      'distanceB3',
      'angle3',
      'flip3',
      'face3',
    ]);
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
        face: undefined,
        distance: 'distance',
        distanceB: undefined,
        angle: undefined,
      },
      {
        n: 2,
        edges: [edge('c')],
        mode: 'two-distances',
        flip: true,
        face: undefined,
        distance: 'distance2',
        distanceB: 'distanceB2',
        angle: undefined,
      },
      {
        n: 3,
        edges: [edge('d')],
        mode: 'distance-angle',
        flip: false,
        face: undefined,
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
    const notAFace: GeomRef = { kind: 'face', id: 'f' };
    const ok = (inputs: object) => ChamferInputsSchema.safeParse(inputs).success;
    expect(ok({})).toBe(true);
    expect(ok({ edges: { kind: 'ref', refs: [notAFace] } })).toBe(false);
    expect(ok({ distance: { kind: 'expr', expr: '1 deg', unit: 'angle' } })).toBe(false);
    expect(ok({ angle: { kind: 'expr', expr: '1 mm', unit: 'length' } })).toBe(false);
    expect(ok({ mode: { kind: 'enum', value: 'bevelled' } })).toBe(false);
    expect(ok({ flip: { kind: 'bool', value: true } })).toBe(true);
  });

  it('takes one face as a set’s reference face, and gives it back', () => {
    const inputs = chamferInputs([
      { edges: [edge('a')], mode: 'two-distances', distance: '1 mm', distanceB: '2 mm' },
      {
        edges: [edge('b')],
        mode: 'two-distances',
        distance: '3 mm',
        distanceB: '1 mm',
        face: face('f2'),
      },
    ]);
    expect(ChamferInputsSchema.safeParse(inputs).success).toBe(true);
    expect(chamferSets(inputs).map((s) => s.face)).toEqual([undefined, face('f2')]);
    // One face only, and of kind `face`.
    expect(ChamferInputsSchema.safeParse({ face: { kind: 'ref', refs: [] } }).success).toBe(true);
    expect(
      ChamferInputsSchema.safeParse({ face: { kind: 'ref', refs: [face('a'), face('b')] } })
        .success,
    ).toBe(false);
    expect(
      ChamferInputsSchema.safeParse({ face: { kind: 'ref', refs: [edge('a')] } }).success,
    ).toBe(false);
  });

  it('reads a document written with eight sets as it was, and has room for more', () => {
    // A P3-02 document: eight sets of edges, radii and flips.
    const inputs: Record<string, unknown> = {};
    for (let n = 1; n <= 8; n++) {
      inputs[chamferEdgesKey(n)] = { kind: 'ref', refs: [edge(`e${n}`)] };
      inputs[chamferDistanceKey(n)] = { kind: 'expr', expr: `${n} mm`, unit: 'length' };
      inputs[chamferFlipKey(n)] = { kind: 'bool', value: n % 2 === 0 };
    }
    expect(ChamferInputsSchema.safeParse(inputs).success).toBe(true);
    expect(chamferSets(inputs as never).map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Set 20 is still there after P4-12 raised the maximum.
    inputs[chamferEdgesKey(20)] = { kind: 'ref', refs: [edge('e20')] };
    inputs[chamferDistanceKey(20)] = { kind: 'expr', expr: '20 mm', unit: 'length' };
    expect(ChamferInputsSchema.safeParse(inputs).success).toBe(true);
    expect(chamferSets(inputs as never).map((s) => s.n)).toContain(20);
    expect(CHAMFER_MAX_SETS).toBe(32);
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
