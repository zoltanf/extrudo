import type { BodyId } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { boxMesh } from '../selection/testing';
import {
  analyzeBody,
  analyzeOverhang,
  bedLevel,
  DOWN_DIRECTIONS,
  downVector,
  type OverhangView,
  overhangSummary,
  thresholdOf,
} from './overhang';

const view = (over: Partial<OverhangView> = {}, degrees = 45): OverhangView => ({
  down: [0, 0, -1],
  threshold: thresholdOf(degrees),
  bed: 0,
  ...over,
});

/**
 * A rectangle 10 × 10 mm facing `degrees` below the horizontal (its normal tilted from the horizontal towards -Z), placed at the height `z`.
 */
function slope(below: number, z = 50): BodyMesh {
  const t = (below * Math.PI) / 180;
  // Normal: horizontal part along +Y, down part along -Z.
  const normal = [0, Math.cos(t), -Math.sin(t)];
  // Two edge directions square to it.
  const u = [1, 0, 0];
  const v = [0, Math.sin(t), Math.cos(t)];
  const corners = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ].map(([a, b]) => [
    (a as number) * (u[0] as number) + (b as number) * (v[0] as number),
    (a as number) * (u[1] as number) + (b as number) * (v[1] as number),
    z + (a as number) * (u[2] as number) + (b as number) * (v[2] as number),
  ]);
  return {
    positions: Float32Array.from(corners.flat()),
    normals: Float32Array.from([...normal, ...normal, ...normal, ...normal]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    faceRanges: Uint32Array.from([0, 2]),
    edgePoints: new Float32Array(),
    edgeRanges: new Uint32Array(),
    edgeFlags: new Uint8Array(),
    vertices: new Float32Array(),
  };
}

/** A cylinder of radius 5 and length 10 lying along X, smooth normals, `n` segments. */
function lying(n = 36): BodyMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = 0.1 + (2 * Math.PI * i) / n;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    positions.push(0, 5 * c, 5 * s + 20, 10, 5 * c, 5 * s + 20);
    normals.push(0, c, s, 0, c, s);
  }
  for (let i = 0; i < n; i++) {
    const [a, b] = [2 * i, 2 * ((i + 1) % n)];
    indices.push(a, b, b + 1, a, b + 1, a + 1);
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    faceRanges: Uint32Array.from([0, 2 * n]),
    edgePoints: new Float32Array(),
    edgeRanges: new Uint32Array(),
    edgeFlags: new Uint8Array(),
    vertices: new Float32Array(),
  };
}

