import { describe, expect, it } from 'vitest';
import {
  FULL_TURN,
  REVOLVE_TYPE,
  RevolveInputsSchema,
  revolveFeature,
  revolveInputs,
  revolveSettings,
} from './revolve';
import type { GeomRef } from './schema';
import { ORIGIN_AXES, originAxis, originAxisRef } from './sketch/planes';

const profile: GeomRef = { kind: 'profile', id: 'S/r1' };
const yAxis = originAxisRef('origin:y');

describe('revolve inputs', () => {
  it('needs nothing but profiles and an axis: a full turn, a new body', () => {
    const inputs = revolveInputs([profile], yAxis);
    expect(inputs).toEqual({
      profiles: { kind: 'ref', refs: [profile] },
      axis: { kind: 'ref', refs: [yAxis] },
    });
    expect(RevolveInputsSchema.safeParse(inputs).success).toBe(true);
    expect(revolveSettings(inputs)).toEqual({
      profiles: [profile],
      axis: yAxis,
      direction: 'one-side',
      flip: false,
      operation: 'new-body',
      bodies: [],
    });
    expect(FULL_TURN).toBe('360 deg');
    expect(RevolveInputsSchema.safeParse({}).success).toBe(true);
    expect(revolveSettings({})).toMatchObject({ profiles: [], axis: undefined });
  });

  it('reads every option, and side 2 only for two sides', () => {
    const line: GeomRef = { kind: 'sketchEntity', id: 'S/l1' };
    const all = revolveInputs([profile, { kind: 'face', id: 'extrude:E:cap:end' }], line, {
      direction: 'two-sides',
      angle: '90 deg',
      angle2: '30 deg',
      flip: true,
      operation: 'cut',
      bodies: ['E:0'],
    });
    expect(RevolveInputsSchema.safeParse(all).success).toBe(true);
    expect(revolveSettings(all)).toEqual({
      profiles: all.profiles?.refs,
      axis: line,
      direction: 'two-sides',
      angle: 'angle',
      angle2: 'angle2',
      flip: true,
      operation: 'cut',
      bodies: ['E:0'],
    });
    const symmetric = revolveSettings({ ...all, direction: { kind: 'enum', value: 'symmetric' } });
    expect(symmetric.angle).toBe('angle');
    expect(symmetric.angle2).toBeUndefined();
    // A straight body edge is an axis too.
    const edge = revolveInputs([profile], { kind: 'edge', id: 'e[a|b]' });
    expect(RevolveInputsSchema.safeParse(edge).success).toBe(true);
  });

  it('refuses wrong units, reference kinds and values', () => {
    const bad = (inputs: unknown) => RevolveInputsSchema.safeParse(inputs).success;
    expect(bad({ angle: { kind: 'expr', expr: '5 mm', unit: 'length' } })).toBe(false);
    expect(bad({ angle: { kind: 'expr', expr: '5' } })).toBe(false);
    expect(bad({ axis: { kind: 'ref', refs: [{ kind: 'face', id: 'f' }] } })).toBe(false);
    expect(bad({ axis: { kind: 'ref', refs: [yAxis, originAxisRef('origin:x')] } })).toBe(false);
    expect(bad({ profiles: { kind: 'ref', refs: [{ kind: 'edge', id: 'e' }] } })).toBe(false);
    expect(bad({ direction: { kind: 'enum', value: 'sideways' } })).toBe(false);
    expect(bad({ operation: { kind: 'enum', value: 'merge' } })).toBe(false);
    expect(bad({ extent: { kind: 'enum', value: 'full' } })).toBe(false);
  });

  it('accepts a whole-text reference in profiles (P4-03, ADR-0058 §5)', () => {
    const ok = (refs: unknown) =>
      RevolveInputsSchema.safeParse({ profiles: { kind: 'ref', refs } }).success;
    expect(ok([{ kind: 'sketchEntity', id: 'S1/t9' }])).toBe(true);
    expect(ok([{ kind: 'profile', id: 'S1/r1' }])).toBe(true);
    expect(ok([{ kind: 'edge', id: 'e' }])).toBe(false);
  });

  it('is the revolve feature type', () => {
    expect(revolveFeature).toMatchObject({ type: REVOLVE_TYPE, label: 'Revolve', icon: 'revolve' });
  });
});

describe('origin axes', () => {
  it('are X, Y and Z through the origin, referenced like the origin planes', () => {
    expect(ORIGIN_AXES.map((a) => [a.id, a.label, a.direction])).toEqual([
      ['origin:x', 'X axis', [1, 0, 0]],
      ['origin:y', 'Y axis', [0, 1, 0]],
      ['origin:z', 'Z axis', [0, 0, 1]],
    ]);
    expect(originAxis('origin:z')?.origin).toEqual([0, 0, 0]);
    expect(originAxis('origin:xy')).toBeUndefined();
    expect(originAxisRef('origin:x')).toEqual({ kind: 'axis', id: 'origin:x' });
  });
});
