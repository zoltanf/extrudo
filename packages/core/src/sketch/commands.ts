/**
 * Sketch commands: creating a sketch (P1-01), adding to its content (P1-02),
 * removing constraints and dimensions (P1-06), editing a dimension and
 * applying a solve (P1-07), deleting entities and the construction flag
 * (P1-09), and the modify tools' changes (P1-10, `modifySketch`).
 */
import { type Command, CommandError, type DocumentDraft, defineCommand } from '../commands';
import { insertFeature, refuseIfUsed } from '../document-commands';
import { isReservedName } from '../expr/evaluate';
import { nextModelParameterName, parameterNames } from '../expr/parameters';
import { nextFeatureName } from '../features';
import type { ConstraintId, DimensionId, FeatureId, SketchEntityId } from '../ids';
import type { Feature, GeomRef } from '../schema';
import { dimensionRefs } from './dimensions';
import { SKETCH_TYPE, sketchFeature, sketchInputs } from './feature';
import { originPlane } from './planes';
import {
  constraintRefs,
  type SketchConstraint,
  type SketchData,
  type SketchDimension,
  type SketchEntity,
  sketchIssues,
} from './schema';

/**
 * Adds an empty sketch on `plane` at the timeline marker. Without a `name`
 * it takes the next free default name ("Sketch3").
 */
export const createSketch = defineCommand<{ id: FeatureId; plane: GeomRef; name?: string }>(
  'sketch.create',
  'Create sketch',
  (draft, { id, plane, name }) => {
    if (plane.kind !== 'plane' && plane.kind !== 'face') {
      throw new CommandError('A sketch needs a plane or a flat face.');
    }
    if (plane.kind === 'plane' && plane.id.startsWith('origin:') && !originPlane(plane.id)) {
      throw new CommandError(`There's no origin plane "${plane.id}".`);
    }
    const feature: Feature = {
      id,
      type: SKETCH_TYPE,
      name: name ?? nextFeatureName(draft, sketchFeature.label),
      suppressed: false,
      inputs: sketchInputs(plane),
    };
    const insert = insertFeature({ feature });
    insert.recipe(draft, insert.payload);
  },
);

export interface AddToSketchPayload {
  feature: FeatureId;
  entities?: Readonly<Record<SketchEntityId, SketchEntity>>;
  constraints?: Readonly<Record<ConstraintId, SketchConstraint>>;
  dimensions?: Readonly<Record<DimensionId, SketchDimension>>;
  /**
   * New positions for existing points and radii for existing circles: the
   * solved sketch after the addition, so drawing and settling are one step.
   */
  points?: Readonly<Record<SketchEntityId, { x: number; y: number }>>;
  radii?: Readonly<Record<SketchEntityId, number>>;
}

/**
 * Adds entities, constraints and dimensions to a sketch (the drawing tools,
 * P1-02). New IDs must be unused, and so must the parameter names of new
 * driving dimensions; the result must pass the sketch's reference checks
 * (`sketchIssues`), or nothing changes.
 */
export const addToSketch = defineCommand<AddToSketchPayload>('sketch.add', 'Draw', (draft, p) =>
  changeSketch(draft, p),
);

/**
 * A change to a sketch's content as the modify tools make it (P1-10):
 * additions as in `addToSketch`, plus existing entities replaced whole
 * (`update`: a trimmed line's moved end, a circle trimmed into an arc under
 * the same ID), entities, constraints and dimensions removed as listed (no
 * clean-up: the tool works out what goes), and new expressions for existing
 * dimensions (Scale), and constraints and dimensions changed in place.
 */
export interface SketchChange extends Omit<AddToSketchPayload, 'feature'> {
  update?: Readonly<Record<SketchEntityId, SketchEntity>>;
  /**
   * Existing constraints and dimensions replaced whole, IDs kept (a
   * fillet's dimension to the old corner now measures to its virtual
   * sharp). A replaced dimension keeps its parameter name and driven flag.
   */
  replace?: {
    constraints?: Readonly<Record<ConstraintId, SketchConstraint>>;
    dimensions?: Readonly<Record<DimensionId, SketchDimension>>;
  };
  remove?: {
    entities?: readonly SketchEntityId[];
    constraints?: readonly ConstraintId[];
    dimensions?: readonly DimensionId[];
  };
  exprs?: Readonly<Record<DimensionId, string>>;
}

