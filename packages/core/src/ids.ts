/**
 * Stable identifiers. Every entity in the document gets a UUID when it is
 * created and keeps it for life; IDs are never reused (architecture §4.1).
 *
 * IDs are branded strings so a feature ID can't be passed where a parameter ID
 * is expected. The brands come from the zod schemas in `schema.ts`.
 */
import { z } from 'zod';

// `crypto` is global in browsers, workers and Node ≥ 19. Core compiles without
// the DOM and Node type libraries, so declare the one method we use.
declare const crypto: { randomUUID(): string };

const id = z.string().min(1);

export const DocumentIdSchema = id.brand<'DocumentId'>();
export const FeatureIdSchema = id.brand<'FeatureId'>();
export const ParameterIdSchema = id.brand<'ParameterId'>();
export const BodyIdSchema = id.brand<'BodyId'>();
export const ViewIdSchema = id.brand<'ViewId'>();

export type DocumentId = z.infer<typeof DocumentIdSchema>;
export type FeatureId = z.infer<typeof FeatureIdSchema>;
export type ParameterId = z.infer<typeof ParameterIdSchema>;
export type BodyId = z.infer<typeof BodyIdSchema>;
export type ViewId = z.infer<typeof ViewIdSchema>;

type AnyId = DocumentId | FeatureId | ParameterId | BodyId | ViewId;

/**
 * A new random ID. Call it where an entity is created (a command's caller),
 * never inside a command recipe: commands must be deterministic so undo, redo
 * and replay produce the same document.
 */
export function newId<T extends AnyId>(): T {
  return crypto.randomUUID() as T;
}
