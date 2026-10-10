/**
 * The chamfer dialog (P3-02, ADR-0043, FR-FT-05): edges of a body, each set
 * with its own type and values. Fields are named like the feature's inputs
 * (`edges`/`mode`/`distance`/`distanceB`/`angle`/`flip`, then `edges2`/…), so
 * the framework's default mapping turns them into inputs and back. Set 1 is
 * always there; set n + 1 shows once set n has edges, up to
 * `CHAMFER_MAX_SETS`. A set shows the fields of its type: one distance
 * (equal), two distances, or a distance and an angle, and for the last two a
 * Flip that swaps which of the edge's two faces takes the first distance.
 * Picking an edge brings its whole tangent chain (OCCT bevels the chain, as
 * it rounds one for a fillet); the live preview shows the result and a
 * failure shows its message in the dialog ("Distance 20 mm is too large for
 * edge 12 (max ≈ 9.9 mm)").
 *
 * **Reference face (P4-12).** A set of one of the two unequal types has a
 * Reference face field under its Type: name the face that takes the
 * distance instead of letting the kernel's face order choose, and Flip
 * disappears (the face decides). The kernel refuses a face that doesn't
 * touch every edge of the set.
 *
 * **The distance handles (P4-12).** Every set with edges has an in-view arrow
 * for its Distance on the set's first edge (`edgeHandles.ts`): away from the
 * body for equal distances; for the unequal types along the reference face (the
 * picked one, else the kernel's choice, or the other with Flip) across the edge,
 * and for two distances a Second distance arrow along the other face. The face
 * directions are read locally at the edge's middle, so a curved edge between a
 * flat and a cylindrical face (a cylinder rim) works too (ADR-0043's fourth
 * amendment). A distance-and-angle set's Angle is an arc from the reference
 * face's direction towards the other face's, about the edge, which a drag turns
 * (P4-12, ADR-0043's third amendment). The overlay draws the set last focused
 * prominent.
 */
import {
  CHAMFER_EDGE_KINDS,
  CHAMFER_FACE_KINDS,
  CHAMFER_MAX_SETS,
  chamferAngleKey,
  chamferDistanceBKey,
  chamferDistanceKey,
  chamferEdgesKey,
  chamferFaceKey,
  chamferFeature,
  chamferFlipKey,
  chamferModeKey,
} from '@extrudo/core';
import { chamferSetManipulators } from './edgeHandles';
import { type DialogField, type DialogValues, defineFeatureDialog, type Manipulator } from './spec';

const hasEdges = (values: DialogValues, n: number) =>
  (values.refs[chamferEdgesKey(n)]?.length ?? 0) > 0;

const modeOf = (values: DialogValues, n: number) => values.choices[chamferModeKey(n)] ?? 'equal';

/** Whether set `n` takes its distance on one named face (P4-12). */
const isUnequal = (values: DialogValues, n: number) => modeOf(values, n) !== 'equal';

/** Whether set `n` has a reference face picked (P4-12), which replaces its Flip. */
const hasFace = (values: DialogValues, n: number) =>
  (values.refs[chamferFaceKey(n)]?.length ?? 0) > 0;

