import { OffsetFaceInputsSchema, offsetFaceSettings } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { meshSurfaceFrame } from './geometry';
import { keptRoundsText, offsetFaceDialog, offsetManipulators } from './offset-face';
import { featureDialogs, specForCommand } from './registry';
import { keptRoundsKey, type ManipulatorContext } from './spec';
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
    expect(Object.keys(inputs).sort()).toEqual(['distance', 'faces', 'keepRounds']);
    expect(inputs.keepRounds).toEqual({ kind: 'bool', value: true });
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

/**
 * The fake box with rounds, as the kernel's `smoothFaces` sees it: faces 2, 3 and 4 run
 * smoothly into each other, 3 is a fillet's round between walls 2 and 4.
 */
function roundsSetup() {
  const t = setup();
  const asked: { faces: number[]; keep: boolean | undefined }[] = [];
  const ROUND = 3;
  const CHAIN = [2, 3, 4];
  t.kernel.smoothFaces = async (_body, faces, _base, keep) => {
    asked.push({ faces: [...faces], keep });
    const out = new Set<number>();
    const rounds = new Set<number>();
    const ordered = [...faces].sort((a, b) => Number(a === ROUND) - Number(b === ROUND));
    for (const face of ordered) {
      if (!CHAIN.includes(face)) out.add(face);
      else if (!keep) for (const f of CHAIN) out.add(f);
      else if (face !== ROUND) {
        out.add(face);
        rounds.add(ROUND);
      } else if (!rounds.has(ROUND)) for (const f of CHAIN) out.add(f);
    }
    return { faces: [...out], rounds: [...rounds].filter((f) => !out.has(f)) };
  };
  const ids = () => t.open()?.values.refs.faces?.map((r) => r.id) ?? [];
  const kept = () => t.open()?.values.labels[keptRoundsKey('faces')] ?? [];
  return { ...t, asked, ids, kept };
}

describe('keep rounds’ radius', () => {
  it('is on for a new offset: a wall is picked without its round, which is counted', async () => {
    const t = roundsSetup();
    t.controller.start('offsetFace');
    expect(t.open()?.values.toggles.keepRounds).toBe(true);
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    expect(t.ids()).toEqual([FACE_IDS[2]]);
    expect(t.kept()).toEqual([FACE_IDS[3]]);
    expect(keptRoundsText(t.open()?.values as never)).toBe('1 round keeps its radius');
    // The kernel was asked with the flag, not for the plain chain.
    expect(t.asked[0]).toEqual({ faces: [2], keep: true });
    // The count is no input.
    expect(Object.keys(t.open()?.draft.inputs ?? {}).sort()).toEqual([
      'distance',
      'faces',
      'keepRounds',
    ]);
    // Unpicking the wall takes the count away.
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    expect(t.ids()).toEqual([]);
    expect(t.kept()).toEqual([]);
  });

  it('a click on the round itself takes the whole chain, as before', async () => {
    const t = roundsSetup();
    t.controller.start('offsetFace');
    t.controller.select.onClick(faceItem(3), false);
    await settle();
    expect(t.ids().sort()).toEqual([FACE_IDS[2], FACE_IDS[3], FACE_IDS[4]].sort());
    expect(t.kept()).toEqual([]);
  });

  it('turned off picks the whole chain again and stores false; on again drops the round', async () => {
    const t = roundsSetup();
    t.controller.start('offsetFace');
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    t.controller.setToggle('keepRounds', false);
    await settle();
    expect(t.ids().sort()).toEqual([FACE_IDS[2], FACE_IDS[3], FACE_IDS[4]].sort());
    expect(t.kept()).toEqual([]);
    expect(t.open()?.draft.inputs.keepRounds).toEqual({ kind: 'bool', value: false });
    t.controller.setToggle('keepRounds', true);
    await settle();
    // The round goes; the wall past it, picked while off, stays picked.
    expect(t.ids().sort()).toEqual([FACE_IDS[2], FACE_IDS[4]].sort());
    expect(t.kept()).toEqual([FACE_IDS[3]]);
    expect(t.open()?.draft.inputs.keepRounds).toEqual({ kind: 'bool', value: true });
  });

  it('an offset saved before the option opens with it off, picks and all', async () => {
    const t = roundsSetup();
    t.controller.start('offsetFace');
    t.controller.setToggle('keepRounds', false);
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    // Stored as an older Extrudo did: no keepRounds.
    const { keepRounds: _, ...old } = feature?.inputs ?? {};
    t.store.setState((s) => ({
      doc: {
        ...s.doc,
        features: s.doc.features.map((f) => (f.id === feature?.id ? { ...f, inputs: old } : f)),
      },
    }));
    t.controller.edit(feature?.id as never);
    await settle();
    expect(t.open()?.values.toggles.keepRounds).toBe(false);
    expect(t.ids().sort()).toEqual([FACE_IDS[2], FACE_IDS[3], FACE_IDS[4]].sort());
    expect(t.kept()).toEqual([]);
    expect(t.open()?.draft.inputs.keepRounds).toEqual({ kind: 'bool', value: false });
  });

  it('an edited offset with the option counts its kept rounds', async () => {
    const t = roundsSetup();
    t.controller.start('offsetFace');
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    expect(t.controller.ok()).toBe(true);
    t.controller.edit(t.store.getState().doc.features.at(-1)?.id as never);
    expect(t.kept()).toEqual([]);
    await settle();
    expect(t.open()?.values.toggles.keepRounds).toBe(true);
    expect(t.ids()).toEqual([FACE_IDS[2]]);
    expect(t.kept()).toEqual([FACE_IDS[3]]);
  });

  it('words the count', () => {
    const at = (n: number) =>
      keptRoundsText(
        mergeValues(defaultValues(offsetFaceDialog), {
          labels: { [keptRoundsKey('faces')]: Array.from({ length: n }, (_, i) => `r${i}`) },
        }),
      );
    expect(at(1)).toBe('1 round keeps its radius');
    expect(at(2)).toBe('2 rounds keep their radius');
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
