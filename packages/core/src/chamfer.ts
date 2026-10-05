/**
 * The chamfer feature (P3-02, ADR-0043, FR-FT-05): bevels edges of a body.
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `CHAMFER_TYPE` (ADR-0003).
 *
 * **Edge sets, each with its own mode.** A chamfer has up to
 * `CHAMFER_MAX_SETS` sets of edges (as a fillet has), and each set has its
 * own `mode` and values. Set 1 uses the input names `edges`, `mode`,
 * `distance`, `distanceB`, `angle` and `flip`; set `n` appends its number
 * (`edges2`, `mode2`, `distance2`, `distanceB2`, `angle2`, `flip2` …). All
 * inputs are optional; a set without edges is ignored.
 * `CHAMFER_MAX_SETS` was 8 until P4-12, which raised it to 32 (as in a
 * fillet): a document with fewer sets reads unchanged. The modes:
 *
 * - `equal`: the chamfer is `distance` from the edge on both faces.
 * - `two-distances`: `distance` on the set's first face, `distanceB` on the
 *   other. Which face is "first" is the kernel's default (the lower-numbered
 *   of the two around the edge); `flip` swaps them.
 * - `distance-angle`: `distance` on the first face, and the chamfer makes
 *   `angle` with that face (45° is the same as equal distances; 30° gives a
 *   shallow bevel that is longer on that face).
 *
 * **Reference face (P4-12).** The two non-equal modes may name which face
 * takes `distance`, with a per-set `face` input (`face`, `face2` …, a `face`
 * reference): the evaluator then works out `flip` from the picked face, so
 * the choice doesn't depend on the kernel's face order. It must touch every
 * edge of the set. While a set has a face, `flip` is ignored.
 *
 * The inputs are plain `ref`, `enum`, `expr` and `bool` inputs, so the
 * document schema doesn't change.
 *
 * **Tangent chains.** As in a fillet, OCCT chamfers the whole chain of
 * tangent-continuous edges once one of them is given, with one setting. A
 * dialog therefore adds the chain of an edge you pick.
 */
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { type BoolInput, BoolInputSchema, type GeomRef, type Input } from './schema';
import { z } from './zod';

export const CHAMFER_TYPE = 'chamfer';

/** How many edge sets a chamfer can have (P4-12: up from 8). */
export const CHAMFER_MAX_SETS = 32;

/** The three ways to size a chamfer (FR-FT-05). */
export const CHAMFER_MODES = ['equal', 'two-distances', 'distance-angle'] as const;
export type ChamferMode = (typeof CHAMFER_MODES)[number];

/** The kinds of reference a chamfer takes: edges of bodies. */
export const CHAMFER_EDGE_KINDS = ['edge'] as const;

/** The kinds of reference a chamfer set's reference face takes (P4-12). */
export const CHAMFER_FACE_KINDS = ['face'] as const;

/** The name of a set's input: `base` for set 1, `base<n>` for the others. */
const keyOf = (base: string, n: number) => (n === 1 ? base : `${base}${n}`);

/** Input names of set `n` (1-based). */
export const chamferEdgesKey = (n: number) => keyOf('edges', n);
export const chamferModeKey = (n: number) => keyOf('mode', n);
/** The (first) distance: `distance`, `distance2` … */
export const chamferDistanceKey = (n: number) => keyOf('distance', n);
/** The second distance of a two-distances set: `distanceB`, `distanceB2` … */
export const chamferDistanceBKey = (n: number) => keyOf('distanceB', n);
export const chamferAngleKey = (n: number) => keyOf('angle', n);
export const chamferFlipKey = (n: number) => keyOf('flip', n);
/** The face that takes the first distance (P4-12): `face`, `face2` … */
export const chamferFaceKey = (n: number) => keyOf('face', n);

const shape: Record<string, z.ZodType> = {};
for (let n = 1; n <= CHAMFER_MAX_SETS; n++) {
  const set = n === 1 ? 'Set 1' : `Set ${n}`;
  shape[chamferEdgesKey(n)] = refsOf(CHAMFER_EDGE_KINDS)
    .optional()
    .describe(`${set}'s edges to chamfer. A set with no edges does nothing.`);
  shape[chamferModeKey(n)] = enumInput(CHAMFER_MODES)
    .optional()
    .describe(
      `${set}'s sizes: equal distance, two distances, or distance and angle. Default equal.`,
    );
  shape[chamferDistanceKey(n)] = exprOf('length')
    .optional()
    .describe(`${set}'s first distance, along the face that takes it; a length.`);
  shape[chamferDistanceBKey(n)] = exprOf('length')
    .optional()
    .describe(`${set}'s second distance, with two-distances; a length.`);
  shape[chamferAngleKey(n)] = exprOf('angle')
    .optional()
    .describe(`${set}'s angle to the first distance, with distance-angle; an angle.`);
  shape[chamferFlipKey(n)] = BoolInputSchema.optional().describe(
    `${set}'s first distance goes on the other face. Default false.`,
  );
  shape[chamferFaceKey(n)] = refsOf(CHAMFER_FACE_KINDS, 1)
    .optional()
    .describe("The face the chamfer's distances are measured from, for this set's edges.");
}

