/**
 * The sketch feature (P1-01, ADR-0010): a plane reference and the sketch's 2D
 * content. The kernel adds its evaluator and the web app its sketch mode,
 * each in its own registry keyed by `SKETCH_TYPE` (ADR-0003).
 */
import { z } from 'zod';
import type { FeatureDefinition } from '../features';
import type { FeatureId, SketchEntityId } from '../ids';
import {
  type Feature,
  type GeomRef,
  type RefInput,
  RefInputSchema,
  SketchDataInputSchema,
} from '../schema';
import type { SketchData } from './schema';

export const SKETCH_TYPE = 'sketch';

/** A sketch sits on exactly one plane: an origin or construction plane, or a flat face. */
export const SketchPlaneInputSchema = RefInputSchema.refine(
  (input) => input.refs.length === 1 && ['plane', 'face'].includes(input.refs[0]?.kind ?? ''),
  'must be one plane or face',
);

export const SketchInputsSchema = z.strictObject({
  plane: SketchPlaneInputSchema,
  sketch: SketchDataInputSchema,
});
export type SketchInputs = z.infer<typeof SketchInputsSchema>;

export const sketchFeature: FeatureDefinition<SketchInputs> = {
  type: SKETCH_TYPE,
  label: 'Sketch',
  category: 'sketch',
  icon: 'create-sketch',
  inputsSchema: SketchInputsSchema,
};

export function emptySketchData(): SketchData {
  return { entities: {}, constraints: {}, dimensions: {} };
}

export function sketchInputs(plane: GeomRef, sketch: SketchData = emptySketchData()): SketchInputs {
  const planeInput: RefInput = { kind: 'ref', refs: [plane] };
  return { plane: planeInput, sketch: { kind: 'sketchData', sketch } };
}

export interface SketchView {
  plane: GeomRef;
  data: SketchData;
}

/**
 * A sketch feature's plane and content, or `undefined` when the feature
 * isn't a sketch or its inputs are invalid (the feature registry reports
 * why). The result shares the frozen document's objects.
 */
export function readSketch(feature: Feature): SketchView | undefined {
  if (feature.type !== SKETCH_TYPE) return undefined;
  const { plane, sketch } = feature.inputs;
  if (plane?.kind !== 'ref' || sketch?.kind !== 'sketchData') return undefined;
  const ref = plane.refs[0];
  if (!ref || plane.refs.length !== 1 || !['plane', 'face'].includes(ref.kind)) return undefined;
  return { plane: ref, data: sketch.sketch };
}

/**
 * A sketch profile's ID in a selection or a `profile` reference (P1-11):
 * the sketch feature's ID and the region's ID within it (`detectProfiles`
 * in `@extrudo/sketch/profiles`).
 */
export function profileRefId(feature: FeatureId, profile: string): string {
  return `${feature}/${profile}`;
}

/**
 * A sketch point or curve picked outside its sketch (model mode, P2-03), in
 * a selection or a `sketchEntity` reference: `<sketch>/<entity>`, like a
 * profile. Inside the open sketch, selections use the bare entity ID.
 */
export function sketchEntityRefId(feature: FeatureId, entity: SketchEntityId): string {
  return `${feature}/${entity}`;
}

/** The sketch and entity of a `sketchEntityRefId`, or `undefined` if it isn't one. */
export function parseSketchEntityRefId(
  id: string,
): { feature: FeatureId; entity: SketchEntityId } | undefined {
  const ref = parseProfileRefId(id);
  return ref && { feature: ref.feature, entity: ref.profile as SketchEntityId };
}

/** The sketch and region of a `profileRefId`, or `undefined` if it isn't one. */
export function parseProfileRefId(id: string): { feature: FeatureId; profile: string } | undefined {
  const slash = id.lastIndexOf('/');
  if (slash <= 0 || slash === id.length - 1) return undefined;
  return { feature: id.slice(0, slash) as FeatureId, profile: id.slice(slash + 1) };
}

/**
 * The shown sketches whose profiles `feature` uses: the ones a new feature
 * hides when it is created (as Fusion does), so a used sketch's profile
 * doesn't float in front of the faces made from it and take their clicks.
 */
export function usedSketches(
  feature: Pick<Feature, 'inputs'>,
  features: readonly Pick<Feature, 'id' | 'type' | 'visible'>[],
): FeatureId[] {
  const ids = new Set<string>();
  for (const input of Object.values(feature.inputs)) {
    if (input.kind !== 'ref') continue;
    for (const ref of input.refs) {
      const parsed = ref.kind === 'profile' ? parseProfileRefId(ref.id) : undefined;
      if (parsed) ids.add(parsed.feature);
    }
  }
  return features
    .filter((f) => ids.has(f.id) && f.type === SKETCH_TYPE && f.visible !== false)
    .map((f) => f.id);
}
