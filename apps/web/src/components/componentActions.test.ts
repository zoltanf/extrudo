import {
  addComponent,
  type BodyId,
  type ComponentId,
  createDocument,
  createDocumentStore,
  createSessionStore,
} from '@extrudo/core';
import { describe, expect, it, vi } from 'vitest';
import { createComponentActions } from './componentActions';

const cid = (id: string) => id as ComponentId;
const bid = (id: string) => id as BodyId;

function setup() {
  const store = createDocumentStore(createDocument());
  const session = createSessionStore();
  const notify = vi.fn();
  store.getState().dispatch(addComponent({ id: cid('c1'), name: 'Lid', bodies: [bid('A:0')] }));
  store.getState().dispatch(addComponent({ id: cid('c2'), name: 'Box' }));
  const actions = createComponentActions(
    { store, session },
    (id) => (id === cid('c1') ? [bid('A:0'), bid('A:1')] : []),
    notify,
  );
  return { store, session, notify, actions };
}

describe('createComponentActions', () => {
  it('select puts every live member into the session selection', () => {
    const { session, actions } = setup();
    actions.select(cid('c1'), 'replace');
    expect(session.getState().selection).toEqual([
      { kind: 'body', id: 'A:0' },
      { kind: 'body', id: 'A:1' },
    ]);
  });

  it('remove is one undo step and says the bodies stay', () => {
    const { store, notify, actions } = setup();
    actions.remove(cid('c1'));
    expect(store.getState().doc.components?.map((c) => c.name)).toEqual(['Box']);
    expect(notify).toHaveBeenCalledWith('info', 'Deleted Lid. Its bodies stay in the design.');
    store.getState().undo();
    expect(store.getState().doc.components?.map((c) => c.name)).toEqual(['Lid', 'Box']);
    expect(store.getState().doc.bodies[bid('A:0')]?.component).toBe('c1');
  });

  it('rename refuses a duplicate with false and a notice', () => {
    const { store, notify, actions } = setup();
    expect(actions.rename(cid('c2'), 'lid')).toBe(false);
    expect(notify).toHaveBeenCalledWith('error', 'There is already a component named Lid.');
    expect(actions.rename(cid('c2'), 'Case')).toBe(true);
    expect(store.getState().doc.components?.[1]?.name).toBe('Case');
  });

  it('setDisplay ghosts and hides components', () => {
    const { store, actions } = setup();
    actions.setDisplay([cid('c1')], 'ghost');
    expect(store.getState().doc.components?.[0]).toMatchObject({ visible: false, ghost: true });
    actions.setDisplay([cid('c1')], 'hidden');
    expect(store.getState().doc.components?.[0]).toEqual({
      id: 'c1',
      name: 'Lid',
      visible: false,
    });
  });

  it('newComponent names it Component1 and returns its ID', () => {
    const { store, actions } = setup();
    const id = actions.newComponent([bid('B:0')]);
    expect(id).toBeDefined();
    const made = store.getState().doc.components?.find((c) => c.id === id);
    expect(made?.name).toBe('Component1');
    expect(store.getState().doc.bodies[bid('B:0')]?.component).toBe(id);
  });
});
