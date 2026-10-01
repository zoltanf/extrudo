import type { SketchData } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { MAX_STEPS, solveGradually, stepsBetween } from './gradual';
import { loadPlanegcs } from './module';
import { SketchSolver } from './solver';

let solver: SketchSolver;
beforeAll(async () => {
  solver = new SketchSolver(await loadPlanegcs());
});
afterAll(() => solver?.dispose());

/**
 * A fixed edge along y = 60 (as a projected edge is held) and a free
 * horizontal line 3 mm below it: the inside of a box wall.
 */
function wall() {
  const b = new SketchBuilder();
  const edge = b.line(0, 60, 80, 60);
  b.constrain({ type: 'fix', entity: edge.id });
  const inner = b.line(3, 57, 77, 57);
  b.constrain({ type: 'horizontal', a: inner.id });
  const d = b.dimension({ type: 'distance', orientation: 'aligned', a: inner.id, b: edge.id }, 3);
  return { b, edge, inner, d };
}

/** `data` with points moved. */
function moved(data: SketchData, points: Record<string, { x: number; y: number }>): SketchData {
  const entities = { ...data.entities } as Record<string, unknown>;
  for (const [id, p] of Object.entries(points)) {
    entities[id] = { ...(entities[id] as object), ...p };
  }
  return { ...data, entities } as SketchData;
}

describe('stepsBetween', () => {
  it('is one step for small changes and grows with the move against the smallest size', () => {
    const { b, edge } = wall();
    const from = b.sketch;
    expect(stepsBetween(from, from, b.values, b.values)).toBe(1);
    const near = moved(from, { [edge.start]: { x: 0, y: 59 }, [edge.end]: { x: 80, y: 59 } });
    expect(stepsBetween(from, near, b.values, b.values)).toBe(1);
    // 30 mm against 3 mm walls: 30 / 3 / 0.5.
    const far = moved(from, { [edge.start]: { x: 0, y: 30 }, [edge.end]: { x: 80, y: 30 } });
    expect(stepsBetween(from, far, b.values, b.values)).toBe(20);
    const away = moved(from, { [edge.start]: { x: 0, y: 1e6 }, [edge.end]: { x: 80, y: 1e6 } });
    expect(stepsBetween(from, away, b.values, b.values)).toBe(MAX_STEPS);
  });

  it('counts dimension values: lengths against the smallest size, angles in 30° steps', () => {
    const { b, d } = wall();
    expect(stepsBetween(b.sketch, b.sketch, b.values, { [d]: 3.5 })).toBe(1);
    expect(stepsBetween(b.sketch, b.sketch, b.values, { [d]: 30 })).toBe(18);
  });
});

describe('solveGradually', () => {
  it('keeps a line on its side of a fixed edge that moves far past it', () => {
    const { b, edge, inner, d } = wall();
    const from = b.sketch;
    const to = moved(from, { [edge.start]: { x: 0, y: 30 }, [edge.end]: { x: 80, y: 30 } });
    const values = { [d]: 3 };

    // In one solve the line lands on the far side of the edge (y = 33) ...
    const direct = solver.solve(to, values);
    expect(direct.ok).toBe(true);
    expect(direct.solution.points[inner.end]?.y).toBeCloseTo(33, 6);

    // ... in steps it stays inside (y = 27), and the fixed edge ends where `to` has it.
    const stepped = solveGradually(solver, from, to, values, values);
    expect(stepped.ok).toBe(true);
    expect(stepped.solution.points[inner.end]?.y).toBeCloseTo(27, 6);
    expect(stepped.solution.points[edge.start]?.y ?? 30).toBeCloseTo(30, 6);
  });

  it('follows a dimension value that changes a lot without flipping', () => {
    const { b, inner, d } = wall();
    // 3 mm -> 40 mm from the edge: the line moves down, as a drag would take it.
    const result = solveGradually(solver, b.sketch, b.sketch, { [d]: 3 }, { [d]: 40 });
    expect(result.ok).toBe(true);
    expect(result.solution.points[inner.end]?.y).toBeCloseTo(20, 6);
  });

  it('is a plain solve when the change is small', () => {
    const { b, inner, d } = wall();
    const result = solveGradually(solver, b.sketch, b.sketch, { [d]: 3 }, { [d]: 4 });
    expect(result.solution.points[inner.end]?.y).toBeCloseTo(56, 6);
  });
});
