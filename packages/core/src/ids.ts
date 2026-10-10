/**
 * Stable identifiers. Every entity in the document gets a UUID when it is
 * created and keeps it for life; IDs are never reused (architecture §4.1).
 *
 * IDs are branded strings so a feature ID can't be passed where a parameter ID
 * is expected. The brands come from the zod schemas in `schema.ts`.
 */
import { z } from './zod';

// `crypto` is global in browsers, workers and Node ≥ 19. Core compiles without
// the DOM and Node type libraries, so declare the one method we use.
declare const crypto: { randomUUID(): string };

const id = z.string().min(1);

export const DocumentIdSchema = id.brand<'DocumentId'>();
export const FeatureIdSchema = id.brand<'FeatureId'>();
export const ParameterIdSchema = id.brand<'ParameterId'>();
export const BodyIdSchema = id.brand<'BodyId'>();
export const ViewIdSchema = id.brand<'ViewId'>();
/** A group of neighbouring timeline features (P4-09, ADR-0065 §1). */
export const GroupIdSchema = id.brand<'GroupId'>();
/** A saved set of parameter values (P4-07, ADR-0059 §2). */
export const ConfigurationIdSchema = id.brand<'ConfigurationId'>();
/** Sketch geometry: points, lines, circles, arcs. Unique within the sketch. */
export const SketchEntityIdSchema = id.brand<'SketchEntityId'>();
export const ConstraintIdSchema = id.brand<'ConstraintId'>();
export const DimensionIdSchema = id.brand<'DimensionId'>();
/** A sketch's projection of model geometry (P2-09). Unique within the sketch, like the others. */
export const ProjectionIdSchema = id.brand<'ProjectionId'>();
/** A file that travels with the design, named in `doc.attachments` (ADR-0061). */
export const AttachmentIdSchema = id.brand<'AttachmentId'>();
/** A named set of bodies in one design (P6-05, ADR-0081 §2). */
export const ComponentIdSchema = id.brand<'ComponentId'>();
/** An as-built joint between two components (P6-05, ADR-0081 §4). */
export const JointIdSchema = id.brand<'JointId'>();

export type DocumentId = z.infer<typeof DocumentIdSchema>;
export type FeatureId = z.infer<typeof FeatureIdSchema>;
export type ParameterId = z.infer<typeof ParameterIdSchema>;
export type BodyId = z.infer<typeof BodyIdSchema>;
export type ViewId = z.infer<typeof ViewIdSchema>;
export type GroupId = z.infer<typeof GroupIdSchema>;
export type ConfigurationId = z.infer<typeof ConfigurationIdSchema>;
export type SketchEntityId = z.infer<typeof SketchEntityIdSchema>;
export type ConstraintId = z.infer<typeof ConstraintIdSchema>;
export type DimensionId = z.infer<typeof DimensionIdSchema>;
export type ProjectionId = z.infer<typeof ProjectionIdSchema>;
export type AttachmentId = z.infer<typeof AttachmentIdSchema>;
export type ComponentId = z.infer<typeof ComponentIdSchema>;
export type JointId = z.infer<typeof JointIdSchema>;

type AnyId =
  | DocumentId
  | FeatureId
  | ParameterId
  | BodyId
  | ViewId
  | GroupId
  | ConfigurationId
  | SketchEntityId
  | ConstraintId
  | DimensionId
  | ProjectionId
  | AttachmentId
  | ComponentId
  | JointId;

/**
 * A new random ID. Call it where an entity is created (a command's caller),
 * never inside a command recipe: commands must be deterministic so undo, redo
 * and replay produce the same document.
 */
export function newId<T extends AnyId>(): T {
  return crypto.randomUUID() as T;
}
