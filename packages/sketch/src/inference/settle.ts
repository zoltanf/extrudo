/**
 * Re-solving sketches after a document change that moves their geometry
 * (ADR-0016, ADR-0031 §Project, ADR-0050): a driving dimension's value, a
 * parameter a dimension reads, another dimension that follows from it.
 *
 * **The rule, in one place, so the app and the CLI do the same thing:** for
 * every sketch whose driving dimension values differ from the document
 * before the change, solve it (in steps from the old state when the change is
 * large, `solveGradually`) and report the points and radii that moved. The
 * caller stores them (`setSketchGeometry`), which is the command that makes
 * the geometry part of the change — one undo step in the app, the same for
 * `extrudo set`. `scope` decides whether a sketch the change doesn't move is
 * solved too: the app keeps `'changed'`, the headless CLI asks for `'all'` so
 * no export holds a stale shape (ADR-0069).
 *
 * A change a sketch can't take is refused with a message for the user rather
 * than left half applied: a solve that fails where the old one worked, a
 * curve collapsed to nothing (planegcs satisfies some contradictions that
 * way), a dimension that would over-constrain the sketch, or a value the solve
 * doesn't reach (planegcs can report success while leaving a redundant
 * dimension out). `SketchSettleError` carries the message.
 *
 * Pure: the solver comes in as an argument, so this file never loads planegcs
 * (the app's tool host and the CLI both call it).
 */
import {
  DIMENSION_LABELS,
  type DimensionId,
  dimensionUnit,
  type ExtrudoDocument,
  evaluateParameters,
  type FeatureId,
  type ParameterEvaluation,
  readSketch,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
} from '@extrudo/core';
import { solveGradually } from '../solver/gradual';
import type { SketchSolution, SketchSolver } from '../solver/solver';
import { unmetDimensions } from '../solver/status';

/** A sketch that can't take the change, with the message to show for it. */
export class SketchSettleError extends Error {
  override name = 'SketchSettleError';
}

/** Where a sketch's solved geometry goes: `setSketchGeometry`'s payload. */
export interface SketchSettleChange {
  feature: FeatureId;
  /** The sketch's name, for the message. */
  name: string;
  points: Record<SketchEntityId, { x: number; y: number }>;
  radii: Record<SketchEntityId, number>;
}

/**
 * The values of a sketch's driving dimensions for the solver: mm for lengths,
 * degrees for angles. They come from the parameter graph
 * (`evaluation.dimensions`, so `d1` and cycles resolve as everywhere else); a
 * dimension the document doesn't have yet (one being added) is evaluated on
 * its own. Driven dimensions and those whose expression doesn't evaluate are
 * left out (the solver then skips them).
 */
export function dimensionValues(
  data: SketchData,
  evaluation: Pick<ParameterEvaluation, 'dimensions' | 'evaluate'>,
  feature?: FeatureId,
): Record<string, number> {
  const known = feature === undefined ? undefined : evaluation.dimensions.get(feature);
  const values: Record<string, number> = {};
  for (const [id, d] of Object.entries(data.dimensions)) {
    if (d.driven) continue;
    const result = known?.get(id) ?? evaluation.evaluate(d.expr, dimensionUnit(d));
    if (result.ok) values[id] = result.value;
  }
  return values;
}

