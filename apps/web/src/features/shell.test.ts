import { ShellInputsSchema, shellSettings } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { featureDialogs, specForCommand } from './registry';
import { shellDialog } from './shell';
import type { DialogValues } from './spec';
import { BOX, FACE_IDS, settle, setupDialogs } from './testing';
import { defaultValues, mergeValues, shownFields } from './values';

const faceItem = (index: number) => ({ kind: 'face' as const, id: `${BOX}:${index}` });
const faceRef = (index: number) => ({ kind: 'face' as const, id: FACE_IDS[index] as string });

const names = (values: DialogValues) => shownFields(shellDialog, values).map((f) => f.name);

describe('the shell dialog', () => {
  it('is the app’s dialog for the Shell tool', () => {
    expect(specForCommand(featureDialogs(), 'shell')?.type).toBe('shell');
  });

  it('shows the Body field while no face is picked, or while a body is', () => {
    const empty = defaultValues(shellDialog);
    expect(names(empty)).toEqual(['faces', 'bodies', 'thickness', 'direction']);
    const withFace = mergeValues(empty, { refs: { faces: [faceRef(1)] } });
    expect(names(withFace)).toEqual(['faces', 'thickness', 'direction']);
    const withBody = mergeValues(withFace, { refs: { bodies: [{ kind: 'body', id: BOX }] } });
    expect(names(withBody)).toEqual(['faces', 'bodies', 'thickness', 'direction']);
  });

  it('needs a face or a body, and then makes valid inputs the kernel reads', async () => {
    const t = setupDialogs([shellDialog]);
    t.controller.start('shell');
    expect(t.open()?.pickField).toBe('faces');
    expect(t.open()?.checked.fields).toEqual({
      faces: 'Pick a face to remove, or a body to hollow out.',
    });
    expect(t.controller.ok()).toBe(false);
    t.controller.select.onClick(faceItem(1), false);
    await settle();
    t.controller.setExpr('thickness', '1.5 mm');
    t.controller.setChoice('direction', 'outside');
    const inputs = t.open()?.draft.inputs ?? {};
    expect(Object.keys(inputs).sort()).toEqual(['direction', 'faces', 'thickness']);
    expect(ShellInputsSchema.safeParse(inputs).success).toBe(true);
    const settings = shellSettings(inputs as never);
    expect(settings.faces.map((r) => r.id)).toEqual([FACE_IDS[1]]);
    expect(settings.direction).toBe('outside');
    expect(t.controller.ok()).toBe(true);
    const shell = t.store.getState().doc.features.at(-1);
    expect(shell?.type).toBe('shell');
    expect(shell?.name).toBe('Shell1');
    expect(shell?.inputs.thickness).toMatchObject({ kind: 'expr', expr: '1.5 mm', unit: 'length' });
  });

  it('takes a body picked before the tool opens and hollows it closed', () => {
    const t = setupDialogs([shellDialog]);
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('shell');
    expect(t.open()?.values.refs.bodies?.map((r) => r.id)).toEqual([BOX]);
    expect(t.open()?.values.refs.faces ?? []).toEqual([]);
    expect(t.open()?.checked.fields).toEqual({});
    expect(shellSettings(t.open()?.draft.inputs as never).bodies).toEqual([BOX]);
    expect(t.controller.ok()).toBe(true);
    expect(t.store.getState().doc.features.at(-1)?.inputs.bodies).toMatchObject({
      kind: 'ref',
      refs: [{ kind: 'body', id: BOX }],
    });
  });

  it('reads an edited shell back', async () => {
    const t = setupDialogs([shellDialog]);
    t.controller.start('shell');
    t.controller.select.onClick(faceItem(1), false);
    await settle();
    t.controller.setExpr('thickness', '3 mm');
    t.controller.setChoice('direction', 'outside');
    expect(t.controller.ok()).toBe(true);
    const id = t.store.getState().doc.features.at(-1)?.id;
    t.controller.edit(id as never);
    const values = t.open()?.values;
    expect(values?.exprs.thickness).toBe('3 mm');
    expect(values?.choices.direction).toBe('outside');
    expect(values?.refs.faces?.map((r) => r.id)).toEqual([FACE_IDS[1]]);
  });
});
