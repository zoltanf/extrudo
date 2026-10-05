// The re-solve rule of ADR-0016 as one shared function (`settleSketches`,
// ADR-0069 §2): the app's tool host and the headless CLI both call it, so this
// tests what a parameter change does to a sketch's geometry — including the
// case a stale shape would hide: a sketch whose stored geometry no longer
// satisfies its own constraints because something else moved it.
import {
  applyCommand,
  createDocument,
  type DimensionId,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  insertFeature,
  measureDimension,
  readSketch,
  type SketchData,
  type SketchEntityId,
  setSketchGeometry,
  sketchInputs,
  updateSketchDimension,
} from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import type { DimensionValues } from '../solver/mapping';
import { loadPlanegcs, type PlanegcsModule } from '../solver/module';
import { SketchSolver, type SolveResult } from '../solver/solver';
import { type SketchSettleChange, SketchSettleError, settleSketches } from './settle';

/**
 * A solver that counts the solves it was asked for. `'changed'` must not reach
 * the solver at all for a sketch a change doesn't move: the app calls this on
 * every step of a customizer slider drag, so a solve there is a real cost.
 * `dispose` frees systems, not the module, so it shares the loaded WASM.
 */
class CountingSolver extends SketchSolver {
  solves = 0;
  override solve(sketch: SketchData, values?: DimensionValues): SolveResult {
    this.solves += 1;
    return super.solve(sketch, values);
  }
}

let module: PlanegcsModule;
let solver: SketchSolver;
beforeAll(async () => {
  module = await loadPlanegcs();
  solver = new SketchSolver(module);
});
afterAll(() => solver.dispose());

/**
 * A document with one sketch on the XY plane: a rectangle of 20 x 10 mm whose
 * sides are horizontal and vertical and whose width and height are driving
 * dimensions named `width` and `height` (so a parameter of that name drives
 * them, ADR-0016).
 */
function rectangleDocument(): { doc: ExtrudoDocument; sketch: Feature; corners: string[] } {
  const b = new SketchBuilder();
  const at = (point: string) => point as SketchEntityId;
  const bottomLeft = at(b.point(0, 0));
  const bottomRight = at(b.point(20, 0));
  const topRight = at(b.point(20, 10));
  const topLeft = at(b.point(0, 10));
  const line = (from: SketchEntityId, to: SketchEntityId): SketchEntityId => {
    const id = b.id('l') as SketchEntityId;
    b.entities[id] = { type: 'line', start: from, end: to, construction: false };
    return id;
  };
  const bottom = line(bottomLeft, bottomRight);
  const right = line(bottomRight, topRight);
  const top = line(topRight, topLeft);
  const left = line(topLeft, bottomLeft);
  b.constrain({ type: 'horizontal', a: bottom });
  b.constrain({ type: 'horizontal', a: top });
  b.constrain({ type: 'vertical', a: left });
  b.constrain({ type: 'vertical', a: right });
  const width = b.dimension(
    { type: 'distance', orientation: 'horizontal', a: bottomLeft, b: bottomRight },
    20,
  );
  // A named driving dimension: its own expression is the value, its parameter
  // name is the label expressions use (ADR-0016).
  const name = (dimension: string, parameter: string) => {
    const found = b.dimensions[dimension as DimensionId];
    if (!found) throw new Error(`no dimension ${dimension}`);
    found.paramName = parameter;
  };
  name(width, 'width');
  const height = b.dimension(
    { type: 'distance', orientation: 'vertical', a: bottomLeft, b: topRight },
    10,
  );
  name(height, 'height');

  const data: SketchData = {
    entities: b.entities,
    constraints: b.constraints,
    dimensions: b.dimensions,
  };
  const feature: Feature = {
    id: 'f1' as FeatureId,
    type: 'sketch',
    name: 'Sketch1',
    suppressed: false,
    inputs: sketchInputs({ kind: 'plane', id: 'origin:xy' }, data),
  };
  const doc = applyCommand(createDocument({ name: 'Settle' }), insertFeature({ feature })).doc;
  return { doc, sketch: feature, corners: [bottomRight, topRight, topLeft] };
}

/**
 * The `width` of `doc` set to `expression`. It is a driving dimension's own
 * parameter, so this is the app's dimension command (ADR-0016).
 */
function withWidth(doc: ExtrudoDocument, expression: string): ExtrudoDocument {
  const feature = doc.features[0] as Feature | undefined;
  const data = feature && readSketch(feature)?.data;
  const dimension = Object.entries(data?.dimensions ?? {}).find(([, d]) => d.paramName === 'width');
  if (!dimension) throw new Error('no width dimension');
  return applyCommand(
    doc,
    updateSketchDimension({
      feature: 'f1' as FeatureId,
      id: dimension[0] as DimensionId,
      changes: { expr: expression },
      points: {},
      radii: {},
    }),
  ).doc;
}

