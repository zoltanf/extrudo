import { ORIGIN_PLANES, type SketchFrame } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../viewport/store';
import { datumSnapsAt } from './datums';

const plane = (id: string) => ORIGIN_PLANES.find((p) => p.id === id)?.frame as SketchFrame;
const shown = { ...DEFAULT_SETTINGS.origin };

describe('datum picks (ADR-0093)', () => {
  it('offers the origin before an axis, and an axis as its 100 mm line', () => {
    const xy = plane('origin:xy');
    expect(datumSnapsAt(xy, [0.1, 0.1], 0.8, shown).point?.ref).toEqual({
      kind: 'point',
      id: 'origin:point',
    });
    const { point, axis } = datumSnapsAt(xy, [0.3, 30], 0.8, shown);
    expect(point).toBeUndefined();
    expect(axis).toMatchObject({
      ref: { kind: 'axis', id: 'origin:y' },
      kind: 'axis',
      point: [0, 30],
      line: [
        [0, -50],
        [0, 50],
      ],
    });
    expect(datumSnapsAt(xy, [5, 5], 0.8, shown)).toEqual({});
  });

  it('turns an axis along the normal into a point, and skips hidden ones', () => {
    // The Front plane (XZ): the Y axis is seen end-on, Z runs up the sketch.
    const xz = plane('origin:xz');
    const hidden = { ...shown, point: false };
    expect(datumSnapsAt(xz, [0.1, 0], 0.8, hidden).point).toMatchObject({
      ref: { kind: 'axis', id: 'origin:y' },
      kind: 'point',
    });
    expect(datumSnapsAt(xz, [0.2, 20], 0.8, shown).axis?.ref.id).toBe('origin:z');
    expect(datumSnapsAt(xz, [0.2, 20], 0.8, { ...shown, z: false })).toEqual({});
  });
});
