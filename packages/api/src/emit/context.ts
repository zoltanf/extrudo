/**
 * What the macro emitter's pieces share (ADR-0073 §1): the document, the
 * features the run selects, the variable each one is emitted as, and the
 * stored sketch behind a selected sketch feature.
 */
import type {
  ComponentId,
  ExtrudoDocument,
  Feature,
  FeatureDefinition,
  GeomRef,
  JointId,
  SketchData,
} from '@extrudo/core';
import { documentFeatures } from '@extrudo/core';

/** A sketch feature's stored plane and content, read once. */
export interface SketchView {
  plane: GeomRef;
  data: SketchData;
}

export interface EmitContext {
  doc: ExtrudoDocument;
  /** The IDs of the features the run emits. */
  selected: ReadonlySet<string>;
  /** A selected feature's ID → the variable its call is assigned to. */
  varOf: ReadonlyMap<string, string>;
  /** A component's ID → the variable it is emitted as (ADR-0081 §9). */
  componentOf: ReadonlyMap<ComponentId, string>;
  /** A joint's ID → the variable it is emitted as. */
  jointOf: ReadonlyMap<JointId, string>;
  featureById: ReadonlyMap<string, Feature>;
  /** A selected sketch feature's ID → its plane and content. */
  sketchOf: ReadonlyMap<string, SketchView>;
  /** The feature definition of a type, for its input metadata. */
  definition(type: string): FeatureDefinition | undefined;
  /**
   * Whether a feature input's own parameter name (`d1`) is emitted. True for a
   * whole design (the inverse API round trip keeps names expressions read);
   * false for a run, which is replayed into a live design where those model
   * parameter names are the surrounding design's, so emitting them would
   * collide with the recorded feature a "Keep both" leaves in place.
   */
  preserveParamNames: boolean;
}

/** The definition of a feature type, from core's registry. */
export function definitionOf(type: string): FeatureDefinition | undefined {
  return documentFeatures().get(type);
}
