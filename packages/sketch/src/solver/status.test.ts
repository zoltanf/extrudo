import { SketchDataSchema } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { loadPlanegcs, type PlanegcsModule } from './module';
import { applySolution, SketchSolver } from './solver';
import { sketchStatus, unmetDimensions } from './status';

let module: PlanegcsModule;
let solver: SketchSolver;
beforeAll(async () => {
  module = await loadPlanegcs();
  solver = new SketchSolver(module);
});
afterAll(() => solver.dispose());

const status = (b: SketchBuilder) => {
  const sketch = SketchDataSchema.parse(b.sketch);
  const result = solver.solve(sketch, b.values);
  return sketchStatus(applySolution(sketch, result.solution), result, b.values);
};

describe('sketchStatus', () => {
  it('reports a lone line as free', () => {
    const b = new SketchBuilder();
    const l = b.line(0, 0, 10, 0);
    const s = status(b);
    expect(s.dof).toBe(4);
    expect(s.entities).toEqual({ [l.start]: 'free', [l.end]: 'free', [l.id]: 'free' });
    expect(s.over).toEqual([]);
  });

  it('tells the fixed end of a line from the free one', () => {
    const b = new SketchBuilder();
    const l = b.line(0, 0, 10, 0);
    b.constrain({ type: 'fix', entity: l.start });
    b.constrain({ type: 'horizontal', a: l.id });
    const s = status(b);
    expect(s.dof).toBe(1);
    expect(s.entities[l.start]).toBe('fixed');
    expect(s.entities[l.end]).toBe('free');
    expect(s.entities[l.id]).toBe('free');
  });

  it('reports a fully constrained line as fixed', () => {
    const b = new SketchBuilder();
    const l = b.line(0, 0, 10, 0);
    b.constrain({ type: 'fix', entity: l.start });
    b.constrain({ type: 'horizontal', a: l.id });
    b.dimension({ type: 'distance', orientation: 'aligned', a: l.id }, 12);
    const s = status(b);
    expect(s.dof).toBe(0);
    expect(Object.values(s.entities)).toEqual(['fixed', 'fixed', 'fixed']);
  });

  it('colours each part of a partly constrained rectangle on its own', () => {
    // Fixed corner, horizontal and vertical sides, a width but no height:
    // the bottom side is fully placed, the top one can still slide up and down.
    const b = new SketchBuilder();
    const bottom = b.line(0, 0, 50, 0);
    const right = b.line(50, 0, 50, 30);
    const top = b.line(50, 30, 0, 30);
    const left = b.line(0, 30, 0, 0);
    for (const [p, q] of [
      [bottom.end, right.start],
      [right.end, top.start],
      [top.end, left.start],
      [left.end, bottom.start],
    ] as const) {
      b.constrain({ type: 'coincident', a: p, b: q });
    }
    b.constrain({ type: 'horizontal', a: bottom.id });
    b.constrain({ type: 'horizontal', a: top.id });
    b.constrain({ type: 'vertical', a: left.id });
    b.constrain({ type: 'vertical', a: right.id });
    b.constrain({ type: 'fix', entity: bottom.start });
    b.dimension({ type: 'distance', orientation: 'aligned', a: bottom.id }, 50);
    const s = status(b);
    expect(s.dof).toBe(1);
    expect(s.entities[bottom.id]).toBe('fixed');
    expect(s.entities[bottom.end]).toBe('fixed');
    expect(s.entities[right.start]).toBe('fixed');
    expect(s.entities[top.id]).toBe('free');
    expect(s.entities[right.id]).toBe('free');
    expect(s.entities[left.id]).toBe('free');
  });

  it('covers circles, arcs and ellipses', () => {
    const b = new SketchBuilder();
    const c = b.circle(0, 0, 5);
    b.constrain({ type: 'fix', entity: c.center });
    const a = b.arc(20, 0, 5, 0, 90);
    b.constrain({ type: 'fix', entity: a.center });
    b.constrain({ type: 'fix', entity: a.start });
    const e = b.ellipse(40, 0, 8, 4);
    b.constrain({ type: 'fix', entity: e.center });
    b.constrain({ type: 'fix', entity: e.major });
    let s = status(b);
    // A fixed center leaves a circle's radius free; an arc can still sweep; an
    // ellipse's minor axis can still grow.
    expect(s.entities[c.center]).toBe('fixed');
    expect(s.entities[c.id]).toBe('free');
    expect(s.entities[a.end]).toBe('free');
    expect(s.entities[a.id]).toBe('free');
    expect(s.entities[e.minor]).toBe('free');
    expect(s.entities[e.id]).toBe('free');

    b.dimension({ type: 'radius', curve: c.id }, 5);
    b.constrain({ type: 'fix', entity: a.end });
    b.constrain({ type: 'fix', entity: e.minor });
    s = status(b);
    expect(s.entities[c.id]).toBe('fixed');
    expect(s.entities[a.id]).toBe('fixed');
    expect(s.entities[e.id]).toBe('fixed');
  });

  it('marks what conflicting or redundant constraints touch', () => {
    const b = new SketchBuilder();
    const l = b.line(0, 0, 10, 0);
    b.constrain({ type: 'fix', entity: l.start });
    b.constrain({ type: 'horizontal', a: l.id });
    const d1 = b.dimension({ type: 'distance', orientation: 'aligned', a: l.id }, 10);
    const d2 = b.dimension(
      { type: 'distance', orientation: 'horizontal', a: l.start, b: l.end },
      10,
    );
    const free = b.line(0, 20, 10, 20);
    const s = status(b);
    expect(s.over.length).toBeGreaterThan(0);
    expect(s.over.every((id) => [d1, d2].includes(id))).toBe(true);
    expect(s.entities[l.id]).toBe('conflict');
    expect(s.entities[free.id]).toBe('free');
  });

  it('marks contradicting values (planegcs drops one as redundant)', () => {
    const b = new SketchBuilder();
    const l = b.line(0, 0, 10, 0);
    b.constrain({ type: 'fix', entity: l.start });
    b.constrain({ type: 'horizontal', a: l.id });
    b.dimension({ type: 'distance', orientation: 'aligned', a: l.id }, 10);
    b.dimension({ type: 'distance', orientation: 'horizontal', a: l.start, b: l.end }, 20);
    const s = status(b);
    expect(s.over).toHaveLength(1);
    expect(s.entities[l.id]).toBe('conflict');
    expect(s.entities[l.end]).toBe('conflict');
  });

  it('leaves out constraints on fixed geometry alone, but not unmet dimensions there', () => {
    const b = new SketchBuilder();
    const l = b.line(0, 0, 10, 0);
    b.constrain({ type: 'horizontal', a: l.id });
    b.constrain({ type: 'fix', entity: l.id });
    let s = status(b);
    expect(s.over).toEqual([]);
    expect(Object.values(s.entities)).toEqual(['fixed', 'fixed', 'fixed']);

    const d = b.dimension({ type: 'distance', orientation: 'aligned', a: l.id }, 10);
    expect(status(b).over).toEqual([]);
    b.values[d] = 12;
    s = status(b);
    expect(s.over).toEqual([d]);
    expect(s.entities[l.id]).toBe('conflict');
  });
});

describe('unmetDimensions', () => {
  it('lists driving dimensions the geometry does not meet', () => {
    const b = new SketchBuilder();
    const l = b.line(0, 0, 10, 0);
    const c = b.circle(0, 20, 5);
    const d1 = b.dimension({ type: 'distance', orientation: 'aligned', a: l.id }, 10);
    const d2 = b.dimension({ type: 'diameter', curve: c.id }, 12);
    const sketch = SketchDataSchema.parse(b.sketch);
    expect(unmetDimensions(sketch, b.values)).toEqual([d2]);
    expect(unmetDimensions(sketch, b.values, [d1])).toEqual([]);
    expect(unmetDimensions(sketch, { ...b.values, [d1]: 10.00001 })).toEqual([d2]);
  });
});