/** A chamfer's inputs: `edges`/`mode`/`distance`/… and their numbered copies (all optional). */
export type ChamferInputs = Record<string, Input>;

export const ChamferInputsSchema = z.strictObject(shape) as unknown as z.ZodType<ChamferInputs>;

export const chamferFeature: FeatureDefinition<ChamferInputs> = {
  type: CHAMFER_TYPE,
  label: 'Chamfer',
  category: 'modify',
  icon: 'chamfer',
  inputsSchema: ChamferInputsSchema,
  // ADR-0068 §4, from the kernel's chamfer (P3-02): the bevel an edge makes.
  faceRoles: [
    {
      pattern: 'from:(<edge>)',
      description: 'The bevel: a face the chamfer makes from each edge it bevels.',
    },
  ],
};

/** One set of a chamfer: its edges, mode and the inputs holding its values. */
export interface ChamferSet {
  /** 1-based. */
  n: number;
  edges: GeomRef[];
  mode: ChamferMode;
  /** Swap which face takes the first distance (two distances, distance and angle). */
  flip: boolean;
  /**
   * The face that takes the first distance (P4-12), instead of the kernel's
   * default and `flip`. It must touch every edge of the set.
   */
  face: GeomRef | undefined;
  /** The `expr` inputs' names, absent while the set lacks them. */
  distance: string | undefined;
  distanceB: string | undefined;
  angle: string | undefined;
}

/** The mode a set's inputs hold (equal when missing or unknown). */
export function chamferModeOf(inputs: ChamferInputs, n: number): ChamferMode {
  const mode = inputs[chamferModeKey(n)];
  const value = mode?.kind === 'enum' ? mode.value : undefined;
  return CHAMFER_MODES.find((m) => m === value) ?? 'equal';
}

/** The sets of a chamfer that have edges, in order. */
export function chamferSets(inputs: ChamferInputs): ChamferSet[] {
  const sets: ChamferSet[] = [];
  const named = (key: string) => (inputs[key]?.kind === 'expr' ? key : undefined);
  for (let n = 1; n <= CHAMFER_MAX_SETS; n++) {
    const edges = inputs[chamferEdgesKey(n)];
    if (edges?.kind !== 'ref' || edges.refs.length === 0) continue;
    const flip = inputs[chamferFlipKey(n)] as BoolInput | undefined;
    const face = inputs[chamferFaceKey(n)];
    sets.push({
      n,
      edges: edges.refs,
      mode: chamferModeOf(inputs, n),
      flip: flip?.kind === 'bool' ? flip.value : false,
      face: face?.kind === 'ref' ? (face.refs[0] as GeomRef | undefined) : undefined,
      distance: named(chamferDistanceKey(n)),
      distanceB: named(chamferDistanceBKey(n)),
      angle: named(chamferAngleKey(n)),
    });
  }
  return sets;
}

/** A set for `chamferInputs`: only the values its mode uses are needed. */
export interface ChamferSetSpec {
  edges: GeomRef[];
  /** Default `equal`. */
  mode?: ChamferMode;
  distance: string;
  /** For `two-distances`. */
  distanceB?: string;
  /** For `distance-angle`. */
  angle?: string;
  flip?: boolean;
  /** The face that takes the first distance (P4-12), for the non-equal modes. */
  face?: GeomRef;
}

/**
 * A chamfer's inputs from plain sets (tests, scripts; the dialog builds the
 * same shape). Lengths get the length unit, angles the angle unit;
 * `paramName`s are left to the caller.
 */
export function chamferInputs(sets: readonly ChamferSetSpec[]): ChamferInputs {
  const inputs: ChamferInputs = {};
  sets.slice(0, CHAMFER_MAX_SETS).forEach((set, i) => {
    const n = i + 1;
    inputs[chamferEdgesKey(n)] = { kind: 'ref', refs: set.edges };
    inputs[chamferModeKey(n)] = { kind: 'enum', value: set.mode ?? 'equal' };
    inputs[chamferDistanceKey(n)] = { kind: 'expr', expr: set.distance, unit: 'length' };
    if (set.distanceB !== undefined) {
      inputs[chamferDistanceBKey(n)] = { kind: 'expr', expr: set.distanceB, unit: 'length' };
    }
    if (set.angle !== undefined) {
      inputs[chamferAngleKey(n)] = { kind: 'expr', expr: set.angle, unit: 'angle' };
    }
    if (set.flip !== undefined) inputs[chamferFlipKey(n)] = { kind: 'bool', value: set.flip };
    if (set.face !== undefined) inputs[chamferFaceKey(n)] = { kind: 'ref', refs: [set.face] };
  });
  return inputs;
}
