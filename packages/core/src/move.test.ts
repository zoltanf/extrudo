import { describe, expect, it } from 'vitest';
import { MoveInputsSchema, moveInputs, moveSettings } from './move';
import type { GeomRef } from './schema';

describe('move inputs', () => {
  it('a bare move is free, without a copy', () => {
    const inputs = moveInputs(['B:0']);
    expect(MoveInputsSchema.safeParse(inputs).success).toBe(true);
    expect(moveSettings(inputs)).toMatchObject({
      mode: 'free',
      copy: false,
      axis: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it('builds every mode with valid units', () => {
    const axis: GeomRef = { kind: 'axis', id: 'origin:x' };
    const vertex: GeomRef = { kind: 'vertex', id: 'v[a,b,c]' };
    const point: GeomRef = { kind: 'point', id: 'Point1' };
    const free = moveInputs(['B:0'], { dx: '10 mm', dy: 'w', rz: '90 deg', copy: true });
    const rotate = moveInputs(['B:0'], { mode: 'rotate', axis, angle: '45 deg' });
    const between = moveInputs(['B:0'], { mode: 'point-to-point', from: vertex, to: point });
    for (const input of [free, rotate, between]) {
      expect(MoveInputsSchema.safeParse(input).success).toBe(true);
    }
    expect(moveSettings(free).copy).toBe(true);
    expect(moveSettings(rotate).axis).toEqual(axis);
    expect(moveSettings(between)).toMatchObject({ from: vertex, to: point });
  });

  it('refuses a length where an angle goes and a face as a point', () => {
    const inputs = moveInputs(['B:0']);
    expect(
      MoveInputsSchema.safeParse({ ...inputs, rx: { kind: 'expr', expr: '5 mm', unit: 'length' } })
        .success,
    ).toBe(false);
    expect(
      MoveInputsSchema.safeParse({
        ...inputs,
        from: { kind: 'ref', refs: [{ kind: 'face', id: 'f' }] },
      }).success,
    ).toBe(false);
  });
});
