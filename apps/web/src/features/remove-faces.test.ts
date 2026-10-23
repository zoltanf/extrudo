import { RemoveFacesInputsSchema } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { featureDialogs, specForCommand } from './registry';
import { pickedFacesText, removeFacesDialog } from './remove-faces';
import { BOX, FACE_IDS, settle, setupDialogs } from './testing';
import { defaultValues, mergeValues } from './values';

const faceItem = (index: number) => ({ kind: 'face' as const, id: `${BOX}:${index}` });

/** The fake box's pick groups: a click on 2 takes 2 and 3, the rest stand alone. */
function setup() {
  const t = setupDialogs([removeFacesDialog]);
  const asked: number[][] = [];
  t.kernel.removeFacesPick = async (_body, faces) => {
    asked.push([...faces]);
    const out = new Set<number>();
    for (const face of faces) {
      out.add(face);
      if (face === 2) out.add(3);
    }
    return [...out];
  };
  return { ...t, asked };
}

describe('the remove faces dialog', () => {
  it('is the app’s dialog for the Remove Faces tool', () => {
    expect(specForCommand(featureDialogs(), 'removeFaces')?.type).toBe('removeFaces');
    expect(removeFacesDialog.category).toBe('modify');
  });

  it('needs a face, then makes valid inputs the kernel reads', async () => {
    const t = setup();
    t.controller.start('removeFaces');
    expect(t.open()?.pickField).toBe('faces');
    expect(t.open()?.checked.fields).toEqual({ faces: 'Pick faces.' });
    expect(t.controller.ok()).toBe(false);
    t.controller.select.onClick(faceItem(1), false);
    await settle();
    const inputs = t.open()?.draft.inputs ?? {};
    expect(Object.keys(inputs)).toEqual(['faces']);
    expect(RemoveFacesInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs.faces).toMatchObject({ kind: 'ref', refs: [{ kind: 'face', id: FACE_IDS[1] }] });
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature?.type).toBe('removeFaces');
    expect(feature?.name).toBe('Remove Faces1');
  });

  it('a click takes the pick rule’s group; the count line words it', async () => {
    const t = setup();
    t.controller.start('removeFaces');
    expect(t.open()?.values.labels.picked ?? []).toEqual([]);
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    // The click on the round's one face took face 3 with it, no duplicates.
    expect(t.open()?.values.refs.faces?.map((r) => r.id)).toEqual([FACE_IDS[2], FACE_IDS[3]]);
    expect(t.asked).toEqual([[2]]);
    expect(pickedFacesText(t.open()?.values as never)).toBe('2 faces');
    // The count line fills no input.
    expect(Object.keys(t.open()?.draft.inputs ?? {})).toEqual(['faces']);
  });

  it('one face on its own counts "1 face"', async () => {
    const t = setup();
    t.controller.start('removeFaces');
    t.controller.select.onClick(faceItem(1), false);
    await settle();
    expect(t.open()?.values.refs.faces).toHaveLength(1);
    expect(pickedFacesText(t.open()?.values as never)).toBe('1 face');
  });

  it('unpicking a face takes its group out', async () => {
    const t = setup();
    t.controller.start('removeFaces');
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    expect(t.open()?.values.refs.faces).toHaveLength(2);
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    expect(t.open()?.values.refs.faces ?? []).toEqual([]);
    expect(t.asked).toEqual([[2], [2]]);
  });

  it('a second click adds another group; clicking a picked face unpicks its group', async () => {
    const t = setup();
    t.controller.start('removeFaces');
    t.controller.select.onClick(faceItem(2), false);
    await settle();
    // Another face on its own: its group is itself, the union grows.
    t.controller.select.onClick(faceItem(4), false);
    await settle();
    expect(t.open()?.values.refs.faces?.map((r) => r.id)).toEqual([
      FACE_IDS[2],
      FACE_IDS[3],
      FACE_IDS[4],
    ]);
    expect(t.asked).toEqual([[2], [4]]);
    // Clicking 3 (picked through 2) takes its group out: 3 alone; 4 stays.
    t.controller.select.onClick(faceItem(3), false);
    await settle();
    expect(t.open()?.values.refs.faces?.map((r) => r.id)).toEqual([FACE_IDS[2], FACE_IDS[4]]);
  });

  it('words the count', () => {
    const at = (n: number) =>
      pickedFacesText(
        mergeValues(defaultValues(removeFacesDialog), {
          refs: { faces: Array.from({ length: n }, (_, i) => ({ kind: 'face', id: `f${i}` })) },
        }),
      );
    expect(at(1)).toBe('1 face');
    expect(at(3)).toBe('3 faces');
  });
});
