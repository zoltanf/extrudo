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
 *
 * **Variable radius (P4-10, ADR-0064 §2).** Each set has a Variable toggle
 * and, while it is on, an End radius and a Swap ends: the round then runs
 * from Radius at one end of the chain to End radius at the other, which is
 * what the feature's `radiusEnd<n>` and `swap<n>` inputs hold. Variable is
 * not an input of its own — a set is variable exactly when it has an end
 * radius — so turning the toggle off drops those two inputs again (the
 * default mapping only writes the fields that are shown).
 */
import {
  FILLET_EDGE_KINDS,
  FILLET_MAX_SETS,
  filletEdgesKey,
  filletEndKey,
  filletFeature,
  filletRadiusKey,
  filletSwapKey,
} from '@extrudo/core';
import { type DialogField, type DialogValues, defineFeatureDialog } from './spec';
import { defaultFromInputs, defaultInputs } from './values';

const hasEdges = (values: DialogValues, n: number) =>
  (values.refs[filletEdgesKey(n)]?.length ?? 0) > 0;

/** Whether set `n`'s round tapers. */
const isVariable = (values: DialogValues, n: number) => values.toggles[variableKey(n)] === true;

/**
 * The Variable toggle's own field name, which is no input: `variable`,
 * `variable2` …
 */
const variableKey = (n: number) => (n === 1 ? 'variable' : `variable${n}`);

/** The fields of set `n` (1-based). */
function setFields(n: number): DialogField[] {
  const suffix = n === 1 ? '' : ` ${n}`;
  // A set past the first shows once the one before it has edges.
  const inReach = (v: DialogValues) => hasEdges(v, n - 1) || hasEdges(v, n);
  const rounded = (v: DialogValues) => hasEdges(v, n) && isVariable(v, n);
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
      ...(n > 1 && { shown: inReach }),
    },
    {
      kind: 'expression',
      name: filletRadiusKey(n),
      label: `Radius${suffix}`,
      unit: 'length',
      default: '1 mm',
      ...(n > 1 && { shown: (v: DialogValues) => hasEdges(v, n) }),
    },
    {
      kind: 'toggle',
      name: variableKey(n),
      label: `Variable${suffix}`,
      default: false,
      hint: 'Let the radius change along the edges, from Radius at one end to End radius at the other.',
      ...(n > 1 && { shown: (v: DialogValues) => hasEdges(v, n) }),
    },
    {
      kind: 'expression',
      name: filletEndKey(n),
      label: `End radius${suffix}`,
      unit: 'length',
      default: '1 mm',
      hint: 'The radius at the other end of the edges.',
      shown: rounded,
    },
    {
      kind: 'toggle',
      name: filletSwapKey(n),
      label: `Swap ends${suffix}`,
      default: false,
      hint: 'Put the End radius at the other end of the edges.',
      shown: rounded,
    },
  ];
}

export const filletDialog = defineFeatureDialog({
  ...filletFeature,
  command: 'fillet',
  fields: Array.from({ length: FILLET_MAX_SETS }, (_, i) => setFields(i + 1)).flat(),
  // Variable is not an input: the stored inputs are the two radii and the swap.
  toInputs(values) {
    const inputs = defaultInputs(filletDialog, values);
    for (let n = 1; n <= FILLET_MAX_SETS; n++) delete inputs[variableKey(n)];
    return inputs;
  },
  // A set is variable exactly when it has an end radius.
  fromInputs(inputs) {
    const stored = defaultFromInputs(filletDialog, inputs);
    const toggles: Record<string, boolean> = { ...stored.toggles };
    for (let n = 1; n <= FILLET_MAX_SETS; n++) {
      toggles[variableKey(n)] = filletEndKey(n) in inputs;
    }
    return { ...stored, toggles };
  },
  // The result replaces the body it rounds: drawn as the body itself.
  previewStyle: () => 'new',
});
