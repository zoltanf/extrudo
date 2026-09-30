/**
 * The press-pull proposal rule for sweeps (P3-08, ADR-0051, FR-FT-08): which
 * body operation Extrude and Revolve propose for what they sweep, in one
 * place. It applies only until the user picks an operation, and never to a
 * stored value the rule wouldn't give (`FeatureDialogSpec.propose`).
 *
 * - Profiles of a sketch on an origin or construction plane make a **new
 *   body**.
 * - A **face of a body**, and a profile of a sketch drawn on a body's face
 *   (P2-09), count as that face: swept **out** of the body (along the face's
 *   outward normal) they **join** it, swept **in** they **cut** it, and swept
 *   **both** ways (symmetric, two sides, a whole turn) they join.
 * - When the way isn't known (no distance yet, to an object, a revolve with
 *   no axis or a face square to the axis) nothing is proposed, except that a
 *   revolve proposes the join it always did.
 *
 * Extrude works the way out from the sign of its distance, Flip and the
 * extent (`extrudeTravel`); Revolve from which way side 1 starts turning at
 * the profiles' centre (`revolveTravel`, in `revolve.ts`).
 */
import {
  type BodyOperation,
  type ExtrudoDocument,
  type GeomRef,
  parseProfileRefId,
  readSketch,
} from '@extrudo/core';

/** Which way a sweep leaves its faces: out of the body, into it, or both ways. */
export type Travel = 'out' | 'in' | 'both';

/**
 * Whether a pick belongs to a body: a face, or a profile of a sketch on a
 * face (P2-09). Without the document a profile can't be told from a plain
 * one, so it isn't counted.
 */
export function isOnBody(ref: GeomRef, doc?: Pick<ExtrudoDocument, 'features'>): boolean {
  if (ref.kind === 'face') return true;
  if (ref.kind !== 'profile' || !doc) return false;
  const sketch = parseProfileRefId(ref.id)?.feature;
  const feature = sketch && doc.features.find((f) => f.id === sketch);
  return (feature && readSketch(feature)?.plane.kind) === 'face';
}

/**
 * The operation a sweep of `refs` proposes: a new body unless a pick belongs
 * to a body, then join or cut by which way it `travel`s. Undefined with no
 * picks, or when the way isn't known.
 */
export function proposeSweep(
  refs: readonly GeomRef[],
  travel: Travel | undefined,
  doc?: Pick<ExtrudoDocument, 'features'>,
): BodyOperation | undefined {
  if (refs.length === 0) return undefined;
  if (!refs.some((ref) => isOnBody(ref, doc))) return 'new-body';
  if (travel === undefined) return undefined;
  return travel === 'in' ? 'cut' : 'join';
}
