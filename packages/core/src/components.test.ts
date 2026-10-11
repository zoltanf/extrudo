import { describe, expect, it } from 'vitest';
import { type Command, CommandError } from './commands';
import {
  addComponent,
  componentMembers,
  componentOfBody,
  copyComponentName,
  effectiveBodyDisplay,
  newComponentName,
  removeComponent,
  renameComponent,
  setBodyComponent,
  setComponentDisplay,
  setFeatureComponent,
  stampOfBody,
} from './components';
import type { BodyId, ComponentId } from './ids';
import { type BodyMeta, type Component, DocumentSchema, type ExtrudoDocument } from './schema';
import { createDocumentStore } from './stores';
import { bid, feature, fid, sampleDocument } from './testing';

const cmp = (id: string) => id as ComponentId;

/**
 * The sample's three features plus a Script S1, two components (Box, Lid) and
 * stored bodies: `f2:0` in Box, `f2:1` loose, `f3:0` in Lid. Extrude f2 is
 * stamped Box, the Script Lid.
 */
function designWithComponents(): ExtrudoDocument {
  const doc = sampleDocument();
  return {
    ...doc,
    features: [
      ...doc.features.map((f) => (f.id === 'f2' ? { ...f, component: cmp('box') } : f)),
      { ...feature('S1', 'script', 'Script1'), component: cmp('lid') },
    ],
    timelineMarker: 4,
    components: [
      { id: cmp('box'), name: 'Box', visible: true },
      { id: cmp('lid'), name: 'Lid', visible: true },
    ],
    bodies: {
      [bid('f2:0')]: { name: 'Body1', visible: true, component: cmp('box') },
      [bid('f2:1')]: { name: 'Body2', visible: true },
      [bid('f3:0')]: { name: 'Body3', visible: true, component: cmp('lid') },
    },
  };
}

function storeOf(doc: ExtrudoDocument) {
  return createDocumentStore(doc);
}

/** Dispatches `command` and checks one undo restores the document exactly. */
function roundTrip(doc: ExtrudoDocument, command: Command<unknown>): ExtrudoDocument {
  const store = storeOf(doc);
  store.getState().dispatch(command);
  const after = store.getState().doc;
  expect(DocumentSchema.safeParse(after).success).toBe(true);
  store.getState().undo();
  expect(store.getState().doc).toEqual(doc);
  store.getState().redo();
  expect(store.getState().doc).toEqual(after);
  return after;
}

function refused(doc: ExtrudoDocument, command: Command<unknown>): string {
  const store = storeOf(doc);
  try {
    store.getState().dispatch(command);
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    expect(store.getState().doc).toBe(doc);
    return (error as Error).message;
  }
  throw new Error('the command was not refused');
}

describe('componentOfBody (ADR-0081 §2)', () => {
  const doc = designWithComponents();

  it('takes stored metadata over the feature stamp', () => {
    expect(componentOfBody(doc, bid('f3:0'))).toBe('lid');
    // f2 is stamped Box, but the stored loose body stays loose.
    expect(componentOfBody(doc, bid('f2:1'))).toBeUndefined();
    expect(componentOfBody(doc, bid('f2:0'))).toBe('box');
  });

  it('gives an unstored body its feature stamp', () => {
    expect(componentOfBody(doc, bid('f2:7'))).toBe('box');
    expect(componentOfBody(doc, bid('f1:0'))).toBeUndefined();
  });

  it('gives a piece the component of the body it broke off, through two levels', () => {
    const origins = { [bid('f3:5')]: bid('f3:4'), [bid('f3:4')]: bid('f3:0') };
    expect(componentOfBody(doc, bid('f3:5'), origins)).toBe('lid');
    // Without origins the piece follows its feature, which has no stamp.
    expect(componentOfBody(doc, bid('f3:5'))).toBeUndefined();
  });

  it('gives a cycle in origins no component', () => {
    const origins = { [bid('x:1')]: bid('x:2'), [bid('x:2')]: bid('x:1') };
    expect(componentOfBody(doc, bid('x:1'), origins)).toBeUndefined();
  });

  it("gives a script's generated feature's body the Script's stamp", () => {
    expect(componentOfBody(doc, bid('S1.f1:0'))).toBe('lid');
    expect(stampOfBody(doc, bid('S1.f1:0'))).toBe('lid');
  });

  it('gives a body of an unknown feature no component', () => {
    expect(componentOfBody(doc, bid('nope:0'))).toBeUndefined();
    expect(componentOfBody(doc, bid('plain'))).toBeUndefined();
  });

  it('stampOfBody ignores stored metadata', () => {
    expect(stampOfBody(doc, bid('f2:1'))).toBe('box');
    expect(stampOfBody(doc, bid('f3:0'))).toBeUndefined();
  });
});

