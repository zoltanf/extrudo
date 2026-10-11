import {
  addJoint,
  createDocument,
  createDocumentStore,
  createModelStore,
  type ExtrudoDocument,
  type JointId,
  removeJoint,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { createViewportStore } from '../viewport/store';
import { followJointPose } from './followPose';

const J = 'j1' as JointId;
const joint = {
  id: J,
  name: 'Hinge',
  type: 'revolute',
  a: { component: 'leaf', ref: { kind: 'axis', id: 'origin:x' } },
  b: { component: 'base', ref: { kind: 'axis', id: 'origin:x' } },
} as never;

function setup() {
  const doc: ExtrudoDocument = {
    ...createDocument(),
    components: [
      { id: 'leaf', name: 'Leaf' },
      { id: 'base', name: 'Base' },
    ],
  } as never;
  const store = createDocumentStore(doc);
  const model = createModelStore<unknown>();
  const viewport = createViewportStore({
    preferences: memoryPreferences(),
    reducedMotion: () => true,
  });
  store.getState().dispatch(addJoint({ joint }));
  model.getState().computed({ features: {}, bodies: {}, joints: { [J]: { status: 'ok' } } });
  const stop = followJointPose(store, model, viewport);
  return { store, model, viewport, stop };
}

describe('followJointPose', () => {
  it('keeps a pose of an ok joint', () => {
    const { viewport } = setup();
    viewport.getState().setJointPose({ joint: J, value: 30 });
    expect(viewport.getState().jointPose).toEqual({ joint: J, value: 30 });
  });

  it('clears the pose when the joint is deleted (the undo of New Joint)', () => {
    const { store, viewport } = setup();
    viewport.getState().setJointPose({ joint: J, value: 30 });
    store.getState().dispatch(removeJoint({ ids: [J] }));
    expect(viewport.getState().jointPose).toBeUndefined();
  });

  it('clears the pose when the joint stops resolving ok', () => {
    const { model, viewport } = setup();
    viewport.getState().setJointPose({ joint: J, value: 30 });
    model.getState().computed({ features: {}, bodies: {}, joints: { [J]: { status: 'error' } } });
    expect(viewport.getState().jointPose).toBeUndefined();
  });

  it('refuses a pose on a joint that does not exist', () => {
    const { viewport } = setup();
    viewport.getState().setJointPose({ joint: 'nope' as JointId, value: 3 });
    expect(viewport.getState().jointPose).toBeUndefined();
  });
});
