import { MirrorInputsSchema, mirrorSettings, originPlaneRef } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { mirrorDialog } from './mirror';
import { featureDialogs, specForCommand } from './registry';
import { BOX, setupDialogs } from './testing';
import { defaultValues, mergeValues, shownFields } from './values';

const body = { kind: 'body' as const, id: BOX };

describe('the mirror dialog', () => {
  it('is the app’s dialog for the Mirror tool', () => {
    expect(specForCommand(featureDialogs(), 'mirror')?.type).toBe('mirror');
  });

  it('copies by default, and Join is offered only with a copy', () => {
    const values = defaultValues(mirrorDialog);
    expect(values.toggles.copy).toBe(true);
    expect(shownFields(mirrorDialog, values).map((f) => f.name)).toEqual([
      'objects',
      'bodies',
      'plane',
      'copy',
      'join',
    ]);
    const moved = mergeValues(values, { toggles: { copy: false } });
    expect(shownFields(mirrorDialog, moved).map((f) => f.name)).toEqual([
      'objects',
      'bodies',
      'plane',
      'copy',
    ]);
  });

  it('mirrors features instead of bodies: a feature list, no copy or join', () => {
    const features = mergeValues(defaultValues(mirrorDialog), { choices: { objects: 'features' } });
    expect(shownFields(mirrorDialog, features).map((f) => f.name)).toEqual([
      'objects',
      'features',
      'plane',
    ]);
    const t = setupDialogs([mirrorDialog]);
    t.controller.start('mirror');
    t.controller.setChoice('objects', 'features');
    t.controller.setRefs('plane', [originPlaneRef('origin:yz')]);
    expect(t.controller.ok()).toBe(false);
    t.controller.setRefs('features', [{ kind: 'feature', id: 'e2' }]);
    expect(MirrorInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(mirrorSettings(feature?.inputs as never)).toMatchObject({
      objects: 'features',
      features: [{ kind: 'feature', id: 'e2' }],
      bodies: [],
    });
  });

  it('picks its plane like Create Sketch: the plane field takes planes and flat faces', () => {
    const plane = mirrorDialog.fields.find((f) => f.name === 'plane');
    expect(plane).toMatchObject({ kind: 'selection', accepts: ['plane', 'face'], max: 1 });
  });

  it('makes valid inputs; OK inserts a mirror', () => {
    const t = setupDialogs([mirrorDialog]);
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('mirror');
    expect(t.open()?.values.refs.bodies).toEqual([body]);
    // The plane is the next field to pick.
    expect(t.open()?.pickField).toBe('plane');
    t.controller.setRefs('plane', [originPlaneRef('origin:yz')]);
    t.controller.setToggle('join', true);
    expect(MirrorInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'mirror', name: 'Mirror1' });
    expect(mirrorSettings(feature?.inputs as never)).toMatchObject({ copy: true, join: true });
  });

  it('refuses OK without bodies or a plane', () => {
    const t = setupDialogs([mirrorDialog]);
    t.controller.start('mirror');
    expect(Object.keys(t.open()?.checked.fields ?? {}).sort()).toEqual(['bodies', 'plane']);
    expect(t.controller.ok()).toBe(false);
  });
});
