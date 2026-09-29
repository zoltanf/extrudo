import { FILLET_MAX_SETS, FilletInputsSchema, filletSets } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { filletDialog } from './fillet';
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
    expect(shownFields(filletDialog, empty).map((f) => f.name)).toEqual(['edges', 'radius']);
    const some: DialogValues = mergeValues(empty, { refs: { edges: [edgeRef(3)] } });
    expect(shownFields(filletDialog, some).map((f) => f.name)).toEqual([
      'edges',
      'radius',
      'edges2',
    ]);
    const two: DialogValues = mergeValues(some, { refs: { edges2: [edgeRef(4)] } });
    expect(shownFields(filletDialog, two).map((f) => f.name)).toEqual([
      'edges',
      'radius',
      'edges2',
      'radius2',
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