/** The fields of set `n` (1-based). */
function setFields(n: number): DialogField[] {
  const suffix = n === 1 ? '' : ` ${n}`;
  /** Set 1's fields always show; a later set's once it has edges. */
  const shownWith =
    (extra?: (values: DialogValues) => boolean) =>
    (values: DialogValues): boolean =>
      (n === 1 || hasEdges(values, n)) && (extra?.(values) ?? true);
  const later = n > 1;
  return [
    {
      kind: 'selection',
      name: chamferEdgesKey(n),
      label: `Edges${suffix}`,
      accepts: CHAMFER_EDGE_KINDS,
      min: n === 1 ? 1 : 0,
      prompt: n === 1 ? 'Pick edges' : 'Pick edges for another chamfer',
      tangentChain: true,
      hint:
        n === 1
          ? 'Edges of a body. Picking an edge takes the edges tangent to it too.'
          : 'Another set of edges, with its own type and distances.',
      ...(later && { shown: (v: DialogValues) => hasEdges(v, n - 1) || hasEdges(v, n) }),
    },
    {
      kind: 'choice',
      name: chamferModeKey(n),
      label: `Type${suffix}`,
      options: [
        { value: 'equal', label: 'Equal distance' },
        { value: 'two-distances', label: 'Two distances' },
        { value: 'distance-angle', label: 'Distance and angle' },
      ],
      default: 'equal',
      ...(later && { shown: shownWith() }),
    },
    {
      kind: 'selection',
      name: chamferFaceKey(n),
      label: `Reference face${suffix}`,
      accepts: CHAMFER_FACE_KINDS,
      min: 0,
      max: 1,
      prompt: 'Automatic',
      hint: 'The face the distance is measured on, for a type with two faces to choose from. Without one, the kernel takes the first of the edge’s two faces.',
      shown: shownWith((v) => isUnequal(v, n)),
    },
    {
      kind: 'expression',
      name: chamferDistanceKey(n),
      label: `Distance${suffix}`,
      unit: 'length',
      default: '1 mm',
      hint: 'How far the chamfer reaches from the edge along the face (both faces when equal).',
      ...(later && { shown: shownWith() }),
    },
    {
      kind: 'expression',
      name: chamferDistanceBKey(n),
      label: `Second distance${suffix}`,
      unit: 'length',
      default: '1 mm',
      hint: 'How far it reaches along the other face.',
      shown: shownWith((v) => modeOf(v, n) === 'two-distances'),
    },
    {
      kind: 'expression',
      name: chamferAngleKey(n),
      label: `Angle${suffix}`,
      unit: 'angle',
      default: '45 deg',
      hint: 'The angle the chamfer makes with the face that takes the distance.',
      shown: shownWith((v) => modeOf(v, n) === 'distance-angle'),
    },
    {
      kind: 'toggle',
      name: chamferFlipKey(n),
      label: `Flip${suffix}`,
      default: false,
      hint: 'Swap which of the two faces takes the distance.',
      shown: shownWith((v) => isUnequal(v, n) && !hasFace(v, n)),
    },
  ];
}

export const chamferDialog = defineFeatureDialog({
  ...chamferFeature,
  command: 'chamfer',
  fields: Array.from({ length: CHAMFER_MAX_SETS }, (_, i) => setFields(i + 1)).flat(),
  // The result replaces the body it bevels: drawn as the body itself.
  previewStyle: () => 'new',
  manipulators: (values, ctx) => {
    const out: Manipulator[] = [];
    // Only sets that have edges: the 32 possible ones cost nothing while empty.
    for (let n = 1; n <= CHAMFER_MAX_SETS; n++) {
      if (!hasEdges(values, n)) continue;
      const distance = chamferDistanceKey(n);
      const distanceB = chamferDistanceBKey(n);
      // Each handle follows the set's other fields: focusing one makes its own
      // set's handles the prominent ones.
      const follows = [
        chamferEdgesKey(n),
        chamferModeKey(n),
        chamferFaceKey(n),
        chamferFlipKey(n),
        chamferAngleKey(n),
      ];
      out.push(
        ...chamferSetManipulators(
          {
            edges: chamferEdgesKey(n),
            distance,
            distanceB,
            mode: modeOf(values, n),
            flip: values.toggles[chamferFlipKey(n)] === true,
            face: values.refs[chamferFaceKey(n)]?.[0],
            angle: chamferAngleKey(n),
          },
          values,
          ctx.bodies,
          {
            distance: { follows },
            angle: {
              follows: [
                chamferEdgesKey(n),
                chamferModeKey(n),
                chamferFaceKey(n),
                chamferFlipKey(n),
                distance,
              ],
            },
          },
        ),
      );
    }
    return out;
  },
});
