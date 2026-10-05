import { describe, expect, it } from 'vitest';
import {
  angleAround,
  distanceAlong,
  draggedCount,
  draggedExpression,
  lengthStep,
  type Ray,
  snap,
  unwrapAngle,
} from './manipulate';

const settings = { units: 'mm', precision: 2 } as const;

describe('distance arrows', () => {
  it('finds the point of the line closest to the pointer ray', () => {
    // Looking down −Y at an arrow up +Z from the origin, the pointer 7 mm up.
    const ray: Ray = { origin: [3, 100, 7], direction: [0, -1, 0] };
    expect(distanceAlong([0, 0, 0], [0, 0, 1], ray)).toBeCloseTo(7, 9);
    expect(distanceAlong([0, 0, 2], [0, 0, 1], ray)).toBeCloseTo(5, 9);
    expect(distanceAlong([0, 0, 0], [0, 0, -1], ray)).toBeCloseTo(-7, 9);
  });

  it("can't be dragged along the line of sight", () => {
    const ray: Ray = { origin: [0, 0, 100], direction: [0, 0, -1] };
    expect(distanceAlong([0, 0, 0], [0, 0, 1], ray)).toBeUndefined();
  });
});

describe('angle arcs', () => {
  it('measures from zero towards axis × zero, in degrees', () => {
    // Axis +Y, zero +Z: positive angles turn towards Y × Z = +X.
    const at = (x: number, z: number): Ray => ({ origin: [x, 50, z], direction: [0, -1, 0] });
    expect(angleAround([0, 0, 0], [0, 1, 0], [0, 0, 1], at(0, 5))).toBeCloseTo(0, 9);
    expect(angleAround([0, 0, 0], [0, 1, 0], [0, 0, 1], at(5, 5))).toBeCloseTo(45, 9);
    expect(angleAround([0, 0, 0], [0, 1, 0], [0, 0, 1], at(-5, 0))).toBeCloseTo(-90, 9);
  });

  it('has no angle for a ray in the plane or at its centre', () => {
    expect(
      angleAround([0, 0, 0], [0, 0, 1], [1, 0, 0], { origin: [0, -9, 0], direction: [0, 1, 0] }),
    ).toBeUndefined();
    expect(
      angleAround([0, 0, 0], [0, 0, 1], [1, 0, 0], { origin: [0, 0, 9], direction: [0, 0, -1] }),
    ).toBeUndefined();
  });
});

describe('snapping and the expression a drag writes', () => {
  it.each([
    [0.04, 0.1],
    [0.1, 0.2],
    [0.2, 0.5],
    [1, 2],
    [3, 5],
  ])('%s mm per pixel snaps to %s mm', (perPixel, step) => {
    expect(lengthStep(perPixel)).toBeCloseTo(step, 12);
  });

  it('rounds without float noise', () => {
    expect(snap(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(snap(-0.04, 0.1)).toBe(0);
    expect(snap(12.34, 0.5)).toBe(12.5);
  });

  it('writes numbers with units: the document length unit, whole degrees', () => {
    expect(draggedExpression(12.34, 'length', settings, 0.1)).toBe('12.4 mm');
    expect(draggedExpression(25.4 * 1.23, 'length', { units: 'in', precision: 3 }, 0.254)).toBe(
      '1.24 in',
    );
    expect(draggedExpression(-14.6, 'angle', settings, 1)).toBe('-15 deg');
  });
});

describe('unwrapAngle (P2-07)', () => {
  it('follows the handle round instead of wrapping at ±180°', () => {
    // The arc reads −170° after 175°: the drag went on to 190°.
    expect(unwrapAngle(-170, 175)).toBe(190);
    expect(unwrapAngle(10, 355)).toBe(360);
    expect(unwrapAngle(170, -175)).toBe(-190);
    expect(unwrapAngle(45, 40)).toBe(45);
  });

  it('stays within a whole turn, and takes a period for scaled arcs', () => {
    expect(unwrapAngle(20, 359)).toBe(360);
    expect(unwrapAngle(-20, -359)).toBe(-360);
    // A symmetric arc shows half the angle: it wraps every 720° of the value.
    expect(unwrapAngle(-340, 350, 720)).toBe(360);
    expect(unwrapAngle(100, 90, 720)).toBe(100);
  });
});

describe('draggedCount (P4-12)', () => {
  const row = { step: 20, count: 3, extent: false };

  it('is the nearest whole number of steps the drag reached, the first included', () => {
    expect(draggedCount(0, row)).toBe(1);
    expect(draggedCount(20, row)).toBe(2);
    expect(draggedCount(29, row)).toBe(2);
    expect(draggedCount(31, row)).toBe(3);
    expect(draggedCount(70, row)).toBe(5); // 3.5 steps, rounded up
  });

  it('counts by the share of the extent when the distance is first to last', () => {
    const extent = { step: 10, count: 3, extent: true };
    // Two steps of 10 mm are the whole extent, so the drag is where the handle is.
    expect(draggedCount(20, extent)).toBe(3);
    expect(draggedCount(30, extent)).toBe(5);
    expect(draggedCount(12, extent)).toBe(2);
    expect(draggedCount(0, extent)).toBe(1); // never below one instance
  });

  it('never drops below one, never passes the limit, and steps on a turn', () => {
    expect(draggedCount(-100, row)).toBe(1);
    expect(draggedCount(1e6, row)).toBe(1000);
    expect(draggedCount(400, row, 12)).toBe(12);
    // A whole turn of a six-instance pattern: 60 degrees a step.
    expect(draggedCount(0, { step: 60, count: 6, extent: true })).toBe(1);
    expect(draggedCount(180, { step: 60, count: 6, extent: true })).toBe(4);
    // A step of zero (the first two instances on top of each other) can't divide.
    expect(draggedCount(40, { step: 0, count: 2, extent: false })).toBe(1000);
    expect(draggedCount(40, { step: 0, count: 1, extent: true })).toBe(1000);
  });
});