/**
 * Applies a `SketchChange` (P1-10: trim, fillet, offset…) as one step named
 * `label` ("Trim"). Removals go first, then replacements (which may change
 * an entity's type but not its ID), then additions and moved geometry.
 * Removed and replaced IDs must exist, no expression elsewhere may use a
 * removed dimension's parameter, and the result must pass `sketchIssues`,
 * or nothing changes.
 */
export function modifySketch(
  payload: SketchChange & { feature: FeatureId; label: string },
): Command<SketchChange & { feature: FeatureId; label: string }> {
  return {
    type: 'sketch.modify',
    label: payload.label,
    payload,
    recipe: (draft, p) => changeSketch(draft, p),
  };
}

function changeSketch(draft: DocumentDraft, change: SketchChange & { feature: FeatureId }): void {
  const {
    feature,
    entities = {},
    constraints = {},
    dimensions = {},
    points = {},
    radii = {},
    update = {},
    remove = {},
    exprs = {},
    replace = {},
  } = change;
  const data = sketchDraft(draft, feature);

  const gone = new Set<object>();
  for (const id of remove.dimensions ?? []) {
    const d = data.dimensions[id];
    if (!d) throw new CommandError(`The sketch has no dimension "${id}".`);
    gone.add(d);
  }
  for (const d of gone as Set<SketchDimension>) {
    if (!d.driven && d.paramName !== undefined) refuseIfUsed(draft, d.paramName, gone);
  }
  for (const id of remove.dimensions ?? []) delete data.dimensions[id];
  for (const id of remove.constraints ?? []) {
    if (!(id in data.constraints)) throw new CommandError(`The sketch has no constraint "${id}".`);
    delete data.constraints[id];
  }
  for (const id of remove.entities ?? []) {
    if (!(id in data.entities)) throw new CommandError(`The sketch has no entity "${id}".`);
    delete data.entities[id];
  }
  for (const [id, e] of Object.entries(update)) {
    if (!(id in data.entities)) throw new CommandError(`The sketch has no entity "${id}".`);
    data.entities[id as SketchEntityId] = e;
  }
  for (const [id, c] of Object.entries(replace.constraints ?? {})) {
    if (!(id in data.constraints)) throw new CommandError(`The sketch has no constraint "${id}".`);
    data.constraints[id as ConstraintId] = c;
  }
  for (const [id, d] of Object.entries(replace.dimensions ?? {})) {
    const old = data.dimensions[id as DimensionId];
    if (!old) throw new CommandError(`The sketch has no dimension "${id}".`);
    const { paramName: _, ...rest } = d;
    data.dimensions[id as DimensionId] = {
      ...rest,
      driven: old.driven,
      ...(old.paramName === undefined ? {} : { paramName: old.paramName }),
    } as SketchDimension;
  }

  const taken = new Set([
    ...Object.keys(data.entities),
    ...Object.keys(data.constraints),
    ...Object.keys(data.dimensions),
  ]);
  for (const id of [
    ...Object.keys(entities),
    ...Object.keys(constraints),
    ...Object.keys(dimensions),
  ]) {
    if (taken.has(id)) throw new CommandError(`The sketch already has "${id}".`);
    taken.add(id);
  }
  const names = parameterNames(draft);
  for (const d of gone as Set<SketchDimension>) {
    if (d.paramName !== undefined) names.delete(d.paramName);
  }
  for (const d of Object.values(dimensions)) {
    if (d.driven || d.paramName === undefined) continue;
    if (names.has(d.paramName) || isReservedName(d.paramName)) {
      throw new CommandError(`The name "${d.paramName}" is taken.`);
    }
    names.add(d.paramName);
  }
  Object.assign(data.entities, entities);
  moveGeometry(data, points, radii);
  Object.assign(data.constraints, constraints);
  Object.assign(data.dimensions, dimensions);
  for (const [id, expr] of Object.entries(exprs)) {
    const d = data.dimensions[id as DimensionId];
    if (!d) throw new CommandError(`The sketch has no dimension "${id}".`);
    d.expr = expr;
  }
  const issue = sketchIssues(data)[0];
  if (issue) throw new CommandError(`Can't do that: ${issue.path.join('.')} ${issue.message}.`);
}

export interface RemoveFromSketchPayload {
  feature: FeatureId;
  entities?: readonly SketchEntityId[];
  constraints?: readonly ConstraintId[];
  dimensions?: readonly DimensionId[];
}

