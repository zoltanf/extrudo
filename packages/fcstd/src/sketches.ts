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
import {
  addProjection,
  type FeatureId,
  type GeomRef,
  type ProjectionId,
  parameterNames,
  type SketchEntityId,
  syncProjections,
} from '@extrudo/core';
import type { SketchSolver } from '@extrudo/sketch';
import type { FcDocument, FcObject } from './model';
import { type DecodedSketch, decodeSketch, GEO_UNDEF } from './sketch-decode';
import {
  type ConstraintOutcome,
  type ExternalPlan,
  type LeftOut,
  mapSketch,
  type ProjectedEntity,
  type SketchMapResult,
  typeName,
} from './sketch-map';
import {
  BAD_FRAME,
  frameIsSound,
  type GivenPlane,
  NO_PLANE,
  type PlaneKind,
  placeSketch,
  sketchFrame,
} from './sketch-place';
import type { ExternalCause } from './transforms';

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
  /**
   * S9: its external links its constraints name, how many came in as
   * projections, and how many mapped constraints name a projected curve.
   */
  readonly external?: {
    readonly named: number;
    readonly projected: number;
    readonly constraints: number;
    /** The named curves that didn't come in, by why (`ExternalCause`). */
    readonly out: Readonly<Partial<Record<ExternalCause, number>>>;
  };
}

export type AddSketchResult =
  | {
      readonly imported: true;
      readonly id: FeatureId;
      readonly outcome: SketchOutcome;
      /** The Extrudo line each FreeCAD line became, by geometry index (S5: a revolve's axis line). */
      readonly lines: readonly (string | undefined)[];
      /** The sketch axes drawn as fixed construction lines (`AddSketchOptions.axes`). */
      readonly axes: { readonly h?: string; readonly v?: string };
      /** The Extrudo point at each circle's or arc's centre, or each point, by geometry index (S7: a hole's centres). */
      readonly centres: readonly (string | undefined)[];
      /** The Extrudo plane the sketch is on (S7: a hole's plane, a mirror in the sketch's plane). */
      readonly plane: GeomRef;
      /** The projections it got (S9). */
      readonly projected: readonly ProjectedEntity[];
    }
  | { readonly imported: false; readonly reason: string; readonly outcome: SketchOutcome };

export interface AddSketchOptions {
  /** Vets the constraints (planegcs, which the caller loads); without one no constraint is imported. */
  readonly solver?: SketchSolver;
  /** The Extrudo sketch's name; the object's label by default. */
  readonly name?: string;
  /** The sketch already decoded (`decodeSketch(object)`), so an importer decodes each sketch once. */
  readonly decoded?: DecodedSketch;
  /** Sketch axes to draw as fixed construction lines even when no constraint names them (S5: a revolve's axis). */
  readonly axes?: readonly ('h' | 'v')[];
  /** The plane for a frame tilted off every origin axis (S9), made by the caller. */
  readonly tilted?: GivenPlane;
  /** External geometry to project, by geometry index (S9); any other is left out. */
  readonly external?: ReadonlyMap<number, ExternalPlan>;
  /** Why each named external curve not planned stays out (S9's fix round), for the report. */
  readonly externalCauses?: ReadonlyMap<number, ExternalCause>;
}

/** The document's sketch objects, in document order. */
/** S9's counts for a sketch with external links: the links its constraints name, projected, constraints through them. */
function externalStats(
  decoded: DecodedSketch,
  mapped: SketchMapResult | undefined,
  causes: ReadonlyMap<number, ExternalCause> | undefined,
) {
  const named = new Set<number>();
  for (const c of decoded.constraints)
    for (const g of c ? [c.first, c.second, c.third] : [])
      if (g <= -3 && g !== GEO_UNDEF) named.add(g);
  const projected = new Set((mapped?.projected ?? []).map((p) => p.geo));
  const out: Partial<Record<ExternalCause, number>> = {};
  for (const g of named) {
    if (projected.has(g)) continue;
    // Not refused by the plan: it was drawn, and no constraint naming it was kept.
    const why = causes?.get(g) ?? 'unused';
    out[why] = (out[why] ?? 0) + 1;
  }
  return {
    named: named.size,
    projected: projected.size,
    constraints: mapped?.throughExternal ?? 0,
    out,
  };
}

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
  const decoded = options.decoded ?? decodeSketch(object);
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
  if (!frameIsSound(frame.global)) return refuse(BAD_FRAME, 'geometry');
  let placement: ReturnType<typeof placeSketch>;
  try {
    placement = placeSketch(design, frame.global, options.name ?? object.label, options.tilted);
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
          ...(options.axes ? { axes: options.axes } : {}),
          ...(options.external ? { external: options.external } : {}),
        });
      },
      { name: options.name ?? object.label },
    );
    // The projections (S9): their records, then each curve the importer drew put under its key.
    const records = Object.entries(mapped?.projections ?? {});
    for (const [id, p] of records)
      design.state.dispatch(
        addProjection({ feature: handle.id, id: id as ProjectionId, ref: p.ref }),
      );
    if (records.length > 0)
      design.state.dispatch(
        syncProjections({
          feature: handle.id,
          entities: {},
          points: {},
          radii: {},
          remove: [],
          curves: Object.fromEntries(
            records.map(([id, p]) => [id, p.curves as Record<string, SketchEntityId>]),
          ),
        }),
      );
    return {
      imported: true,
      id: handle.id,
      outcome: tally(
        object,
        names,
        types,
        mapped,
        decoded.external
          ? { ...placed, external: externalStats(decoded, mapped, options.externalCauses) }
          : placed,
        undefined,
      ),
      lines: mapped?.lines ?? [],
      axes: mapped?.axes ?? {},
      centres: mapped?.centres ?? [],
      projected: mapped?.projected ?? [],
      plane: where.plane,
    };
  } catch (error) {
    return {
      imported: false,
      reason: `the sketch was refused: ${(error as Error).message}`,
      outcome: tally(object, names, types, undefined, placed, 'failed'),
    };
  }
}
