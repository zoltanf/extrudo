import { addJoint, type Joint, type JointId, removeComponent } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { createJointActions } from './jointActions';
import { BASE, LEAF, setupJoints } from './testing';

const hinge: Joint = {
  id: 'j1' as JointId,
  name: 'Hinge',
  type: 'revolute',
  a: { component: LEAF, ref: { kind: 'face', id: 'hole' } },
  b: { component: BASE, ref: { kind: 'face', id: 'pin' } },
};

function setup() {
  const t = setupJoints();
  t.store.getState().dispatch(addJoint({ joint: hinge }));
  const actions = createJointActions(
    { store: t.store, model: t.model, dialog: t.dialog },
    t.notify,
  );
  return { ...t, actions };
}

describe('createJointActions', () => {
  it('renames, refusing a clash with a message', () => {
    const { store, notify, actions } = setup();
    expect(actions.rename(hinge.id, 'Lid hinge')).toBe(true);
    expect(store.getState().doc.joints?.[0]?.name).toBe('Lid hinge');
    store
      .getState()
      .dispatch(addJoint({ joint: { ...hinge, id: 'j2' as JointId, name: 'Other' } }));
    expect(actions.rename(hinge.id, 'other')).toBe(false);
    expect(notify).toHaveBeenCalledWith('error', 'There is already a joint named Other.');
  });

  it('suppresses and deletes, one step each', () => {
    const { store, actions } = setup();
    actions.setSuppressed([hinge.id], true);
    expect(store.getState().doc.joints?.[0]?.suppressed).toBe(true);
    actions.remove([hinge.id]);
    expect(store.getState().doc.joints).toBeUndefined();
    store.getState().undo();
    expect(store.getState().doc.joints?.[0]?.suppressed).toBe(true);
  });

  it("keeps the kernel's closest match", () => {
    const { store, model, actions } = setup();
    const now = { kind: 'face' as const, id: 'hole#1' };
    model.getState().computed({
      features: {},
      bodies: model.getState().bodies,
      joints: {
        [hinge.id]: {
          status: 'warning',
          refs: [{ ref: { kind: 'face', id: 'hole' }, state: 'guessed', now }],
        },
      },
    });
    actions.keepClosestMatch(hinge.id);
    expect(store.getState().doc.joints?.[0]?.a.ref).toEqual(now);
  });

  it('opens the dialog only with two components', () => {
    const { store, notify, actions, dialog } = setup();
    actions.edit(hinge.id);
    expect(dialog.state.getState().open?.mode).toBe('edit');
    dialog.cancel();
    store.getState().dispatch(removeComponent({ id: BASE }));
    actions.start();
    expect(dialog.state.getState().open).toBeUndefined();
    expect(notify).toHaveBeenCalledWith('info', 'Make two components first.');
  });
});
