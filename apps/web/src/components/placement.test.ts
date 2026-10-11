import { addComponent, type BodyId, type ComponentId, type FeatureId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { moveDialog } from '../features/move';
import { placeOnBedDialog } from '../features/place-on-bed';
import { settle, setupDialogs } from '../features/testing';
import { copyComponentSpec, createPlacementActions } from './placement';

const BOX = 'box:0' as BodyId;
const cid = (id: string) => id as ComponentId;

function setup() {
  const t = setupDialogs([moveDialog, placeOnBedDialog]);
  t.store.getState().dispatch(addComponent({ id: cid('c1'), name: 'Lid', bodies: [BOX] }));
  const notify = (...args: [string, string]) => t.messages.push(`${args[0]}: ${args[1]}`);
  const actions = createPlacementActions({
    store: t.store,
    session: t.session,
    dialog: t.controller,
    members: (id) => (id === cid('c1') ? [BOX] : []),
    notify,
  });
  return { ...t, actions, notify };
}

describe('placement actions', () => {
  it('Move Component selects the live members and opens the Move dialog', () => {
    const t = setup();
    t.actions.move(cid('c1'));
    expect(t.session.getState().selection).toEqual([{ kind: 'body', id: BOX }]);
    expect(t.open()?.spec.command).toBe('move');
  });

  it('Copy Component opens Move with the bodies and copy, and OK is one step', async () => {
    const t = setup();
    t.actions.copy(cid('c1'));
    const open = t.open();
    expect(open?.spec.command).toBe('move');
    expect(open?.values.refs.bodies?.map((r) => r.id)).toEqual([BOX]);
    expect(open?.values.toggles.copy).toBe(true);
    await settle();
    expect(t.controller.ok()).toBe(true);
    const doc = t.store.getState().doc;
    const move = doc.features.at(-1);
    expect(move?.type).toBe('move');
    const made = doc.components?.find((c) => c.name === 'Lid (2)');
    expect(made).toBeDefined();
    expect(move?.component).toBe(made?.id);
    // One undo step removes the Move and the component together.
    t.store.getState().undo();
    expect(t.store.getState().doc.features.at(-1)?.type).not.toBe('move');
    expect(t.store.getState().doc.components?.map((c) => c.name)).toEqual(['Lid']);
  });

  it('refuses to copy a component with no bodies', () => {
    const t = setup();
    t.store.getState().dispatch(addComponent({ id: cid('c2'), name: 'Empty' }));
    t.actions.copy(cid('c2'));
    expect(t.messages).toContain('info: Empty has no bodies to copy.');
    expect(t.open()).toBeUndefined();
  });
});

describe('copyComponentSpec', () => {
  it('adds a component named after the original, then stamps the draft', () => {
    const doc = { components: [{ id: cid('c1'), name: 'Lid', visible: true }] };
    const spec = copyComponentSpec(doc, 'Lid', [BOX]);
    const featureId = 'F' as FeatureId;
    const commands =
      spec.commitWith?.(
        { refs: {}, exprs: {}, choices: {}, toggles: {}, labels: {} },
        {
          doc: doc as never,
          featureId,
          bodies: {},
        },
      ) ?? [];
    expect(commands.map((c) => c.type)).toEqual(['component.add', 'component.feature']);
    expect(commands[0]).toMatchObject({ payload: { name: 'Lid (2)' } });
    expect(commands[1]).toMatchObject({ payload: { id: featureId } });
    const added = (commands[0] as { payload: { id: ComponentId } }).payload;
    const stamped = (commands[1] as { payload: { component: ComponentId } }).payload;
    expect(stamped.component).toBe(added.id);
  });
});
