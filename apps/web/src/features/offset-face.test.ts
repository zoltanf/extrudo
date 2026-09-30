import { OffsetFaceInputsSchema, offsetFaceSettings } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { meshSurfaceFrame } from './geometry';
import { offsetFaceDialog, offsetManipulators } from './offset-face';
import { featureDialogs, specForCommand } from './registry';
import type { ManipulatorContext } from './spec';
import { BOX, FACE_IDS, namedBoxMesh, settle, setupDialogs } from './testing';
import { defaultValues, mergeValues } from './values';

const faceItem = (index: number) => ({ kind: 'face' as const, id: `${BOX}:${index}` });
const faceRef = (index: number) => ({ kind: 'face' as const, id: FACE_IDS[index] as string });

/** The fake box's smooth chains: faces 2 and 3 run into each other, the rest stand alone. */
function chains(face: number): number[] {
  return face === 2 || face === 3 ? [2, 3] : [face];
}

function setup() {
  const t = setupDialogs([offsetFaceDialog]);
  const asked: { index: number; kind: string | undefined }[] = [];
  t.kernel.tangentChain = async (_body, index, _base, kind) => {
    asked.push({ index, kind });
    return chains(index);
  };
  return { ...t, asked };
}

describe('the offset face dialog', () => {
  it('is the app’s dialog for the Offset Face tool', () => {
    expect(specForCommand(featureDialogs(), 'offsetFace')?.type).toBe('offsetFace');
    expect(offsetFaceDialog.category).toBe('modify');
  });

  it('needs a face, then makes valid inputs the kernel reads', async () => {
    const t = setup();
    t.controller.start('offsetFace');
    expect(t.open()?.pickField).toBe('faces');
    expect(t.open()?.checked.fields).toEqual({ faces: 'Pick faces.' });
    expect(t.controller.ok()).toBe(false);
    t.controller.select.onClick(faceItem(1), false);
    await settle();
    t.controller.setExpr('distance', '-3 mm');
    const inputs = t.open()?.draft.inputs ?? {};
    expect(Object.keys(inputs).sort()).toEqual(['distance', 'faces']);
    expect(OffsetFaceInputsSchema.safeParse(inputs).success).toBe(true);
    expect(offsetFaceSettings(inputs as never).faces.map((r) => r.id)).toEqual([FACE_IDS[1]]);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature?.type).toBe('offsetFace');
    expect(feature?.name).toBe('Offset Face1');
    expect(feature?.inputs.distance).toMatchObject({ kind: 'expr', expr: '-3 mm', unit: 'length' });
  });

  it('takes the faces selected before the tool opens, and their smooth chains', async () => {
    const t = setup();
    t.session.getState().select([faceItem(2)]);
    t.controller.start('offsetFace');
    await settle();
    // Face 3 runs smoothly into face 2, so it comes along; the kernel was asked about faces.
    expect(t.open()?.values.refs.faces?.map((r) => r.id)).toEqual([FACE_IDS[2], FACE_IDS[3]]);
    expect(t.asked).toEqual([{ index: 2, kind: 'face' }]);
    expect(t.controller.ok()).toBe(true);
  });

  it('unpicking a face takes its chain out', async () => {
    const t = setup();
    t.controller.start('offsetFace');
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    expect(t.open()?.values.refs.faces).toHaveLength(2);
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    expect(t.open()?.values.refs.faces ?? []).toEqual([]);
  });

  it('reads an edited offset back', async () => {
    const t = setup();
    t.controller.start('offsetFace');
    t.controller.select.onClick(faceItem(1), false);
    await settle();
    t.controller.setExpr('distance', '4 mm');
    expect(t.controller.ok()).toBe(true);
    const id = t.store.getState().doc.features.at(-1)?.id;
    t.controller.edit(id as never);
    expect(t.open()?.values.exprs.distance).toBe('4 mm');
    expect(t.open()?.values.refs.faces?.map((r) => r.id)).toEqual([FACE_IDS[1]]);
  });
});

describe('the offset arrow', () => {
  const ctx = { doc: undefined, bodies: { [BOX]: namedBoxMesh() }, value: () => 2 };

  it('stands on the face and points along its outward normal', () => {
    const values = mergeValues(defaultValues(offsetFaceDialog), {
      refs: { faces: [faceRef(1)] },
    });
    const [arrow] = offsetManipulators(values, ctx as unknown as ManipulatorContext);
    expect(arrow).toMatchObject({ kind: 'distance', field: 'distance' });
    // The box's top: the centre (5, 5, 10) and the normal +Z.
    expect(arrow?.kind === 'distance' && arrow.origin).toEqual([5, 5, 10]);
    expect(arrow?.kind === 'distance' && arrow.direction).toEqual([0, 0, 1]);
  });

  it('has none until a face is picked', () => {
    expect(
      offsetManipulators(defaultValues(offsetFaceDialog), ctx as unknown as ManipulatorContext),
    ).toEqual([]);
  });

  it('stands on the surface for a curved face, where the mean normal means nothing', () => {
    // A strip of a "cylinder": four nodes round a z axis, normals pointing out, two triangles
    // that face opposite ways, so the mean normal is nearly nothing.
    const mesh = {
      positions: new Float32Array([1, 0, 0, 1, 0, 1, -1, 0, 0, -1, 0, 1, 0, 1, 0, 0, 1, 1]),
      normals: new Float32Array([1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, 0, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 2, 1, 3, 4, 5, 0]),
      faceRanges: new Uint32Array([0, 3]),
    } as never;
    const frame = meshSurfaceFrame(mesh, 0);
    expect(frame).toBeDefined();
    const n = frame?.normal ?? [0, 0, 0];
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5);
  });
});
