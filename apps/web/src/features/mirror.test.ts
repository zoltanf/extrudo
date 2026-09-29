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
      'bodies',
      'plane',
      'copy',
      'join',
    ]);
    const moved = mergeValues(values, { toggles: { copy: false } });
    expect(shownFields(mirrorDialog, moved).map((f) => f.name)).toEqual([
      'bodies',
      'plane',
      'copy',
    ]);
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
