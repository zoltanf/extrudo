import { PlaceOnBedInputsSchema } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { placeOnBedDialog } from './place-on-bed';
import { featureDialogs, specForCommand } from './registry';
import { FACE_IDS, faceItem, setupDialogs } from './testing';

describe('the Place on Bed dialog', () => {
  it('is the app’s dialog for the Place on Bed tool', () => {
    expect(specForCommand(featureDialogs(), 'placeOnBed')?.type).toBe('placeOnBed');
  });

  it('takes faces (one per body), a spin angle and carried bodies', () => {
    expect(placeOnBedDialog.fields).toHaveLength(3);
    expect(placeOnBedDialog.fields[0]).toMatchObject({
      kind: 'selection',
      name: 'face',
      accepts: ['face'],
    });
    expect(placeOnBedDialog.fields[0]).not.toHaveProperty('max');
    expect(placeOnBedDialog.fields[1]).toMatchObject({
      kind: 'expression',
      name: 'spin',
      unit: 'angle',
    });
    expect(placeOnBedDialog.fields[2]).toMatchObject({
      kind: 'selection',
      name: 'carry',
      accepts: ['body'],
      min: 0,
    });
  });

  it('stores the carry only when a body is picked (ADR-0081 §3)', () => {
    const t = setupDialogs([placeOnBedDialog]);
    t.session.getState().select([faceItem(1)]);
    t.controller.start('placeOnBed');
    expect(t.open()?.draft.inputs).not.toHaveProperty('carry');
    t.controller.setRefs('carry', [{ kind: 'body', id: 'box:0' }]);
    expect(t.open()?.draft.inputs.carry).toEqual({
      kind: 'ref',
      refs: [{ kind: 'body', id: 'box:0' }],
    });
  });

  it('puts two picked faces and the spin into the feature', () => {
    const t = setupDialogs([placeOnBedDialog]);
    t.session.getState().select([faceItem(1), faceItem(2)]);
    t.controller.start('placeOnBed');
    expect(t.open()?.values.refs.face).toHaveLength(2);
    t.controller.setExpr('spin', '30 deg');
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature?.inputs).toMatchObject({
      face: { refs: [{ id: FACE_IDS[1] }, { id: FACE_IDS[2] }] },
      spin: { expr: '30 deg', unit: 'angle' },
    });
  });

  it('starts with a selected face picked, and OK inserts the feature (one undo step)', () => {
    const t = setupDialogs([placeOnBedDialog]);
    t.session.getState().select([faceItem(1)]);
    t.controller.start('placeOnBed');
    expect(t.open()?.values.refs.face).toEqual([
      expect.objectContaining({ kind: 'face', id: FACE_IDS[1] }),
    ]);
    expect(PlaceOnBedInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'placeOnBed', name: 'Place on Bed1' });
    t.store.getState().undo();
    expect(t.store.getState().doc.features.some((f) => f.type === 'placeOnBed')).toBe(false);
  });

  it('refuses OK without a face', () => {
    const t = setupDialogs([placeOnBedDialog]);
    t.controller.start('placeOnBed');
    expect(t.controller.ok()).toBe(false);
  });
});
