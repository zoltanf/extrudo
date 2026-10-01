import { ScaleInputsSchema, scaleSettings } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { featureDialogs, specForCommand } from './registry';
import { scaleDialog } from './scale';
import { BOX, setupDialogs } from './testing';
import { defaultValues, mergeValues, shownFields } from './values';

describe('the scale dialog', () => {
  it('is the app’s dialog for the Scale tool', () => {
    expect(specForCommand(featureDialogs(), 'scale')?.type).toBe('scale');
  });

  it('shows one factor for a uniform scale and three for a non-uniform one', () => {
    const values = defaultValues(scaleDialog);
    expect(shownFields(scaleDialog, values).map((f) => f.name)).toEqual([
      'bodies',
      'point',
      'mode',
      'factor',
      'copy',
    ]);
    const perAxis = mergeValues(values, { choices: { mode: 'non-uniform' } });
    expect(shownFields(scaleDialog, perAxis).map((f) => f.name)).toEqual([
      'bodies',
      'point',
      'mode',
      'x',
      'y',
      'z',
      'copy',
    ]);
  });

  it('scales the selected bodies about their box centre: no point needed', () => {
    const t = setupDialogs([scaleDialog]);
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('scale');
    t.controller.setExpr('factor', '2');
    expect(ScaleInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'scale', name: 'Scale1' });
    expect(feature?.inputs.factor).toMatchObject({ kind: 'expr', expr: '2', unit: 'unitless' });
    expect(scaleSettings(feature?.inputs as never)).toMatchObject({
      point: undefined,
      mode: 'uniform',
      copy: false,
    });
  });

  it('makes per-axis factors and a copy, and reads them back when edited', () => {
    const t = setupDialogs([scaleDialog]);
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('scale');
    t.controller.setChoice('mode', 'non-uniform');
    t.controller.setExpr('z', '1.5');
    t.controller.setToggle('copy', true);
    const inputs = t.open()?.draft.inputs ?? {};
    // An empty Point is an empty reference list: the kernel scales about the box centre.
    expect(Object.keys(inputs).sort()).toEqual(['bodies', 'copy', 'mode', 'point', 'x', 'y', 'z']);
    expect(t.controller.ok()).toBe(true);
    const id = t.store.getState().doc.features.at(-1)?.id;
    t.controller.edit(id as never);
    expect(t.open()?.values.choices.mode).toBe('non-uniform');
    expect(t.open()?.values.exprs.z).toBe('1.5');
    expect(t.open()?.values.toggles.copy).toBe(true);
  });
});
