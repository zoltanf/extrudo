/**
 * One FreeCAD sketch object as one Extrudo sketch (ADR-0144 S4): placed from
 * its stored placement (`sketch-place.ts`), drawn and its constraints vetted
 * (`sketch-map.ts`). The import's timeline (S5) calls `addSketch` for each
 * sketch it needs, in document order (`sketchObjects`); IDs come from the
 * caller's `Design`, as the API makes them.
 *
 * A constraint bound to an expression keeps its stored number here; the
 * binding comes back in the outcome for the parameters slice (S10). A
 * constraint naming projected geometry is left out and counted (S9).
 * Nothing throws past `addSketch`: a sketch that can't come in returns why.
 */
import type { Design } from '@extrudo/api';
import { type FeatureId, parameterNames } from '@extrudo/core';
import type { SketchSolver } from '@extrudo/sketch';
import type { FcDocument, FcObject } from './model';
import { decodeSketch } from './sketch-decode';
import {
  type ConstraintOutcome,
  type LeftOut,
  mapSketch,
  type SketchMapResult,
  typeName,
} from './sketch-map';
import { NO_PLANE, type PlaneKind, placeSketch, sketchFrame } from './sketch-place';

/** A constraint whose value FreeCAD computes from an expression (for S10). */
export interface ExpressionBinding {
  /** The sketch object's name. */
  readonly sketch: string;
  /** The constraint's index in the sketch's list. */
  readonly index: number;
  /** The constraint's name (`''` when it has none). */
  readonly name: string;
  /** The bound path as stored (`.Constraints.width`, `Constraints[3]`). */
  readonly path: string;
  readonly expression: string;
  /** The Extrudo dimension that holds the constraint's stored value, when it was mapped to one. */
  readonly dimension?: string;
}

export interface SketchOutcome {
  /** The sketch object's name and label. */
  readonly sketch: string;
  readonly label: string;
  /** The Extrudo plane it took; `undefined` when not placed. */
  readonly plane?: PlaneKind;
  readonly mirrored?: boolean;
  /** How FreeCAD's sketch axes land on the plane's (see `SketchPlacement.axes`). */
  readonly axes?: 'same' | 'swap' | 'rotated';
  /** Containers that move what they hold, and whether one of them moves it (a body or part away from the origin). */
  readonly containers: number;
  readonly movedContainer: boolean;
  /** Curves drawn, by kind (`construction` counts those that are). */
  readonly drawn: Readonly<Record<string, number>>;
  /** FreeCAD curves left out, by why. */
  readonly geometryLeftOut: Readonly<Record<string, number>>;
  readonly constraints: {
    readonly total: number;
    readonly mapped: number;
    /** Left out, by why. */
    readonly leftOut: Readonly<Partial<Record<LeftOut, number>>>;
    /** Per FreeCAD constraint type: mapped, and left out by why. */
    readonly byType: Readonly<
      Record<string, { mapped: number; leftOut: Partial<Record<LeftOut, number>> }>
    >;
  };
  /** One outcome per FreeCAD constraint, in the file's order. */
  readonly perConstraint: readonly ConstraintOutcome[];
  /** The largest displacement the final solve caused (mm): nothing kept moves more than 1e-6. */
  readonly maxDisplacement: number;
  /** Degrees of freedom left, when a solver vetted the sketch. */
  readonly dof?: number;
  readonly bindings: readonly ExpressionBinding[];
  /** What couldn't be read, one line each. */
  readonly problems: readonly string[];
}

export type AddSketchResult =
  | { readonly imported: true; readonly id: FeatureId; readonly outcome: SketchOutcome }
  | { readonly imported: false; readonly reason: string; readonly outcome: SketchOutcome };

export interface AddSketchOptions {
  /** Vets the constraints (planegcs, which the caller loads); without one no constraint is imported. */
  readonly solver?: SketchSolver;
  /** The Extrudo sketch's name; the object's label by default. */
  readonly name?: string;
}

/** The document's sketch objects, in document order. */
export function sketchObjects(doc: FcDocument): FcObject[] {
  return doc.objects.filter((o) => o.type.startsWith('Sketcher::SketchObject'));
}

const CONSTRAINT_PATH = /^\.?Constraints(?:\.(.+)|\[(\d{1,9})\])$/;

