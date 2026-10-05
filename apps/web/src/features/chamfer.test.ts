import {
  CHAMFER_MAX_SETS,
  ChamferInputsSchema,
  chamferInputs,
  chamferSets,
  type FeatureId,
  insertFeature,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { chamferDialog } from './chamfer';
import { featureDialogs, specForCommand } from './registry';
import type { DialogValues } from './spec';
import { BOX, faceItem, settle, setupDialogs } from './testing';
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
      'face',
      'distance',
      'distanceB',
      'flip',
    ]);
    expect(names(mergeValues(empty, { choices: { mode: 'distance-angle' } }))).toEqual([
      'edges',
      'mode',
      'face',
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
      'face2',
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
    const edgeFields = chamferDialog.fields.filter(
      (f) => f.kind === 'selection' && /^edges\d*$/.test(f.name),
    );
    expect(edgeFields).toHaveLength(CHAMFER_MAX_SETS);
    // A reference face field of its own in every set (P4-12).
    expect(
      chamferDialog.fields.filter((f) => f.kind === 'selection' && /^face\d*$/.test(f.name)),
    ).toHaveLength(CHAMFER_MAX_SETS);
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
    // `face` is a shown field of set 2's type, so it is an empty ref input;
    // set 1 is equal-distance, which has no reference face.
    expect(Object.keys(inputs).sort()).toEqual([
      'distance',
      'distance2',
      'distanceB2',
      'edges',
      'edges2',
      'edges3',
      'face2',
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

describe('the chamfer dialog’s reference face', () => {
  it('shows it under the type for the two unequal types, and the flip goes while one is picked', () => {
    const empty = defaultValues(chamferDialog);
    const unequal = mergeValues(empty, { choices: { mode: 'two-distances' } });
    expect(names(unequal)).toEqual(['edges', 'mode', 'face', 'distance', 'distanceB', 'flip']);
    // A picked face decides, so there is no flip to disagree with it.
    const withFace = mergeValues(unequal, { refs: { face: [{ kind: 'face', id: 'box:top' }] } });
    expect(names(withFace)).toEqual(['edges', 'mode', 'face', 'distance', 'distanceB']);
    expect(withFace.refs.face).toEqual([{ kind: 'face', id: 'box:top' }]);
    // Back to equal distance: there is no face to name at all.
    expect(names(mergeValues(withFace, { choices: { mode: 'equal' } }))).toEqual([
      'edges',
      'mode',
      'distance',
    ]);
  });

  it('a picked face replaces the flip in the inputs, and the flip comes back without it', async () => {
    const t = setup();
    t.controller.start('chamfer');
    t.controller.select.onClick(edgeItem(5), false);
    await settle();
    t.controller.setChoice('mode', 'two-distances');
    t.controller.setExpr('distance', '2 mm');
    t.controller.setExpr('distanceB', '5 mm');
    t.controller.setToggle('flip', true);
    t.controller.pickInto('face');
    t.controller.select.onClick(faceItem(1), false);
    expect(t.open()?.values.refs.face).toEqual([{ kind: 'face', id: 'box:top' }]);
    const inputs = t.open()?.draft.inputs ?? {};
    expect(inputs.face).toEqual({ kind: 'ref', refs: [{ kind: 'face', id: 'box:top' }] });
    // The flip is hidden, so it is no input: the face decides alone.
    expect(inputs.flip).toBeUndefined();
    expect(chamferSets(inputs as never)[0]?.face).toEqual({ kind: 'face', id: 'box:top' });
    t.controller.select.onClick(faceItem(1), false);
    expect(t.open()?.values.refs.face).toEqual([]);
    expect(t.open()?.draft.inputs.flip).toEqual({ kind: 'bool', value: true });
  });

  it('opens a stored chamfer with its reference face, and the flip hidden', async () => {
    const t = setup();
    t.store.getState().dispatch(
      insertFeature({
        feature: {
          id: 'C1' as FeatureId,
          type: 'chamfer',
          name: 'Chamfer1',
          suppressed: false,
          inputs: chamferInputs([
            {
              edges: [edgeRef(5)],
              mode: 'two-distances',
              distance: '2 mm',
              distanceB: '5 mm',
              face: { kind: 'face', id: 'box:top' },
            },
          ]),
        },
      }),
    );
    t.controller.edit('C1' as FeatureId);
    const values = t.open()?.values as DialogValues;
    expect(values.refs.face).toEqual([{ kind: 'face', id: 'box:top' }]);
    expect(names(values)).toEqual(['edges', 'mode', 'face', 'distance', 'distanceB', 'edges2']);
    // Set 2's empty edges field shows, so it is an empty input; the flip does not.
    expect(Object.keys(t.open()?.draft.inputs ?? {}).sort()).toEqual([
      'distance',
      'distanceB',
      'edges',
      'edges2',
      'face',
      'mode',
    ]);
  });
});
