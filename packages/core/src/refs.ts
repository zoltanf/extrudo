/**
 * References to geometry (`GeomRef`, ADR-0003, ADR-0005). In a file of their
 * own so the sketch schema can use them (a sketch's projections, P2-09)
 * without importing the document schema, which imports the sketch schema.
 */
import { z } from 'zod';

/**
 * A reference to geometry: an origin plane, a face, an edge, a sketch profile…
 * `id` is a persistent name from the topological-naming service (§5.2,
 * ADR-0005), never a raw index. Face, edge and vertex references also keep
 * a fingerprint of what they pointed at, used when the name doesn't resolve.
 */
export const GeomRefKindSchema = z.enum([
  'plane',
  'axis',
  'point',
  'face',
  'edge',
  'vertex',
  'profile',
  'body',
  'sketchEntity',
  /** A feature of the timeline (P3-07): what a pattern or mirror replays. `id` is the feature's ID. */
  'feature',
]);
export type GeomRefKind = z.infer<typeof GeomRefKindSchema>;

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

/**
 * What a referenced face, edge or vertex looked like when it was picked
 * (ADR-0005). The kernel matches it against the current geometry when the
 * reference's name no longer resolves, and warns that it guessed.
 */
export const GeomFingerprintSchema = z.strictObject({
  /** Surface type of a face (`plane`, `cylinder`, …), curve type of an edge (`line`, `circle`, …), `point` for a vertex. */
  type: z.string().min(1),
  /** Area centroid of a face, midpoint of an edge, position of a vertex (mm). */
  at: Vec3Schema,
  /** A plane's outward normal, an axis, or a line's direction. */
  dir: Vec3Schema.optional(),
  /** Area (mm²) of a face, length (mm) of an edge. */
  size: z.number().nonnegative().optional(),
  /** Persistent names of the faces around it (of the faces next to a face). */
  adj: z.array(z.string()).optional(),
});
export type GeomFingerprint = z.infer<typeof GeomFingerprintSchema>;

export const GeomRefSchema = z.strictObject({
  kind: GeomRefKindSchema,
  id: z.string().min(1),
  /** Faces, edges and vertices: the fallback when `id` doesn't resolve. Optional (added in P2-04). */
  fingerprint: GeomFingerprintSchema.optional(),
});
export type GeomRef = z.infer<typeof GeomRefSchema>;