describe('componentMembers', () => {
  it('lists components in order, empty ones too, then the loose bodies; dead bodies are not listed', () => {
    const doc = designWithComponents();
    const withEmpty = {
      ...doc,
      components: [...(doc.components ?? []), { id: cmp('seal'), name: 'Seal', visible: true }],
    };
    const live: BodyId[] = [bid('f3:0'), bid('f2:1'), bid('f2:0'), bid('f2:9'), bid('f1:0')];
    expect(componentMembers(withEmpty, live)).toEqual({
      components: [
        { id: 'box', bodies: ['f2:0', 'f2:9'] },
        { id: 'lid', bodies: ['f3:0'] },
        { id: 'seal', bodies: [] },
      ],
      loose: ['f2:1', 'f1:0'],
    });
  });

  it('lists every body loose in a design without components', () => {
    const doc = sampleDocument();
    expect(componentMembers(doc, [bid('f2:0')])).toEqual({ components: [], loose: ['f2:0'] });
  });
});

describe('component names', () => {
  const named = (...names: string[]) => ({
    components: names.map((name, i) => ({ id: cmp(`c${i}`), name, visible: true })),
  });

  it('newComponentName takes the lowest free number', () => {
    expect(newComponentName({})).toBe('Component1');
    expect(newComponentName(named('Component1', 'component3'))).toBe('Component2');
    expect(newComponentName(named('Component1', 'COMPONENT2'))).toBe('Component3');
  });

  it('copyComponentName gives (2), then (3) when (2) is taken, case-insensitively', () => {
    expect(copyComponentName(named('Lid'), 'Lid')).toBe('Lid (2)');
    expect(copyComponentName(named('Lid', 'lid (2)'), 'Lid')).toBe('Lid (3)');
  });
});

describe('effectiveBodyDisplay', () => {
  const body: Record<string, BodyMeta> = {
    shown: { name: 'B', visible: true },
    ghost: { name: 'B', visible: false, ghost: true },
    hidden: { name: 'B', visible: false },
  };
  const component: Record<string, Component> = {
    shown: { id: cmp('c'), name: 'C', visible: true },
    ghost: { id: cmp('c'), name: 'C', visible: false, ghost: true },
    hidden: { id: cmp('c'), name: 'C', visible: false },
  };
  const table: [component: string, body: string, drawn: string][] = [
    ['shown', 'shown', 'shown'],
    ['shown', 'ghost', 'ghost'],
    ['shown', 'hidden', 'hidden'],
    ['ghost', 'shown', 'ghost'],
    ['ghost', 'ghost', 'ghost'],
    ['ghost', 'hidden', 'hidden'],
    ['hidden', 'shown', 'hidden'],
    ['hidden', 'ghost', 'hidden'],
    ['hidden', 'hidden', 'hidden'],
  ];
  it.each(table)('a %s component with a %s body draws it %s', (c, b, drawn) => {
    expect(effectiveBodyDisplay(body[b], component[c])).toBe(drawn);
  });

  it('a body with no component or no metadata follows its own state', () => {
    expect(effectiveBodyDisplay(body.ghost, undefined)).toBe('ghost');
    expect(effectiveBodyDisplay(undefined, undefined)).toBe('shown');
    expect(effectiveBodyDisplay(undefined, component.ghost)).toBe('ghost');
  });
});

describe('addComponent', () => {
  it('appends a component with the next free name and puts the listed bodies in it', () => {
    const doc = designWithComponents();
    const after = roundTrip(
      doc,
      addComponent({ id: cmp('new'), bodies: [bid('f2:1'), bid('f9:0')] }),
    );
    expect(after.components?.at(-1)).toEqual({ id: 'new', name: 'Component1', visible: true });
    expect(after.bodies[bid('f2:1')]).toEqual({ name: 'Body2', visible: true, component: 'new' });
    // A body with no metadata is named as followBodyNames would name it.
    expect(after.bodies[bid('f9:0')]).toEqual({ name: 'Body4', visible: true, component: 'new' });
  });

  it('takes a trimmed name and creates the list in a design without components', () => {
    const after = roundTrip(sampleDocument(), addComponent({ id: cmp('c1'), name: '  Lid ' }));
    expect(after.components).toEqual([{ id: 'c1', name: 'Lid', visible: true }]);
    const store = storeOf(sampleDocument());
    store.getState().dispatch(addComponent({ id: cmp('c1') }));
    expect(store.getState().undoLabel).toBe('New component');
  });

  it('refuses an empty, a too long or a taken name, and a taken ID', () => {
    const doc = designWithComponents();
    expect(refused(doc, addComponent({ id: cmp('x'), name: '  ' }))).toBe(
      "The name can't be empty.",
    );
    expect(refused(doc, addComponent({ id: cmp('x'), name: 'a'.repeat(101) }))).toMatch(
      /at most 100 characters/,
    );
    expect(refused(doc, addComponent({ id: cmp('x'), name: 'lid' }))).toBe(
      'There is already a component named Lid.',
    );
    expect(refused(doc, addComponent({ id: cmp('box') }))).toMatch(/already exists/);
  });
});

