import {
  type FeatureId,
  FILLET_MAX_SETS,
  FilletInputsSchema,
  filletInputs,
  filletSets,
  insertFeature,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { filletDialog } from './fillet';
import { featureDialogs, specForCommand } from './registry';
import type { DialogValues } from './spec';
import { BOX, namedBoxEdgesMesh, settle, setupDialogs } from './testing';
import { defaultValues, mergeValues, shownFields } from './values';

const edgeItem = (index: number) => ({ kind: 'edge' as const, id: `${BOX}:${index}` });
const edgeRef = (index: number) => ({ kind: 'edge' as const, id: `box:e${index}` });

/** The tangent chains of the fake box: edges 0-1-2 are one chain, the rest stand alone. */
function chains(index: number): number[] {
  return [0, 1, 2].includes(index) ? [0, 1, 2] : [index];
}

function setup() {
  const t = setupDialogs([filletDialog]);
  const asked: number[] = [];
  t.kernel.tangentChain = async (_body, edge) => {
    asked.push(edge);
    return chains(edge);
  };
  return { ...t, asked };
}

describe('the fillet dialog', () => {
  it('is the app’s dialog for the Fillet tool, with the F key’s command', () => {
    expect(specForCommand(featureDialogs(), 'fillet')?.type).toBe('fillet');
  });

  it('starts with one set; the next set shows once this one has edges', () => {
    const empty = defaultValues(filletDialog);
    expect(shownFields(filletDialog, empty).map((f) => f.name)).toEqual([
      'edges',
      'radius',
      'variable',
    ]);
    const some: DialogValues = mergeValues(empty, { refs: { edges: [edgeRef(3)] } });
    expect(shownFields(filletDialog, some).map((f) => f.name)).toEqual([
      'edges',
      'radius',
      'variable',
      'edges2',
    ]);
    const two: DialogValues = mergeValues(some, { refs: { edges2: [edgeRef(4)] } });
    expect(shownFields(filletDialog, two).map((f) => f.name)).toEqual([
      'edges',
      'radius',
      'variable',
      'edges2',
      'radius2',
      'variable2',
      'edges3',
    ]);
    // Emptying the first set doesn't drop the second one's fields.
    const gap: DialogValues = mergeValues(empty, { refs: { edges2: [edgeRef(4)] } });
    expect(shownFields(filletDialog, gap).map((f) => f.name)).toContain('radius2');
  });

  it('has room for the feature’s maximum number of sets', () => {
    const edges = filletDialog.fields.filter((f) => f.kind === 'selection');
    expect(edges).toHaveLength(FILLET_MAX_SETS);
  });

  it('picking an edge brings its tangent chain, and unpicking it takes the chain out', async () => {
    const t = setup();
    t.controller.start('fillet');
    expect(t.open()?.pickField).toBe('edges');
    t.controller.select.onClick(edgeItem(1), false);
    // The pick is there at once; the chain follows the kernel's answer.
    expect(t.open()?.values.refs.edges?.map((r) => r.id)).toEqual(['box:e1']);
    await settle();
    expect(t.asked).toEqual([1]);
    expect(
      t
        .open()
        ?.values.refs.edges?.map((r) => r.id)
        .sort(),
    ).toEqual(['box:e0', 'box:e1', 'box:e2']);
    // An edge that stands alone is just itself.
    t.controller.select.onClick(edgeItem(5), false);
    await settle();
    expect(t.open()?.values.refs.edges).toHaveLength(4);
    // Unpicking a chain member removes the whole chain.
    t.controller.select.onClick(edgeItem(2), false);
    await settle();
    expect(t.open()?.values.refs.edges?.map((r) => r.id)).toEqual(['box:e5']);
  });

  it('takes the chain of the edge selected before the tool started', async () => {
    const t = setup();
    t.session.getState().select([edgeItem(0)]);
    t.controller.start('fillet');
    await settle();
    expect(t.open()?.values.refs.edges).toHaveLength(3);
  });

  it('makes the feature’s inputs: one per shown field, hidden sets left out; OK inserts it', async () => {
    const t = setup();
    t.controller.start('fillet');
    t.controller.select.onClick(edgeItem(5), false);
    await settle();
    t.controller.setExpr('radius', '2 mm');
    t.controller.pickInto('edges2');
    t.controller.select.onClick(edgeItem(6), false);
    await settle();
    t.controller.setExpr('radius2', '0.5 mm');
    const inputs = t.open()?.draft.inputs ?? {};
    // The next set's empty field is shown, so it is an (empty) input; later sets are hidden.
    expect(Object.keys(inputs).sort()).toEqual(['edges', 'edges2', 'edges3', 'radius', 'radius2']);
    expect(FilletInputsSchema.safeParse(inputs).success).toBe(true);
    expect(filletSets(inputs as never).map((s) => [s.n, s.edges.length, s.radius])).toEqual([
      [1, 1, 'radius'],
      [2, 1, 'radius2'],
    ]);
    expect(t.controller.ok()).toBe(true);
    const fillet = t.store.getState().doc.features.at(-1);
    expect(fillet?.type).toBe('fillet');
    expect(fillet?.name).toBe('Fillet1');
    expect(fillet?.inputs.radius2).toMatchObject({ kind: 'expr', expr: '0.5 mm', unit: 'length' });
  });

  it('refuses OK with no edges', () => {
    const t = setup();
    t.controller.start('fillet');
    expect(t.open()?.checked.fields).toEqual({ edges: 'Pick edges.' });
    expect(t.controller.ok()).toBe(false);
  });
});

describe('the fillet dialog’s variable radius', () => {
  it('shows the end radius and the swap while Variable is on, and hides them again', () => {
    const picked: DialogValues = mergeValues(defaultValues(filletDialog), {
      refs: { edges: [edgeRef(3)] },
    });
    expect(shownFields(filletDialog, picked).map((f) => f.name)).not.toContain('radiusEnd');
    const variable: DialogValues = mergeValues(picked, { toggles: { variable: true } });
    expect(shownFields(filletDialog, variable).map((f) => f.name)).toEqual([
      'edges',
      'radius',
      'variable',
      'radiusEnd',
      'swap',
      'edges2',
    ]);
    const back = mergeValues(variable, { toggles: { variable: false } });
    expect(shownFields(filletDialog, back).map((f) => f.name)).not.toContain('radiusEnd');
    // The labels of a later set carry its number, as the others do.
    expect(filletDialog.fields.filter((f) => /[^0-9]2$/.test(f.name)).map((f) => f.label)).toEqual([
      'Edges 2',
      'Radius 2',
      'Variable 2',
      'End radius 2',
      'Swap ends 2',
    ]);
  });

  it('makes an end radius and a swap input, and no variable one', async () => {
    const t = setup();
    t.controller.start('fillet');
    t.controller.select.onClick(edgeItem(5), false);
    await settle();
    t.controller.setExpr('radius', '2 mm');
    t.controller.setToggle('variable', true);
    t.controller.setExpr('radiusEnd', '5 mm');
    t.controller.setToggle('swap', true);
    const inputs = t.open()?.draft.inputs ?? {};
    // `edges2` is the next set's empty field, which shows once this one has edges.
    expect(Object.keys(inputs).sort()).toEqual(['edges', 'edges2', 'radius', 'radiusEnd', 'swap']);
    expect(FilletInputsSchema.safeParse(inputs).success).toBe(true);
    expect(filletSets(inputs as never).map((s) => [s.n, s.radius, s.radiusEnd, s.swap])).toEqual([
      [1, 'radius', 'radiusEnd', true],
    ]);
    expect(t.controller.ok()).toBe(true);
    const fillet = t.store.getState().doc.features.at(-1);
    expect(fillet?.inputs.radiusEnd).toMatchObject({ kind: 'expr', expr: '5 mm', unit: 'length' });
    expect(fillet?.inputs.swap).toEqual({ kind: 'bool', value: true });
  });

  it('turning Variable off drops the end radius and the swap again', async () => {
    const t = setup();
    t.controller.start('fillet');
    t.controller.select.onClick(edgeItem(5), false);
    await settle();
    t.controller.setExpr('radius', '2 mm');
    t.controller.setToggle('variable', true);
    t.controller.setExpr('radiusEnd', '5 mm');
    t.controller.setToggle('swap', true);
    expect(Object.keys(t.open()?.draft.inputs ?? {}).sort()).toContain('radiusEnd');
    t.controller.setToggle('variable', false);
    const inputs = t.open()?.draft.inputs ?? {};
    expect(Object.keys(inputs).sort()).toEqual(['edges', 'edges2', 'radius']);
    expect(filletSets(inputs as never)[0]?.radiusEnd).toBeUndefined();
  });

  it('opens a stored variable fillet with Variable on', () => {
    const t = setup();
    t.store.getState().dispatch(
      insertFeature({
        feature: {
          id: 'F1' as FeatureId,
          type: 'fillet',
          name: 'Fillet1',
          suppressed: false,
          inputs: filletInputs([{ edges: [edgeRef(3)], radius: '2 mm', radiusEnd: '5 mm' }]),
        },
      }),
    );
    t.controller.start('fillet');
    t.controller.edit('F1' as FeatureId);
    const values = t.open()?.values;
    expect(values?.toggles.variable).toBe(true);
    expect(values?.exprs.radiusEnd).toBe('5 mm');
    const shown = shownFields(filletDialog, values as DialogValues).map((f) => f.name);
    expect(shown).toContain('radiusEnd');
    // The stored radius and end radius come back; the swap shows now, off, so it
    // joins the inputs.
    const inputs = t.open()?.draft.inputs ?? {};
    expect(Object.keys(inputs).sort()).toEqual(['edges', 'edges2', 'radius', 'radiusEnd', 'swap']);
    expect(inputs.radius).toMatchObject({ expr: '2 mm' });
    expect(inputs.radiusEnd).toMatchObject({ expr: '5 mm' });
    expect(inputs.swap).toEqual({ kind: 'bool', value: false });
  });

  it('opens a stored constant fillet with Variable off', () => {
    const t = setup();
    t.store.getState().dispatch(
      insertFeature({
        feature: {
          id: 'F1' as FeatureId,
          type: 'fillet',
          name: 'Fillet1',
          suppressed: false,
          inputs: filletInputs([{ edges: [edgeRef(3)], radius: '2 mm' }]),
        },
      }),
    );
    t.controller.start('fillet');
    t.controller.edit('F1' as FeatureId);
    expect(t.open()?.values.toggles.variable).toBe(false);
    expect(Object.keys(t.open()?.draft.inputs ?? {}).sort()).toEqual(['edges', 'edges2', 'radius']);
  });
});

describe('the fillet dialog’s radius handle', () => {
  const edges = namedBoxEdgesMesh();
  const bodies = { [BOX]: edges };
  /** Set 1's first edge: the box's top front edge, between the top and front faces. */
  const topFront = { kind: 'edge' as const, id: edges.edgeIds?.[2] as string };
  const withEdge = (over: Partial<DialogValues> = {}): DialogValues =>
    mergeValues(defaultValues(filletDialog), { refs: { edges: [topFront] }, ...over });

  const handles = (values: DialogValues) =>
    (
      filletDialog.manipulators?.(values, {
        doc: setupDialogs().store.getState().doc,
        bodies,
        value: () => 2,
      }) ?? []
    ).map((m) => (m.kind === 'distance' ? { field: m.field, origin: m.origin } : m));

  it('is one distance handle on the set’s first edge, at its middle', () => {
    expect(handles(withEdge())).toEqual([{ field: 'radius', origin: [5, 0, 10] }]);
    expect(filletDialog.manipulators).toBeDefined();
  });

  it('has two where the set tapers: Radius at the chain’s start, End radius at its end', () => {
    const variable = withEdge({ toggles: { variable: true }, exprs: { radiusEnd: '5 mm' } });
    expect(handles(variable)).toEqual([
      { field: 'radius', origin: [0, 0, 10] },
      { field: 'radiusEnd', origin: [10, 0, 10] },
    ]);
    // Swapped, the End radius is where the round starts.
    const swapped = withEdge({
      toggles: { variable: true, swap: true },
      exprs: { radiusEnd: '5 mm' },
    });
    expect(handles(swapped)).toEqual([
      { field: 'radiusEnd', origin: [0, 0, 10] },
      { field: 'radius', origin: [10, 0, 10] },
    ]);
  });

  it('gives every set with edges its own, named after its fields', () => {
    const at = (i: number) => ({ kind: 'edge' as const, id: edges.edgeIds?.[i] as string });
    const three = mergeValues(defaultValues(filletDialog), {
      refs: { edges: [topFront], edges2: [at(7)], edges3: [at(3)] },
    });
    expect(handles(three)).toEqual([
      { field: 'radius', origin: [5, 0, 10] },
      { field: 'radius2', origin: [10, 5, 10] },
      { field: 'radius3', origin: [5, 10, 10] },
    ]);
    // A set without edges draws nothing, and a later set with some still does.
    const gap = mergeValues(defaultValues(filletDialog), { refs: { edges3: [at(3)] } });
    expect(handles(gap)).toEqual([{ field: 'radius3', origin: [5, 10, 10] }]);
  });

  it('draws a set’s arrow quietly and lets its pick field and toggles make it active', () => {
    const all =
      filletDialog.manipulators?.(withEdge(), {
        doc: setupDialogs().store.getState().doc,
        bodies,
        value: () => 2,
      }) ?? [];
    const first = all[0];
    expect(first?.kind === 'distance' && first.quiet).toBe(true);
    expect(first?.kind === 'distance' && first.follows).toEqual(['edges', 'variable', 'swap']);
  });

  it('is nothing until an edge is picked', () => {
    expect(handles(defaultValues(filletDialog))).toEqual([]);
  });
});
