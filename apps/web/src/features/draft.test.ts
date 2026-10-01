import { DraftInputsSchema, draftSettings, originPlaneRef } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { draftDialog, draftManipulators } from './draft';
import { featureDialogs, specForCommand } from './registry';
import type { ManipulatorContext } from './spec';
import { BOX, FACE_IDS, faceItem, namedBoxMesh, settle, setupDialogs } from './testing';
import { defaultValues, mergeValues } from './values';

const faceRef = (index: number) => ({ kind: 'face' as const, id: FACE_IDS[index] as string });

function setup() {
  const t = setupDialogs([draftDialog]);
  const asked: { index: number; kind: string | undefined }[] = [];
  t.kernel.tangentChain = async (_body, index, _base, kind) => {
    asked.push({ index, kind });
    return [index];
  };
  return { ...t, asked };
}

describe('the draft dialog', () => {
  it('is the app’s dialog for the Draft tool, a modify feature', () => {
    expect(specForCommand(featureDialogs(), 'draft')?.type).toBe('draft');
    expect(draftDialog.category).toBe('modify');
  });

  it('needs faces and a neutral plane, then makes valid inputs the kernel reads', async () => {
    const t = setup();
    t.controller.start('draft');
    expect(t.open()?.pickField).toBe('faces');
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    // Faces follow their smooth chains, as the kernel drafts them.
    expect(t.asked).toEqual([{ index: 2, kind: 'face' }]);
    expect(t.controller.ok()).toBe(false);
    t.controller.setRefs('plane', [originPlaneRef('origin:xy')]);
    t.controller.setExpr('angle', '5 deg');
    t.controller.setToggle('flip', true);
    const inputs = t.open()?.draft.inputs ?? {};
    expect(DraftInputsSchema.safeParse(inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'draft', name: 'Draft1' });
    expect(feature?.inputs.angle).toMatchObject({ kind: 'expr', expr: '5 deg', unit: 'angle' });
    expect(draftSettings(feature?.inputs as never)).toMatchObject({
      faces: [{ kind: 'face', id: FACE_IDS[2] }],
      plane: originPlaneRef('origin:xy'),
      flip: true,
    });
  });

  it('defaults to 3 degrees, not flipped', () => {
    const values = defaultValues(draftDialog);
    expect(values.exprs.angle).toBe('3 deg');
    expect(values.toggles.flip).toBe(false);
  });
});

describe('the draft angle arc', () => {
  const ctx = {
    doc: undefined,
    bodies: { [BOX]: namedBoxMesh() },
    value: () => 3,
  } as unknown as ManipulatorContext;
  const withPicks = (flip = false) =>
    mergeValues(defaultValues(draftDialog), {
      refs: { faces: [faceRef(2)], plane: [originPlaneRef('origin:xy')] },
      toggles: { flip },
    });

  it('stands where the face meets the plane and starts along the pull, turning inwards', () => {
    const [arc] = draftManipulators(withPicks(), ctx);
    // The box's front face looks along -Y; its centre (5, 0, 5) dropped onto XY.
    expect(arc).toMatchObject({
      kind: 'angle',
      field: 'angle',
      origin: [5, 0, 0],
      zero: [0, 0, 1],
    });
    // Turning +Z about the axis by a positive angle heads into the box (+Y).
    expect(arc?.kind === 'angle' && arc.axis).toEqual([-1, 0, 0]);
  });

  it('follows Flip: the pull and the turn reverse', () => {
    const [arc] = draftManipulators(withPicks(true), ctx);
    expect(arc).toMatchObject({ zero: [0, 0, -1] });
    expect(arc?.kind === 'angle' && arc.axis).toEqual([1, 0, 0]);
  });

  it('has none until a face and a plane are picked, or for a face parallel to the plane', () => {
    expect(draftManipulators(defaultValues(draftDialog), ctx)).toEqual([]);
    const top = mergeValues(withPicks(), { refs: { faces: [faceRef(1)] } });
    expect(draftManipulators(top, ctx)).toEqual([]);
  });
});