/**
 * The document with every change stored (`setSketchGeometry`, what the app's
 * host and the CLI dispatch): what the design looks like afterwards.
 */
function apply(doc: ExtrudoDocument, changes: SketchSettleChange[]): ExtrudoDocument {
  let next = doc;
  for (const change of changes) {
    next = applyCommand(
      next,
      setSketchGeometry({
        feature: change.feature,
        points: change.points,
        radii: change.radii,
      }),
    ).doc;
  }
  return next;
}

/** What the sketch's own dimensions measure where they are stored, in mm. */
function measured(doc: ExtrudoDocument): Record<string, number | undefined> {
  const feature = doc.features[0] as Feature | undefined;
  const data = feature && readSketch(feature)?.data;
  const out: Record<string, number | undefined> = {};
  for (const [key, dimension] of Object.entries(data?.dimensions ?? {})) {
    out[dimension.paramName ?? key] = measureDimension(data as SketchData, dimension);
  }
  return out;
}

/** The points of the sketch as they are stored, by point ID. */
function pointsOf(doc: ExtrudoDocument): Record<string, { x: number; y: number }> {
  const feature = doc.features[0] as Feature | undefined;
  const data = feature && readSketch(feature)?.data;
  const out: Record<string, { x: number; y: number }> = {};
  for (const [key, entity] of Object.entries(data?.entities ?? {})) {
    if (entity.type === 'point') out[key] = { x: entity.x, y: entity.y };
  }
  return out;
}

/**
 * `doc` with one corner moved by hand 5 mm to the right: the sketch's own
 * dimension values are exactly as they were, so nothing says "re-solve me", and
 * the stored shape no longer holds the width its dimension asks for. This is
 * what the two scopes differ about.
 */
function outOfShape(doc: ExtrudoDocument): ExtrudoDocument {
  const corner = Object.entries(pointsOf(doc)).find(([, p]) => p.x === 20)?.[0];
  if (!corner) throw new Error('no corner at 20 mm');
  return applyCommand(
    doc,
    setSketchGeometry({
      feature: 'f1' as FeatureId,
      points: { [corner]: { x: 25, y: 0 } },
      radii: {},
    }),
  ).doc;
}

describe('settleSketches', () => {
  it('solves the sketch whose dimension values changed, and returns what moved', () => {
    const { doc } = rectangleDocument();
    const after = withWidth(doc, '40 mm');
    const changes = settleSketches({ solver, before: doc, after });
    expect(changes.map((change) => [change.feature, change.name])).toEqual([['f1', 'Sketch1']]);
    expect(Object.keys(changes[0]?.points ?? {}).length).toBeGreaterThan(0);
    expect(changes[0]?.radii).toEqual({});
    // Stored, the rectangle is 40 x 10 mm: the width followed, the height
    // stayed (the rectangle floats, so the solver may have moved it sideways).
    expect(measured(apply(after, changes))).toEqual({ width: 40, height: 10 });
  });

  it('moves nothing when nothing changed', () => {
    const { doc } = rectangleDocument();
    expect(settleSketches({ solver, before: doc, after: doc })).toEqual([]);
    expect(settleSketches({ solver, before: doc, after: doc, scope: 'all' })).toEqual([]);
  });

  it("leaves a sketch the change didn't move alone, without solving it ('changed')", () => {
    // The app's default: the store's geometry comes out as it went in, so an
    // unrelated parameter change can't put a geometry move in its undo step,
    // and a slider drag (ADR-0059) costs no solves at all.
    const { doc } = rectangleDocument();
    const moved = outOfShape(doc);
    expect(measured(moved).width).not.toBe(20);
    const counting = new CountingSolver(module);
    try {
      const changes = settleSketches({ solver: counting, before: doc, after: moved });
      expect(counting.solves).toBe(0);
      expect(changes).toEqual([]);
    } finally {
      counting.dispose();
    }
  });

  it("repairs a sketch whose stored geometry no longer satisfies its own constraints ('all')", () => {
    // A corner moved by hand (a projection sync, another tool, a script) is
    // what the CLI must not export stale: it asks for every sketch to be
    // solved, whatever its values did.
    const { doc } = rectangleDocument();
    const moved = outOfShape(doc);
    const changes = settleSketches({ solver, before: doc, after: moved, scope: 'all' });
    expect(changes.map((change) => change.name)).toEqual(['Sketch1']);
    // Stored, the width holds again: the shape is never left stale.
    expect(measured(apply(moved, changes))).toEqual({ width: 20, height: 10 });
  });

  it("refuses a change a sketch cannot take, in the app's words", () => {
    const { doc } = rectangleDocument();
    const after = withWidth(doc, '0 mm');
    expect(() => settleSketches({ solver, before: doc, after })).toThrow(SketchSettleError);
    expect(() => settleSketches({ solver, before: doc, after })).toThrow(
      "Sketch1 can't take that: its other constraints and dimensions don't allow it.",
    );
  });
});