/**
 * Removes entities, constraints and dimensions from a sketch (P1-06:
 * deleting a selected constraint glyph, Fix toggled off; P1-09: deleting
 * selected geometry). The geometry left stays where it is: it already
 * satisfies what is left.
 *
 * Removing an entity cleans up after it (`entityRemoval`): a curve takes its
 * points with it, a curve's point takes the curve (a spline with more than
 * two points only loses that point), and every constraint and dimension on a
 * removed entity goes too. Every ID must exist, and no other expression may
 * use a removed dimension's parameter, or nothing changes.
 */
export const removeFromSketch = defineCommand<RemoveFromSketchPayload>(
  'sketch.remove',
  'Delete',
  (draft, { feature, entities = [], constraints = [], dimensions = [] }) => {
    const data = sketchDraft(draft, feature);
    for (const id of entities) {
      if (!(id in data.entities)) throw new CommandError(`The sketch has no entity "${id}".`);
    }
    for (const id of constraints) {
      if (!(id in data.constraints))
        throw new CommandError(`The sketch has no constraint "${id}".`);
    }
    for (const id of dimensions) {
      const d = data.dimensions[id];
      if (!d) throw new CommandError(`The sketch has no dimension "${id}".`);
    }
    const removal = entityRemoval(data, entities);
    const allConstraints = new Set<ConstraintId>([...constraints, ...removal.constraints]);
    const allDimensions = new Set<DimensionId>([...dimensions, ...removal.dimensions]);
    const removed = new Set<object>([...allDimensions].map((id) => data.dimensions[id] as object));
    for (const id of allDimensions) {
      const d = data.dimensions[id];
      if (d && !d.driven && d.paramName !== undefined) refuseIfUsed(draft, d.paramName, removed);
    }
    for (const [id, points] of Object.entries(removal.splines)) {
      const spline = data.entities[id as SketchEntityId];
      if (spline?.type === 'spline') spline.points = points;
    }
    for (const id of removal.entities) delete data.entities[id];
    for (const id of allConstraints) delete data.constraints[id];
    for (const id of allDimensions) delete data.dimensions[id];
  },
);

/** What removing some entities takes with it (`removeFromSketch`). */
export interface EntityRemoval {
  /** Every entity that goes, the asked-for ones included. */
  entities: SketchEntityId[];
  /** Splines that only lose points: their new point lists. */
  splines: Record<SketchEntityId, SketchEntityId[]>;
  /** Constraints and dimensions on a removed entity. */
  constraints: ConstraintId[];
  dimensions: DimensionId[];
}

/**
 * Works out what removing `ids` takes with it: a curve's points, the curve a
 * point belongs to (a spline keeps its other points while it has at least
 * two), and the constraints and dimensions on anything removed. Pure; IDs
 * the sketch doesn't have are ignored.
 */
export function entityRemoval(data: SketchData, ids: readonly SketchEntityId[]): EntityRemoval {
  const owner = new Map<SketchEntityId, SketchEntityId>();
  for (const [key, e] of Object.entries(data.entities)) {
    for (const p of entityPoints(e)) owner.set(p, key as SketchEntityId);
  }
  const gone = new Set<SketchEntityId>();
  const dropped = new Map<SketchEntityId, Set<SketchEntityId>>();
  const removeCurve = (id: SketchEntityId) => {
    const e = data.entities[id];
    if (!e || gone.has(id)) return;
    gone.add(id);
    for (const p of entityPoints(e)) gone.add(p);
    dropped.delete(id);
  };
  for (const id of ids) {
    const e = data.entities[id];
    if (!e) continue;
    if (e.type !== 'point') {
      removeCurve(id);
      continue;
    }
    const curve = owner.get(id);
    const parent = curve && data.entities[curve];
    if (!curve || !parent) gone.add(id);
    else if (parent.type === 'spline' && !gone.has(curve)) {
      const set = dropped.get(curve) ?? new Set();
      set.add(id);
      dropped.set(curve, set);
    } else removeCurve(curve);
  }
  const splines: Record<SketchEntityId, SketchEntityId[]> = {};
  for (const [id, points] of dropped) {
    const spline = data.entities[id];
    if (spline?.type !== 'spline' || gone.has(id)) continue;
    const kept = spline.points.filter((p) => !points.has(p));
    if (kept.length < 2) removeCurve(id);
    else {
      splines[id] = kept;
      for (const p of points) gone.add(p);
    }
  }
  const touches = (refs: SketchEntityId[]) => refs.some((r) => gone.has(r));
  return {
    entities: [...gone],
    splines,
    constraints: Object.entries(data.constraints)
      .filter(([, c]) => touches(constraintRefs(c)))
      .map(([id]) => id as ConstraintId),
    dimensions: Object.entries(data.dimensions)
      .filter(([, d]) => touches(dimensionRefs(d)))
      .map(([id]) => id as DimensionId),
  };
}

