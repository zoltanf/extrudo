import {
  addComponent,
  type ComponentId,
  createDocument,
  createDocumentStore,
  createSessionStore,
  type Feature,
  type FeatureId,
  removeComponent,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { followComponentSession, withActiveComponent } from './active';

const cid = (id: string) => id as ComponentId;
const feature = (component?: ComponentId): Feature => ({
  id: 'f1' as FeatureId,
  type: 'box',
  name: 'Box1',
  suppressed: false,
  inputs: {},
  ...(component !== undefined && { component }),
});

describe('withActiveComponent', () => {
  it('stamps the active component', () => {
    const session = createSessionStore();
    session.getState().activateComponent(cid('c1'));
    expect(withActiveComponent(feature(), session).component).toBe('c1');
  });

  it('leaves a feature alone with none active', () => {
    const session = createSessionStore();
    const f = feature();
    expect(withActiveComponent(f, session)).toBe(f);
  });

  it('keeps a stamp that is already there', () => {
    const session = createSessionStore();
    session.getState().activateComponent(cid('c1'));
    expect(withActiveComponent(feature(cid('c2')), session).component).toBe('c2');
  });
});

describe('followComponentSession', () => {
  it('clears the active and isolated component when the document loses it', () => {
    const store = createDocumentStore(createDocument());
    const session = createSessionStore();
    store.getState().dispatch(addComponent({ id: cid('c1'), name: 'Lid' }));
    const stop = followComponentSession(store, session);
    session.getState().activateComponent(cid('c1'));
    session.getState().isolateComponent(cid('c1'));
    store.getState().dispatch(removeComponent({ id: cid('c1') }));
    expect(session.getState()).toMatchObject({
      activeComponent: undefined,
      isolatedComponent: undefined,
    });
    stop();
  });

  it('clears after an undo of addComponent', () => {
    const store = createDocumentStore(createDocument());
    const session = createSessionStore();
    followComponentSession(store, session);
    store.getState().dispatch(addComponent({ id: cid('c1'), name: 'Lid' }));
    session.getState().activateComponent(cid('c1'));
    store.getState().undo();
    expect(session.getState().activeComponent).toBeUndefined();
  });
});
