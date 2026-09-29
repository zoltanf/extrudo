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
 */
import {
  CHAMFER_EDGE_KINDS,
  CHAMFER_MAX_SETS,
  chamferAngleKey,
  chamferDistanceBKey,
  chamferDistanceKey,
  chamferEdgesKey,
  chamferFeature,
  chamferFlipKey,
  chamferModeKey,
} from '@extrudo/core';
import { type DialogField, type DialogValues, defineFeatureDialog } from './spec';

const hasEdges = (values: DialogValues, n: number) =>
  (values.refs[chamferEdgesKey(n)]?.length ?? 0) > 0;

const modeOf = (values: DialogValues, n: number) => values.choices[chamferModeKey(n)] ?? 'equal';

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
      shown: shownWith((v) => modeOf(v, n) !== 'equal'),
    },
  ];
}

export const chamferDialog = defineFeatureDialog({
  ...chamferFeature,
  command: 'chamfer',
  fields: Array.from({ length: CHAMFER_MAX_SETS }, (_, i) => setFields(i + 1)).flat(),
  // The result replaces the body it bevels: drawn as the body itself.
  previewStyle: () => 'new',
});
