import {
  type FeatureId,
  insertFeature,
  RemoveInputsSchema,
  removeBodiesFeatureOf,
  removedBodies,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { featureDialogs, specForCommand } from './registry';
import { REMOVE_BODIES_COMMAND, removeDialog } from './remove';
import { BOX, setupDialogs } from './testing';

const body = (id: string) => ({ kind: 'body' as const, id });

describe('the remove dialog (P3-17)', () => {
  it('is registered for Remove features, with a command of its own', () => {
    const dialogs = featureDialogs();
    expect(dialogs.get('remove')).toBe(removeDialog);
    expect(specForCommand(dialogs, REMOVE_BODIES_COMMAND)?.type).toBe('remove');
  });

  it('edits which bodies an existing Remove takes out, as one undo step', () => {
    const t = setupDialogs([removeDialog]);
    const id = 'rm' as FeatureId;
    t.store
      .getState()
      .dispatch(insertFeature({ feature: removeBodiesFeatureOf(id, 'Remove1', [BOX]), index: 1 }));
    expect(t.controller.edit(id)).toBe(true);
    expect(t.open()?.values.refs.bodies).toEqual([body(BOX)]);
    t.controller.setRefs('bodies', [body(BOX), body('other:0')]);
    expect(RemoveInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.find((f) => f.id === id);
    expect(feature && removedBodies(feature)).toEqual([BOX, 'other:0']);
    t.store.getState().undo();
    const back = t.store.getState().doc.features.find((f) => f.id === id);
    expect(back && removedBodies(back)).toEqual([BOX]);
  });

  it('needs a body; pre-selected bodies fill it when started from its command', () => {
    const t = setupDialogs([removeDialog]);
    t.controller.start('remove');
    expect(t.open()?.checked.fields).toMatchObject({ bodies: 'Pick bodies to remove.' });
    t.controller.cancel();
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('remove');
    expect(t.open()?.values.refs.bodies).toEqual([body(BOX)]);
    expect(t.controller.ok()).toBe(true);
    expect(t.store.getState().doc.features.at(-1)).toMatchObject({
      type: 'remove',
      name: 'Remove1',
    });
  });
});
