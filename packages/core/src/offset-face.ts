/**
 * The Offset Face feature (P3-08, ADR-0051, FR-FT-12): moves faces of a
 * body along their normals by a distance. The faces next to them are
 * extended or trimmed to follow, so a planar face moves like a pad growing
 * or sinking, a cylinder's wall changes its radius, a hole's wall widens or
 * narrows the hole. Positive moves a face out of the body (along its outward
 * normal: the body grows there, a hole's wall closes in), negative moves it
 * in. Faces that run smoothly into a picked face move with it, except a
 * round a fillet made that isn't picked itself: it is made again at its
 * radius between the moved face and its other neighbour, which stays
 * (ADR-0051's amendment, 2026-10-14). That happens only with `keepRounds`
 * on (ADR-0051's second amendment, 2026-10-14): the app's dialog sets it for
 * a new offset and then picks a wall without its rounds. A feature without
 * it (every one saved before) moves its smooth chains whole, rounds and all,
 * as it always did; no migration is needed, since absent means off.
 *
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `OFFSET_FACE_TYPE` (ADR-0003). Inputs are plain `ref`,
 * `expr` and `bool` inputs, so the document schema doesn't change.
 */
import { exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import {
  type BoolInput,
  BoolInputSchema,
  type ExprInput,
  type GeomRef,
  type RefInput,
} from './schema';
import { z } from './zod';

export const OFFSET_FACE_TYPE = 'offsetFace';

/** What an offset takes: faces of bodies. */
export const OFFSET_FACE_KINDS = ['face'] as const;

export const OffsetFaceInputsSchema = z.strictObject({
  /** The faces to move, of one or several bodies. Empty: an error until one is picked. */
  faces: refsOf(OFFSET_FACE_KINDS).describe(
    'The faces to move along their outward normal. Required.',
  ),
  /** How far, along the outward normal (a length; negative goes in; 0 is refused by the kernel). */
  distance: exprOf('length').describe(
    'How far; a length. Positive grows the body outwards, negative closes it in. Required.',
  ),
  /** Rounds next to the moved faces keep their radius (absent: off, the old behaviour). */
  keepRounds: BoolInputSchema.optional().describe(
    "Fillet rounds next to the moved faces that aren't listed keep their radius: each is made again between the moved face and its other neighbour, which stays. Off, the faces that run smoothly into a listed one move with it, rounds included, and a round's radius changes by the distance. Default false; the app turns it on for a new offset.",
  ),
});
export type OffsetFaceInputs = z.infer<typeof OffsetFaceInputsSchema>;

export const offsetFaceFeature: FeatureDefinition<OffsetFaceInputs> = {
  type: OFFSET_FACE_TYPE,
  label: 'Offset Face',
  category: 'modify',
  icon: 'offset-face',
  inputsSchema: OffsetFaceInputsSchema,
};

/** An offset's faces with the plain reading of its inputs. */
export interface OffsetFaceSettings {
  faces: GeomRef[];
  /** Unlisted rounds next to the moved faces keep their radius. */
  keepRounds: boolean;
}

/** Reads an offset face's (valid) inputs. */
export function offsetFaceSettings(inputs: OffsetFaceInputs): OffsetFaceSettings {
  return { faces: inputs.faces.refs, keepRounds: inputs.keepRounds?.value === true };
}

/**
 * An offset face's inputs from plain values (tests, scripts; the dialog
 * builds the same shape). `distance` is an expression: `'5 mm'`, `'wall / 2'`.
 * `keepRounds` is on, as for a new offset in the app.
 */
export function offsetFaceInputs(
  faces: GeomRef[],
  distance: string,
  keepRounds = true,
): OffsetFaceInputs {
  const refs: RefInput = { kind: 'ref', refs: faces };
  const expr: ExprInput = { kind: 'expr', expr: distance, unit: 'length' };
  const keep: BoolInput = { kind: 'bool', value: keepRounds };
  return { faces: refs, distance: expr, keepRounds: keep };
}
