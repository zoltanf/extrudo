/**
 * The sketch feature (P1-01, ADR-0010): a plane reference and the sketch's 2D
 * content. The kernel adds its evaluator and the web app its sketch mode,
 * each in its own registry keyed by `SKETCH_TYPE` (ADR-0003).
 */
import { z } from 'zod';
import type { FeatureDefinition } from '../features';
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
