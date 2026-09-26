/**
 * Sketch commands: creating a sketch (P1-01), adding to its content (P1-02)
 * and removing constraints and dimensions (P1-06). Removing and editing
 * entities come with selection and the modify tools (P1-09 onwards).
 */
import { CommandError, type DocumentDraft, defineCommand } from '../commands';
import { insertFeature } from '../document-commands';
import { nextFeatureName } from '../features';
import type { ConstraintId, DimensionId, FeatureId, SketchEntityId } from '../ids';
import type { Feature, GeomRef } from '../schema';
import { SKETCH_TYPE, sketchFeature, sketchInputs } from './feature';
import { originPlane } from './planes';
import {
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
 * P1-02). New IDs must be unused; the result must pass the sketch's
 * reference checks (`sketchIssues`), or nothing changes.
 */
export const addToSketch = defineCommand<AddToSketchPayload>(
  'sketch.add',
  'Draw',
  (
    draft,
    { feature, entities = {}, constraints = {}, dimensions = {}, points = {}, radii = {} },
  ) => {
    const data = sketchDraft(draft, feature);
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
    Object.assign(data.entities, entities);
    Object.assign(data.constraints, constraints);
    Object.assign(data.dimensions, dimensions);
    const issue = sketchIssues(data)[0];
    if (issue) throw new CommandError(`Can't add that: ${issue.path.join('.')} ${issue.message}.`);
  },
);

export interface RemoveFromSketchPayload {
  feature: FeatureId;
  constraints?: readonly ConstraintId[];
  dimensions?: readonly DimensionId[];
}

/**
 * Removes constraints and dimensions from a sketch (P1-06: deleting a
 * selected constraint glyph, Fix toggled off). The geometry stays where it
 * is: it already satisfies what is left. Every ID must exist, or nothing
 * changes.
 */
export const removeFromSketch = defineCommand<RemoveFromSketchPayload>(
  'sketch.remove',
  'Delete',
  (draft, { feature, constraints = [], dimensions = [] }) => {
    const data = sketchDraft(draft, feature);
    for (const id of constraints) {
      if (!(id in data.constraints))
        throw new CommandError(`The sketch has no constraint "${id}".`);
    }
    for (const id of dimensions) {
      if (!(id in data.dimensions)) throw new CommandError(`The sketch has no dimension "${id}".`);
    }
    for (const id of constraints) delete data.constraints[id];
    for (const id of dimensions) delete data.dimensions[id];
  },
);

function sketchDraft(draft: DocumentDraft, id: FeatureId): SketchData {
  const feature = draft.features.find((f) => f.id === id);
  const input = feature?.type === SKETCH_TYPE ? feature.inputs.sketch : undefined;
  if (input?.kind !== 'sketchData') throw new CommandError(`There's no sketch "${id}".`);
  return input.sketch as SketchData;
}