describe('the overhang rule', () => {
  it('flags nothing on a box that stands on the bed: the bottom is bed contact', () => {
    const r = analyzeBody(boxMesh([0, 0, 0], [10, 10, 10]), view());
    expect(r).toMatchObject({ faces: [], triangles: 0, area: 0, bed: 2 });
  });

  it('flags the underside of a box that floats, where nothing lies below it', () => {
    const r = analyzeBody(boxMesh([0, 0, 5], [10, 10, 15]), view());
    // Face 0 is the -Z face: two triangles of 50 mm², 100 mm² in all.
    expect(r).toMatchObject({ faces: [0], triangles: 2, area: 100, bed: 0 });
  });

  it('takes the bed from the lowest point of all the bodies', () => {
    const low = boxMesh([0, 0, 0], [10, 10, 10]);
    const high = boxMesh([20, 0, 5], [30, 10, 15]);
    expect(bedLevel([low, high], [0, 0, -1])).toBe(0);
    const bed = bedLevel([low, high], [0, 0, -1]);
    const report = analyzeOverhang(
      [
        { id: 'A:0' as BodyId, mesh: low },
        { id: 'B:0' as BodyId, mesh: high },
      ],
      view({ bed }),
    );
    expect(report.bodies['A:0']).toMatchObject({ triangles: 0, bed: 2 });
    expect(report.bodies['B:0']).toMatchObject({ faces: [0], triangles: 2 });
    expect(report).toMatchObject({ faces: 1, triangles: 2, area: 100, bed: 2 });
  });

  it('measures the bed along the chosen down direction', () => {
    const box = boxMesh([0, 0, 0], [10, 10, 10]);
    expect(bedLevel([box], [0, 0, 1])).toBe(10 * 1);
    expect(bedLevel([box], [-1, 0, 0])).toBe(0);
    expect(bedLevel([box], [1, 0, 0])).toBe(10);
    expect(bedLevel([], [0, 0, -1])).toBeNaN();
  });

  it('follows the down direction: with +X down the +X face is the bed', () => {
    const box = boxMesh([0, 0, 0], [10, 10, 10]);
    const down = downVector('+x');
    const r = analyzeBody(box, { down, threshold: thresholdOf(45), bed: bedLevel([box], down) });
    expect(r).toMatchObject({ faces: [], triangles: 0, bed: 2 });
    // With +Z down instead, the -Z face is a ceiling facing up: no problem either.
    const up = downVector('+z');
    expect(
      analyzeBody(box, { down: up, threshold: thresholdOf(45), bed: bedLevel([box], up) }).faces,
    ).toEqual([]);
  });

  it('flags a face steeper than the angle and passes a shallower one, per triangle', () => {
    // 30° below the horizontal: a gentle slope needs no support at 45°, does at 20°.
    const gentle = slope(30);
    expect(analyzeBody(gentle, view({}, 45)).triangles).toBe(0);
    expect(analyzeBody(gentle, view({}, 20))).toMatchObject({ faces: [0], triangles: 2 });
    // 60° below the horizontal: nearly a ceiling, flagged at 45°.
    expect(analyzeBody(slope(60), view({}, 45))).toMatchObject({ faces: [0], triangles: 2 });
    // The same face is not flagged once the limit is 60° or more.
    expect(analyzeBody(slope(60), view({}, 60)).triangles).toBe(0);
    expect(analyzeBody(slope(60), view({}, 75)).triangles).toBe(0);
  });

  it('does not flag a face exactly at the angle (steeper than N only)', () => {
    expect(analyzeBody(slope(45), view({}, 45)).triangles).toBe(0);
    expect(analyzeBody(slope(45.5), view({}, 45)).triangles).toBe(2);
  });

  it('flags every downward face at 0° and nothing at 90°', () => {
    expect(analyzeBody(slope(5), view({}, 0)).triangles).toBe(2);
    expect(analyzeBody(slope(89), view({}, 90)).triangles).toBe(0);
    // A vertical wall is never an overhang, even at 0°.
    expect(analyzeBody(slope(0), view({}, 0)).triangles).toBe(0);
    // Faces that look up are none either.
    expect(analyzeBody(slope(-40), view({}, 0)).triangles).toBe(0);
  });

  it('classifies a curved face triangle by triangle', () => {
    const mesh = lying();
    const r = analyzeBody(mesh, view({ bed: 100 }, 45));
    // One face, flagged where the normal is more than 45° below the horizontal: about a
    // quarter of the 36 segments, two triangles each.
    expect(r.faces).toEqual([0]);
    expect(r.triangles).toBeGreaterThanOrEqual(16);
    expect(r.triangles).toBeLessThanOrEqual(20);
    expect(r.triangles % 2).toBe(0);
    // A limit of 0° takes the whole lower half.
    const half = analyzeBody(mesh, view({ bed: 100 }, 0));
    expect(half.triangles).toBeGreaterThan(r.triangles);
    expect(half.triangles).toBeLessThanOrEqual(38);
    expect(half.triangles).toBeGreaterThanOrEqual(34);
    // And the flagged area shrinks with the flagged triangles.
    expect(half.area).toBeGreaterThan(r.area);
  });
});

describe('the directions and the summary', () => {
  it('lists -Z first and every direction as a unit vector', () => {
    expect(DOWN_DIRECTIONS[0].id).toBe('-z');
    for (const d of DOWN_DIRECTIONS) {
      expect(Math.hypot(...d.vector)).toBe(1);
      expect(downVector(d.id)).toBe(d.vector);
    }
  });

  it('writes the summary tests read', () => {
    const report = analyzeOverhang(
      [{ id: 'A:0' as BodyId, mesh: boxMesh([0, 0, 5], [10, 10, 15]) }],
      view(),
    );
    expect(overhangSummary({ angle: '45 deg', down: '-z', on: true }, 45, report)).toBe(
      'down=-z angle=45 faces=1 triangles=2 area=100 bed=0',
    );
    expect(overhangSummary({ angle: 'x', down: '+x', on: false }, undefined, undefined)).toBe(
      'down=+x angle=? off',
    );
  });
});