/** The sketch's expressions bound to its constraints, by constraint index. */
function bindingsOf(
  object: FcObject,
  names: readonly (string | undefined)[],
): Map<number, { path: string; expression: string }> {
  const byName = new Map<string, number>();
  names.forEach((n, i) => {
    if (n && !byName.has(n)) byName.set(n, i);
  });
  const out = new Map<number, { path: string; expression: string }>();
  for (const e of object.expressions) {
    const m = CONSTRAINT_PATH.exec(e.path);
    if (!m) continue;
    const index = m[1] !== undefined ? byName.get(m[1]) : Number(m[2]);
    if (index === undefined || index >= names.length) continue;
    out.set(index, { path: e.path, expression: e.expression });
  }
  return out;
}

function tally(
  object: FcObject,
  names: readonly (string | undefined)[],
  types: readonly (number | undefined)[],
  mapped: SketchMapResult | undefined,
  rest: Partial<SketchOutcome> & Pick<SketchOutcome, 'containers' | 'movedContainer' | 'problems'>,
  all: LeftOut | undefined,
): SketchOutcome {
  const perConstraint: ConstraintOutcome[] =
    mapped?.constraints.slice() ?? names.map(() => all ?? 'unreadable');
  const leftOut: Partial<Record<LeftOut, number>> = {};
  const byType: Record<string, { mapped: number; leftOut: Partial<Record<LeftOut, number>> }> = {};
  let count = 0;
  perConstraint.forEach((o, i) => {
    const t = types[i] === undefined ? 'Unreadable' : typeName(types[i] as number);
    const entry = byType[t] ?? { mapped: 0, leftOut: {} };
    byType[t] = entry;
    if (o === 'mapped') {
      count++;
      entry.mapped++;
    } else {
      leftOut[o] = (leftOut[o] ?? 0) + 1;
      entry.leftOut[o] = (entry.leftOut[o] ?? 0) + 1;
    }
  });
  const bindings: ExpressionBinding[] = [];
  for (const [index, b] of [...bindingsOf(object, names)].sort((x, y) => x[0] - y[0])) {
    const dimension = mapped?.dimensions[index];
    bindings.push({
      sketch: object.name,
      index,
      name: names[index] ?? '',
      path: b.path,
      expression: b.expression,
      ...(dimension ? { dimension } : {}),
    });
  }
  const outcome = rest;
  return {
    sketch: object.name,
    label: object.label,
    drawn: mapped?.drawn ?? {},
    geometryLeftOut: mapped?.geometryLeftOut ?? {},
    maxDisplacement: mapped?.maxDisplacement ?? 0,
    ...(mapped?.dof !== undefined ? { dof: mapped.dof } : {}),
    ...outcome,
    constraints: { total: perConstraint.length, mapped: count, leftOut, byType },
    perConstraint,
    bindings,
  };
}

/**
 * Adds one FreeCAD sketch object to `design`: placed, drawn and vetted.
 * Returns the new sketch's ID, or why it was not imported, with the outcome
 * either way. Never throws for anything the file holds.
 */
export function addSketch(
  design: Design,
  doc: FcDocument,
  object: FcObject,
  options: AddSketchOptions = {},
): AddSketchResult {
  const decoded = decodeSketch(object);
  const problems = [...decoded.problems];
  const names = decoded.constraints.map((c) => c?.name);
  const types = decoded.constraints.map((c) => c?.type);
  const frame = sketchFrame(doc, object);
  const base = { containers: frame.containers, movedContainer: frame.moved, problems };
  const refuse = (reason: string, all: LeftOut) => ({
    imported: false as const,
    reason,
    outcome: tally(object, names, types, undefined, base, all),
  });
  if (decoded.overLimit) return refuse(`it has ${decoded.overLimit}`, 'limit');
  let placement: ReturnType<typeof placeSketch>;
  try {
    placement = placeSketch(design, frame.global, options.name ?? object.label);
  } catch (error) {
    return refuse(`its plane could not be made: ${(error as Error).message}`, 'failed');
  }
  if (!placement) return refuse(NO_PLANE, 'geometry');
  const where = placement;
  const placed = {
    ...base,
    plane: where.kind,
    mirrored: where.mirrored,
    axes: where.axes,
  };
  let mapped: SketchMapResult | undefined;
  try {
    const taken = parameterNames(design.doc);
    const handle = design.sketch(
      where.plane,
      (k) => {
        mapped = mapSketch(k, decoded, where, {
          taken,
          ...(options.solver ? { solver: options.solver } : {}),
        });
      },
      { name: options.name ?? object.label },
    );
    return {
      imported: true,
      id: handle.id,
      outcome: tally(object, names, types, mapped, placed, undefined),
    };
  } catch (error) {
    return {
      imported: false,
      reason: `the sketch was refused: ${(error as Error).message}`,
      outcome: tally(object, names, types, undefined, placed, 'failed'),
    };
  }
}
