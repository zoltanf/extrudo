import { CHAMFER_MAX_SETS, ChamferInputsSchema, chamferSets } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { chamferDialog } from './chamfer';
import { featureDialogs, specForCommand } from './registry';
import type { DialogValues } from './spec';
import { BOX, settle, setupDialogs } from './testing';
import { defaultValues, mergeValues, shownFields } from './values';

const edgeItem = (index: number) => ({ kind: 'edge' as const, id: `${BOX}:${index}` });
const edgeRef = (index: number) => ({ kind: 'edge' as const, id: `box:e${index}` });

/** The tangent chains of the fake box: edges 0-1-2 are one chain, the rest stand alone. */
function chains(index: number): number[] {
  return [0, 1, 2].includes(index) ? [0, 1, 2] : [index];
}

function setup() {
  const t = setupDialogs([chamferDialog]);
  const asked: number[] = [];
  t.kernel.tangentChain = async (_body, edge) => {
    asked.push(edge);
    return chains(edge);
  };
  return { ...t, asked };
}

const names = (values: DialogValues) => shownFields(chamferDialog, values).map((f) => f.name);

describe('the chamfer dialog', () => {
  it('is the app’s dialog for the Chamfer tool', () => {
    expect(specForCommand(featureDialogs(), 'chamfer')?.type).toBe('chamfer');
  });

  it('shows the fields of the set’s type', () => {
    const empty = defaultValues(chamferDialog);
    expect(names(empty)).toEqual(['edges', 'mode', 'distance']);
    expect(names(mergeValues(empty, { choices: { mode: 'two-distances' } }))).toEqual([
      'edges',
      'mode',
      'distance',
      'distanceB',
      'flip',
    ]);
    expect(names(mergeValues(empty, { choices: { mode: 'distance-angle' } }))).toEqual([
      'edges',
      'mode',
      'distance',
      'angle',
      'flip',
    ]);
  });

  it('shows the next set once this one has edges, with its own type', () => {
    const empty = defaultValues(chamferDialog);
    const some = mergeValues(empty, { refs: { edges: [edgeRef(3)] } });
    expect(names(some)).toEqual(['edges', 'mode', 'distance', 'edges2']);
    const two = mergeValues(some, {
      refs: { edges2: [edgeRef(4)] },
      choices: { mode2: 'distance-angle' },
    });
    expect(names(two)).toEqual([
      'edges',
      'mode',
      'distance',
      'edges2',
      'mode2',
      'distance2',
      'angle2',
      'flip2',
      'edges3',
    ]);
    // Emptying the first set doesn't drop the second one's fields.
    const gap = mergeValues(empty, { refs: { edges2: [edgeRef(4)] } });
    expect(names(gap)).toContain('distance2');
  });

  it('has room for the feature’s maximum number of sets', () => {
    expect(chamferDialog.fields.filter((f) => f.kind === 'selection')).toHaveLength(
      CHAMFER_MAX_SETS,
    );
  });

  it('picking an edge brings its tangent chain, and unpicking it takes the chain out', async () => {
    const t = setup();
    t.controller.start('chamfer');
    expect(t.open()?.pickField).toBe('edges');
    t.controller.select.onClick(edgeItem(1), false);
    await settle();
    expect(t.asked).toEqual([1]);
    expect(
      t
        .open()
        ?.values.refs.edges?.map((r) => r.id)
        .sort(),
    ).toEqual(['box:e0', 'box:e1', 'box:e2']);
    t.controller.select.onClick(edgeItem(2), false);
    await settle();
    expect(t.open()?.values.refs.edges ?? []).toEqual([]);
  });

  it('makes the feature’s inputs: the shown fields of each set; OK inserts it', async () => {
    const t = setup();
    t.controller.start('chamfer');
    t.controller.select.onClick(edgeItem(5), false);
    await settle();
    t.controller.setExpr('distance', '2 mm');
    t.controller.pickInto('edges2');
    t.controller.select.onClick(edgeItem(6), false);
    await settle();
    t.controller.setChoice('mode2', 'two-distances');
    t.controller.setExpr('distance2', '3 mm');
    t.controller.setExpr('distanceB2', '1 mm');
    t.controller.setToggle('flip2', true);
    const inputs = t.open()?.draft.inputs ?? {};
    expect(Object.keys(inputs).sort()).toEqual([
      'distance',
      'distance2',
      'distanceB2',
      'edges',
      'edges2',
      'edges3',
      'flip2',
      'mode',
      'mode2',
    ]);
    expect(ChamferInputsSchema.safeParse(inputs).success).toBe(true);
    const sets = chamferSets(inputs as never);
    expect(sets.map((s) => [s.n, s.mode, s.edges.length, s.flip])).toEqual([
      [1, 'equal', 1, false],
      [2, 'two-distances', 1, true],
    ]);
    expect(t.controller.ok()).toBe(true);
    const chamfer = t.store.getState().doc.features.at(-1);
    expect(chamfer?.type).toBe('chamfer');
    expect(chamfer?.name).toBe('Chamfer1');
    expect(chamfer?.inputs.distanceB2).toMatchObject({
      kind: 'expr',
      expr: '1 mm',
      unit: 'length',
    });
  });

  it('reads an edited chamfer back with its types', async () => {
    const t = setup();
    t.controller.start('chamfer');
    t.controller.select.onClick(edgeItem(5), false);
    await settle();
    t.controller.setChoice('mode', 'distance-angle');
    t.controller.setExpr('angle', '30 deg');
    expect(t.controller.ok()).toBe(true);
    const id = t.store.getState().doc.features.at(-1)?.id;
    t.controller.edit(id as never);
    const values = t.open()?.values;
    expect(values?.choices.mode).toBe('distance-angle');
    expect(values?.exprs.angle).toBe('30 deg');
  });

  it('refuses OK with no edges', () => {
    const t = setup();
    t.controller.start('chamfer');
    expect(t.open()?.checked.fields).toEqual({ edges: 'Pick edges.' });
    expect(t.controller.ok()).toBe(false);
  });
});