/** The points a curve is made of (none for a point). */
export function entityPoints(e: SketchEntity): SketchEntityId[] {
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
      return [...e.points];
  }
}

/**
 * Makes curves construction geometry or normal geometry (P1-09, the
 * properties panel; FR-SK-04). Points have no such flag and are skipped.
 */
export const setSketchConstruction = defineCommand<{
  feature: FeatureId;
  entities: readonly SketchEntityId[];
  construction: boolean;
}>('sketch.construction', 'Construction', (draft, { feature, entities, construction }) => {
  const data = sketchDraft(draft, feature);
  for (const id of entities) {
    const e = data.entities[id];
    if (!e) throw new CommandError(`The sketch has no entity "${id}".`);
    if (e.type !== 'point') e.construction = construction;
  }
});

/** Solved geometry for existing entities, as `addToSketch` takes it. */
export interface SketchGeometry {
  points?: Readonly<Record<SketchEntityId, { x: number; y: number }>>;
  radii?: Readonly<Record<SketchEntityId, number>>;
}

/** The changes `updateSketchDimension` makes; fields left out stay as they are. */
export interface SketchDimensionChanges {
  expr?: string;
  /**
   * Driven (a reference) or driving. A dimension that starts driving gets
   * the next free model-parameter name; one that becomes driven gives its
   * name up, which is refused while another expression uses it.
   */
  driven?: boolean;
  label?: { x: number; y: number };
}

/**
 * Edits a sketch dimension (P1-07): its expression, driving or driven, the
 * label's place. The caller solves the sketch with the new value and passes
 * the solved geometry, so the edit and its effect are one undo step.
 */
export const updateSketchDimension = defineCommand<
  { feature: FeatureId; id: DimensionId; changes: SketchDimensionChanges } & SketchGeometry
>('sketch.dimension', 'Edit dimension', (draft, { feature, id, changes, points, radii }) => {
  const data = sketchDraft(draft, feature);
  const d = data.dimensions[id];
  if (!d) throw new CommandError(`The sketch has no dimension "${id}".`);
  if (changes.driven === true && !d.driven) {
    if (d.paramName !== undefined) refuseIfUsed(draft, d.paramName, new Set([d]));
    delete d.paramName;
  } else if (changes.driven === false && d.driven && d.paramName === undefined) {
    d.paramName = nextModelParameterName(draft);
  }
  if (changes.driven !== undefined) d.driven = changes.driven;
  if (changes.expr !== undefined) d.expr = changes.expr;
  if (changes.label !== undefined) d.label = { ...changes.label };
  moveGeometry(data, points ?? {}, radii ?? {});
});

/**
 * Moves existing points and sets circle radii: a solve's result after a
 * parameter the sketch uses has changed (P1-07).
 */
export const setSketchGeometry = defineCommand<{ feature: FeatureId } & SketchGeometry>(
  'sketch.solve',
  'Solve sketch',
  (draft, { feature, points, radii }) => {
    moveGeometry(sketchDraft(draft, feature), points ?? {}, radii ?? {});
  },
);

function moveGeometry(
  data: SketchData,
  points: Readonly<Record<SketchEntityId, { x: number; y: number }>>,
  radii: Readonly<Record<SketchEntityId, number>>,
): void {
  for (const [id, p] of Object.entries(points)) {
    const e = data.entities[id as SketchEntityId];
    if (e?.type !== 'point') throw new CommandError(`"${id}" isn't a point of this sketch.`);
    e.x = p.x;
    e.y = p.y;
  }
  for (const [id, radius] of Object.entries(radii)) {
    const e = data.entities[id as SketchEntityId];
    if (e?.type !== 'circle') throw new CommandError(`"${id}" isn't a circle of this sketch.`);
    e.radius = radius;
  }
}

function sketchDraft(draft: DocumentDraft, id: FeatureId): SketchData {
  const feature = draft.features.find((f) => f.id === id);
  const input = feature?.type === SKETCH_TYPE ? feature.inputs.sketch : undefined;
  if (input?.kind !== 'sketchData') throw new CommandError(`There's no sketch "${id}".`);
  return input.sketch as SketchData;
}
