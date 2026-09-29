/**
 * The fillet dialog (P3-01, ADR-0038, FR-FT-04): edges of a body, each set
 * with its own radius. Fields are named like the feature's inputs
 * (`edges`/`radius`, `edges2`/`radius2` …), so the framework's default
 * mapping turns them into inputs and back. Set 1 is always there; set n + 1
 * shows once set n has edges, up to `FILLET_MAX_SETS`. Picking an edge
 * brings its whole tangent chain, because OCCT rounds the chain (the
 * selection fields have `tangentChain`); the live preview shows the result
 * and a failure shows its message in the dialog ("Radius 5 mm is too large
 * for edge 12 (max ≈ 2.4 mm)").
 */
import {
  FILLET_EDGE_KINDS,
  FILLET_MAX_SETS,
  filletEdgesKey,
  filletFeature,
  filletRadiusKey,
} from '@extrudo/core';
import { type DialogField, type DialogValues, defineFeatureDialog } from './spec';

const hasEdges = (values: DialogValues, n: number) =>
  (values.refs[filletEdgesKey(n)]?.length ?? 0) > 0;

/** The two fields of set `n` (1-based). */
function setFields(n: number): DialogField[] {
  const suffix = n === 1 ? '' : ` ${n}`;
  return [
    {
      kind: 'selection',
      name: filletEdgesKey(n),
      label: `Edges${suffix}`,
      accepts: FILLET_EDGE_KINDS,
      min: n === 1 ? 1 : 0,
      prompt: n === 1 ? 'Pick edges' : 'Pick edges for another radius',
      tangentChain: true,
      hint:
        n === 1
          ? 'Edges of a body. Picking an edge takes the edges tangent to it too.'
          : 'Another set of edges, with its own radius.',
      ...(n > 1 && { shown: (v: DialogValues) => hasEdges(v, n - 1) || hasEdges(v, n) }),
    },
    {
      kind: 'expression',
      name: filletRadiusKey(n),
      label: `Radius${suffix}`,
      unit: 'length',
      default: '1 mm',
      ...(n > 1 && { shown: (v: DialogValues) => hasEdges(v, n) }),
    },
  ];
}

export const filletDialog = defineFeatureDialog({
  ...filletFeature,
  command: 'fillet',
  fields: Array.from({ length: FILLET_MAX_SETS }, (_, i) => setFields(i + 1)).flat(),
  // The result replaces the body it rounds: drawn as the body itself.
  previewStyle: () => 'new',
});