describe('renameComponent', () => {
  it('renames, allowing its own name in another case', () => {
    const doc = designWithComponents();
    expect(
      roundTrip(doc, renameComponent({ id: cmp('lid'), name: 'Cap' })).components?.[1],
    ).toEqual({ id: 'lid', name: 'Cap', visible: true });
    expect(
      roundTrip(doc, renameComponent({ id: cmp('lid'), name: 'LID' })).components?.[1]?.name,
    ).toBe('LID');
  });

  it("refuses another component's name and an unknown component", () => {
    const doc = designWithComponents();
    expect(refused(doc, renameComponent({ id: cmp('lid'), name: 'box' }))).toBe(
      'There is already a component named Box.',
    );
    expect(refused(doc, renameComponent({ id: cmp('nope'), name: 'X' }))).toMatch(/doesn't exist/);
  });
});

describe('removeComponent', () => {
  it('removes the record and clears every body and feature stamp naming it', () => {
    const doc = designWithComponents();
    const after = roundTrip(doc, removeComponent({ id: cmp('box') }));
    expect(after.components).toEqual([{ id: 'lid', name: 'Lid', visible: true }]);
    expect(after.bodies[bid('f2:0')]).toEqual({ name: 'Body1', visible: true });
    expect(after.features.find((f) => f.id === 'f2')?.component).toBeUndefined();
    expect('component' in (after.features.find((f) => f.id === 'f2') ?? {})).toBe(false);
    // Lid's stamps stay.
    expect(after.bodies[bid('f3:0')]?.component).toBe('lid');
    expect(after.features.find((f) => f.id === 'S1')?.component).toBe('lid');
  });

  it('drops the key with the last component', () => {
    const doc = designWithComponents();
    const once = roundTrip(doc, removeComponent({ id: cmp('box') }));
    const twice = roundTrip(once, removeComponent({ id: cmp('lid') }));
    expect('components' in twice).toBe(false);
    expect(Object.values(twice.bodies).some((m) => 'component' in m)).toBe(false);
  });

  it('refuses an unknown component', () => {
    expect(refused(designWithComponents(), removeComponent({ id: cmp('nope') }))).toMatch(
      /doesn't exist/,
    );
  });
});

describe('setBodyComponent', () => {
  it('moves bodies into a component, naming one with no metadata', () => {
    const doc = designWithComponents();
    const command = setBodyComponent({ ids: [bid('f2:0'), bid('f7:0')], component: cmp('lid') });
    expect(command.label).toBe('Move to component');
    const after = roundTrip(doc, command);
    expect(after.bodies[bid('f2:0')]?.component).toBe('lid');
    expect(after.bodies[bid('f7:0')]).toEqual({ name: 'Body4', visible: true, component: 'lid' });
  });

  it('takes bodies out of their component with null', () => {
    const doc = designWithComponents();
    const command = setBodyComponent({ ids: [bid('f3:0'), bid('f8:0')], component: null });
    expect(command.label).toBe('Remove from component');
    const after = roundTrip(doc, command);
    expect(after.bodies[bid('f3:0')]).toEqual({ name: 'Body3', visible: true });
    expect(after.bodies[bid('f8:0')]).toBeUndefined();
  });

  it('refuses an unknown component', () => {
    expect(
      refused(
        designWithComponents(),
        setBodyComponent({ ids: [bid('f2:0')], component: cmp('x') }),
      ),
    ).toMatch(/doesn't exist/);
  });
});

describe('setComponentDisplay', () => {
  it('keeps the ghost pair rule and labels the step', () => {
    const doc = designWithComponents();
    const ghost = setComponentDisplay({ ids: [cmp('box'), cmp('lid')], display: 'ghost' });
    expect(ghost.label).toBe('Ghost components');
    const ghosted = roundTrip(doc, ghost);
    expect(ghosted.components?.[0]).toEqual({
      id: 'box',
      name: 'Box',
      visible: false,
      ghost: true,
    });
    const hide = setComponentDisplay({ ids: [cmp('box')], display: 'hidden' });
    expect(hide.label).toBe('Hide component');
    const hidden = roundTrip(ghosted, hide);
    expect(hidden.components?.[0]).toEqual({ id: 'box', name: 'Box', visible: false });
    const shown = roundTrip(ghosted, setComponentDisplay({ ids: [cmp('lid')], display: 'shown' }));
    expect(shown.components?.[1]).toEqual({ id: 'lid', name: 'Lid', visible: true });
  });

  it('refuses an unknown component', () => {
    expect(
      refused(designWithComponents(), setComponentDisplay({ ids: [cmp('x')], display: 'hidden' })),
    ).toMatch(/doesn't exist/);
  });
});

describe('setFeatureComponent', () => {
  it('sets and clears a stamp', () => {
    const doc = designWithComponents();
    const set = roundTrip(doc, setFeatureComponent({ id: fid('f1'), component: cmp('lid') }));
    expect(set.features[0]?.component).toBe('lid');
    const cleared = roundTrip(set, setFeatureComponent({ id: fid('f1'), component: null }));
    expect('component' in (cleared.features[0] ?? {})).toBe(false);
  });

  it('refuses an unknown component or feature', () => {
    const doc = designWithComponents();
    expect(refused(doc, setFeatureComponent({ id: fid('f1'), component: cmp('x') }))).toMatch(
      /Component x doesn't exist/,
    );
    expect(refused(doc, setFeatureComponent({ id: fid('nope'), component: null }))).toMatch(
      /Feature nope doesn't exist/,
    );
  });
});