function sameValues(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** Below this size (mm) a curve has collapsed: a solve that shrinks one this far failed in all but name. */
const COLLAPSED = 1e-3;

/**
 * Whether solving shrinks a line, circle, arc or ellipse of `before` to
 * almost nothing. planegcs satisfies some contradictions that way (two
 * horizontal lines made perpendicular become two dots) and reports success;
 * a change the user asked for that does this is refused as a conflict.
 */
export function collapses(before: SketchData, solution: SketchSolution): boolean {
  const after: SketchData = { ...before, entities: { ...before.entities } };
  const entities = after.entities as Record<string, SketchEntity>;
  for (const [id, p] of Object.entries(solution.points)) {
    const e = entities[id];
    if (e?.type === 'point') entities[id] = { ...e, x: p.x, y: p.y };
  }
  for (const [id, radius] of Object.entries(solution.radii)) {
    const e = entities[id];
    if (e?.type === 'circle') entities[id] = { ...e, radius };
  }
  const size = (data: SketchData, e: SketchEntity): number | undefined => {
    const at = (ref: SketchEntityId) => {
      const p = data.entities[ref];
      return p?.type === 'point' ? p : undefined;
    };
    const span = (a: SketchEntityId, b: SketchEntityId) => {
      const p = at(a);
      const q = at(b);
      return p && q ? Math.hypot(q.x - p.x, q.y - p.y) : undefined;
    };
    switch (e.type) {
      case 'line':
        return span(e.start, e.end);
      case 'circle':
        return e.radius;
      case 'arc':
        return span(e.center, e.start);
      case 'ellipse':
        return span(e.center, e.minor);
      default:
        return undefined;
    }
  };
  for (const [id, e] of Object.entries(before.entities)) {
    const was = size(before, e);
    const now = size(after, entities[id] ?? e);
    if (was !== undefined && now !== undefined && was >= COLLAPSED && now < COLLAPSED) return true;
  }
  return false;
}

/** `data` with a solution's points and radii applied (what the change stores). */
function solved(data: SketchData, solution: SketchSolution): SketchData {
  const entities = { ...data.entities } as Record<string, SketchEntity>;
  for (const [id, p] of Object.entries(solution.points)) {
    const e = entities[id];
    if (e?.type === 'point') entities[id] = { ...e, x: p.x, y: p.y };
  }
  for (const [id, radius] of Object.entries(solution.radii)) {
    const e = entities[id];
    if (e?.type === 'circle') entities[id] = { ...e, radius };
  }
  return { ...data, entities } as SketchData;
}

/**
 * Below this (mm, or mm of radius) a solve's movement is the solver's own
 * arithmetic, not a change: a sketch solved twice from the same state solves to
 * the same numbers, and storing a nanometre of drift in the document would put
 * a no-op in every undo step.
 */
const MOVED = 1e-9;

/** What moved between `data` and its solution, as `setSketchGeometry` takes it. */
function moved(
  data: SketchData,
  solution: SketchSolution,
): Pick<SketchSettleChange, 'points' | 'radii'> {
  const points: Record<SketchEntityId, { x: number; y: number }> = {};
  const radii: Record<SketchEntityId, number> = {};
  for (const [key, p] of Object.entries(solution.points)) {
    const id = key as SketchEntityId;
    const e = data.entities[id];
    if (e?.type === 'point' && (Math.abs(e.x - p.x) > MOVED || Math.abs(e.y - p.y) > MOVED)) {
      points[id] = { x: p.x, y: p.y };
    }
  }
  for (const [key, radius] of Object.entries(solution.radii)) {
    const id = key as SketchEntityId;
    const e = data.entities[id];
    if (e?.type === 'circle' && Math.abs(e.radius - radius) > MOVED) radii[id] = radius;
  }
  return { points, radii };
}

/**
 * Which sketches to solve, and what to do with one whose own dimension values
 * didn't move:
 *
 * - **`'changed'`** (the default, the app's rule): a sketch whose values are the
 *   same as `before` is left alone without a solve. This runs on every
 *   parameter write, every dimension edit and every step of a customizer
 *   slider drag (ADR-0016, ADR-0059), so it costs a solve only in the sketches
 *   a change actually moves — and an unrelated parameter can't store geometry
 *   moves in its undo step.
 * - **`'all'`** (the headless CLI, ADR-0069): every sketch is solved and what
 *   moved is stored, so a sketch something else pulled out of shape — a
 *   projection sync, a script, another sketch's geometry — is repaired rather
 *   than exported stale. A sketch whose values didn't change is never *refused*
 *   over what its solve says in either scope.
 */
export type SettleScope = 'changed' | 'all';

/**
 * Solves the sketches of `after` that `scope` asks for and returns the ones
 * whose geometry moved, in timeline order. Throws a `SketchSettleError` for
 * the first sketch whose own dimension values changed and that can't take the
 * change.
 *
 * A sketch whose driving dimension values differ from `before` is solved in
 * steps when they move far (`solveGradually`), and a solve that fails where it
 * worked before, a curve that collapses, a dimension that would over-constrain
 * the sketch or a value the solve doesn't reach refuses the change. Under
 * `'all'` a sketch whose values didn't change is solved too: nothing is refused
 * for it (what the solve says was true before the change too), and a solve that
 * fails stores nothing — but what it *can* do is stored, so no export ever holds
 * a stale shape (ADR-0069).
 *
 * `before` is the document as it was before the change was stored, `after` the
 * document with it: the same command the caller has dispatched, or is about
 * to, holds every sketch except the one being solved.
 */
export function settleSketches(options: {
  solver: SketchSolver;
  before: ExtrudoDocument;
  after: ExtrudoDocument;
  scope?: SettleScope;
}): SketchSettleChange[] {
  const { solver, before, after, scope = 'changed' } = options;
  const was = evaluateParameters(before);
  const now = evaluateParameters(after);
  const changes: SketchSettleChange[] = [];
  for (const feature of after.features) {
    const view = readSketch(feature);
    if (!view) continue;
    const old = before.features.find((f) => f.id === feature.id);
    const oldView = old && readSketch(old);
    const values = dimensionValues(view.data, now, feature.id);
    const oldValues = oldView ? dimensionValues(oldView.data, was, feature.id) : {};
    // Whether this sketch's own dimensions are what moved.
    const driven = !oldView || !sameValues(values, oldValues);
    // The app's rule: a sketch this change doesn't move isn't solved at all
    // (a slider drag runs this on every step), so no unrelated geometry move
    // can reach the undo step.
    if (!driven && scope === 'changed') continue;
    // In steps from the old values when they change a lot (P3-13), so a line
    // held at a distance doesn't jump to the other side of its edge. With the
    // values as they were this is one plain solve.
    const result = oldView
      ? solveGradually(solver, oldView.data, view.data, oldValues, values)
      : solver.solve(view.data, values);
    const refused = () =>
      new SketchSettleError(
        `${feature.name} can't take that: its other constraints and dimensions don't allow it.`,
      );
    if (driven) {
      const unsolved = () => !oldView || solver.solve(oldView.data, oldValues).ok;
      if ((!result.ok && unsolved()) || collapses(view.data, result.solution)) throw refused();
      // A dimension that starts driving must not over-constrain the sketch (P1-08).
      for (const id of Object.keys(values)) {
        if (id in oldValues || !(oldView?.data.dimensions[id as DimensionId]?.driven ?? false)) {
          continue;
        }
        if (!solver.check(view.data, values, id).accepted) {
          const d = view.data.dimensions[id as DimensionId];
          throw new SketchSettleError(
            `${d ? DIMENSION_LABELS[d.type] : 'That dimension'} would over-constrain the sketch, so it stays driven.`,
          );
        }
      }
      // planegcs can succeed by leaving a redundant dimension out: the new
      // values must hold in the geometry the change stores.
      const changed = Object.keys(values).filter((id) => values[id] !== oldValues[id]);
      if (unmetDimensions(solved(view.data, result.solution), values, changed).length > 0) {
        throw refused();
      }
    } else if (!result.ok || collapses(view.data, result.solution)) {
      // Only reachable under `'all'`: its values are as they were, so a solve
      // that fails here was failing before this change: nothing to store and
      // nothing to refuse.
      continue;
    }
    const geometry = moved(view.data, result.solution);
    if (Object.keys(geometry.points).length > 0 || Object.keys(geometry.radii).length > 0) {
      changes.push({ feature: feature.id, name: feature.name, ...geometry });
    }
  }
  return changes;
}
