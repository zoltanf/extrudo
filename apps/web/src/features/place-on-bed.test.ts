import { PlaceOnBedInputsSchema } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { placeOnBedDialog } from './place-on-bed';
import { featureDialogs, specForCommand } from './registry';
import { FACE_IDS, faceItem, setupDialogs } from './testing';

describe('the Place on Bed dialog', () => {
  it('is the app’s dialog for the Place on Bed tool', () => {
    expect(specForCommand(featureDialogs(), 'placeOnBed')?.type).toBe('placeOnBed');
  });

  it('takes one face', () => {
    expect(placeOnBedDialog.fields).toHaveLength(1);
    expect(placeOnBedDialog.fields[0]).toMatchObject({
      kind: 'selection',
      name: 'face',
      accepts: ['face'],
      max: 1,
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
