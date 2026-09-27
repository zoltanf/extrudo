/**
 * Constraint status per entity (P1-08, FR-SK-09): what the sketch colours
 * show. Pure: it reads a `SolveResult`, no WASM.
 */
import {
  constraintRefs,
  dimensionRefs,
  measureDimension,
  type SketchData,
  type SketchEntity,
} from '@extrudo/core';
import type { DimensionValues } from './mapping';
import type { SolveResult } from './solver';

/**
 * `free`: can still move (under-constrained, drawn blue). `fixed`: fully
 * constrained. `conflict`: touched by a conflicting or redundant constraint or
 * dimension, or in a component that doesn't solve (drawn red).
 */
export type EntityStatus = 'free' | 'fixed' | 'conflict';

export interface SketchStatus {
  /** Degrees of freedom left over the whole sketch. */
  dof: number;
  /** Every entity's status, by ID. */
  entities: Readonly<Record<string, EntityStatus>>;
  /**
   * What over-constrains the sketch: constraints and dimensions that conflict
   * or are redundant, and driving dimensions the geometry doesn't meet.
   */
  over: readonly string[];
}

/** How far (mm or degrees) a driving dimension may be off before it counts as unmet. */
export const DIMENSION_TOLERANCE = 1e-4;

/**
 * The driving dimensions (of `ids`, or all in `values`) whose measurement
 * differs from their value: geometry that is stored solved meets them all.
 * planegcs can report success while it leaves one out as redundant, and a
 * dimension on fixed geometry alone isn't solved at all.
 */
export function unmetDimensions(
  sketch: SketchData,
  values: DimensionValues,
  ids: readonly string[] = Object.keys(values),
): string[] {
  return ids.filter((id) => {
    const d = sketch.dimensions[id as keyof SketchData['dimensions']];
    const value = values[id];
    if (!d || d.driven || value === undefined) return false;
    const measured = measureDimension(sketch, d);
    return measured !== undefined && Math.abs(measured - value) > DIMENSION_TOLERANCE;
  });
}

const pointsOf = (e: SketchEntity): string[] => {
  switch (e.type) {
    case 'point':
      return [];
    case 'line':
      return [e.start, e.end];
    case 'circle':
      return [e.center];
    case 'arc':
      return [e.center, e.start, e.end];
    case 'ellipse':
      return [e.center, e.major, e.minor];
    case 'spline':
      return e.points;
  }
};

/**
 * The status of every entity of `sketch`, from the solver's result for it
 * with the driving dimension `values`. A curve takes the worst status of
 * itself and its points: a line with one fixed end can still swing, and one
 * whose end is over-constrained is red.
 *
 * Constraints on fixed geometry alone (the result's `redundant` has them) are
 * left out: they held when the geometry was fixed, and fixed geometry doesn't
 * move. Dimensions there count if their value isn't met.
 */
export function sketchStatus(
  sketch: SketchData,
  result: SolveResult,
  values: DimensionValues = {},
): SketchStatus {
  const free = new Set(result.free);
  const over = [
    ...new Set([
      ...result.components.flatMap((c) => [...c.conflicting, ...c.redundant]),
      ...unmetDimensions(sketch, values),
    ]),
  ];
  const conflict = new Set<string>();
  for (const id of over) {
    const c = sketch.constraints[id as keyof SketchData['constraints']];
    const d = sketch.dimensions[id as keyof SketchData['dimensions']];
    for (const ref of c ? constraintRefs(c) : d ? dimensionRefs(d) : []) conflict.add(ref);
  }
  for (const component of result.components) {
    if (!component.ok) for (const id of component.entities) conflict.add(id);
  }

  const entities: Record<string, EntityStatus> = {};
  for (const [id, e] of Object.entries(sketch.entities)) {
    const points = pointsOf(e);
    if (conflict.has(id) || points.some((p) => conflict.has(p))) entities[id] = 'conflict';
    else if (free.has(id) || points.some((p) => free.has(p))) entities[id] = 'free';
    else entities[id] = 'fixed';
  }
  return { dof: result.dof, entities, over };
}
