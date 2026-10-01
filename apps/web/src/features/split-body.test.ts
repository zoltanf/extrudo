import { originPlaneRef, SplitBodyInputsSchema, splitBodySettings } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { featureDialogs, specForCommand } from './registry';
import { splitBodyDialog } from './split-body';
import { BOX, setupDialogs } from './testing';
import { defaultValues, shownFields } from './values';

describe('the split body dialog', () => {
  it('is the app’s dialog for the Split Body tool, a modify feature', () => {
    expect(specForCommand(featureDialogs(), 'splitBody')?.type).toBe('splitBody');
    expect(splitBodyDialog.category).toBe('modify');
    expect(shownFields(splitBodyDialog, defaultValues(splitBodyDialog)).map((f) => f.name)).toEqual(
      ['bodies', 'plane', 'keep'],
    );
  });

  it('picks its plane like Create Sketch: planes and flat faces, one of them', () => {
    const plane = splitBodyDialog.fields.find((f) => f.name === 'plane');
    expect(plane).toMatchObject({ kind: 'selection', accepts: ['plane', 'face'], max: 1 });
  });

  it('takes selected bodies, then the plane; OK inserts a split that keeps both sides', () => {
    const t = setupDialogs([splitBodyDialog]);
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('splitBody');
    expect(t.open()?.values.refs.bodies).toEqual([{ kind: 'body', id: BOX }]);
    expect(t.open()?.pickField).toBe('plane');
    expect(t.controller.ok()).toBe(false);
    t.controller.setRefs('plane', [originPlaneRef('origin:yz')]);
    expect(SplitBodyInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'splitBody', name: 'Split Body1' });
    expect(splitBodySettings(feature?.inputs as never)).toMatchObject({
      bodies: [{ kind: 'body', id: BOX }],
      plane: originPlaneRef('origin:yz'),
      keep: 'both',
    });
  });

  it('keeps one side when asked, and reads it back when edited', () => {
    const t = setupDialogs([splitBodyDialog]);
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('splitBody');
    t.controller.setRefs('plane', [originPlaneRef('origin:xy')]);
    t.controller.setChoice('keep', 'below');
    expect(t.controller.ok()).toBe(true);
    const id = t.store.getState().doc.features.at(-1)?.id;
    t.controller.edit(id as never);
    expect(t.open()?.values.choices.keep).toBe('below');
  });
});
