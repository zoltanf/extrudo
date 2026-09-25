/**
 * Sketch commands. Editing a sketch's content (drawing, constraints,
 * dimensions) comes with the sketch tools (P1-02 onwards).
 */
import { CommandError, defineCommand } from '../commands';
import { insertFeature } from '../document-commands';
import { nextFeatureName } from '../features';
import type { FeatureId } from '../ids';
import type { Feature, GeomRef } from '../schema';
import { SKETCH_TYPE, sketchFeature, sketchInputs } from './feature';
import { originPlane } from './planes';

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
