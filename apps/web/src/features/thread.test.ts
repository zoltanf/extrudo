import { type ExtrudoDocument, newId, ThreadInputsSchema, threadSettings } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { featureDialogs, specForCommand } from './registry';
import type { DialogValues } from './spec';
import { BOX, FACE_IDS, namedBoxMesh, settle, setupDialogs } from './testing';
import { AUTO, presetOf, proposeThread, threadDialog, threadOnChange } from './thread';
import { defaultValues, mergeValues } from './values';

const SHAFT = { kind: 'face' as const, id: 'cylinder:C:side:wall' };

describe('the thread dialog', () => {
  it('is the app’s dialog for the Thread tool, a modify feature that cuts', () => {
    expect(specForCommand(featureDialogs(), 'thread')?.type).toBe('thread');
    expect(threadDialog.category).toBe('modify');
    expect(threadDialog.previewStyle?.(defaultValues(threadDialog))).toBe('cut');
  });

  it('starts sized to fit the face, the whole face, right-handed, 0.1 mm, with a lead-in', () => {
    const values = defaultValues(threadDialog);
    expect(values.choices).toMatchObject({ preset: AUTO, extent: 'full', hand: 'right' });
    expect(values.exprs.tolerance).toBe('0.1 mm');
    expect(values.toggles).toMatchObject({ flip: false, chamfer: true });
  });

  it('stores starts only when they aren’t 1', async () => {
    const t = setupDialogs([threadDialog]);
    t.controller.start('thread');
    t.controller.setRefs('faces', [SHAFT]);
    await settle();
    expect(defaultValues(threadDialog).exprs.starts).toBe('1');
    expect(t.open()?.draft.inputs.starts).toBeUndefined();
    t.controller.setExpr('starts', '2');
    await settle();
    expect(t.open()?.draft.inputs.starts).toMatchObject({ kind: 'expr', expr: '2' });
    expect(threadSettings(t.open()?.draft.inputs as never).starts).toBe(2);
    t.controller.setExpr('starts', '1');
    await settle();
    expect(t.open()?.draft.inputs.starts).toBeUndefined();
  });

  it('stores no size for "fit the face", and the preset’s numbers for a preset', async () => {
    const t = setupDialogs([threadDialog]);
    t.controller.start('thread');
    expect(t.open()?.pickField).toBe('faces');
    t.controller.setRefs('faces', [SHAFT]);
    await settle();
    let inputs = t.open()?.draft.inputs ?? {};
    expect(ThreadInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs.diameter).toBeUndefined();
    expect(inputs.preset).toBeUndefined();
    expect(threadSettings(inputs as never).auto).toBe(true);

    t.controller.setChoice('preset', 'm8');
    await settle();
    inputs = t.open()?.draft.inputs ?? {};
    expect(inputs.diameter).toMatchObject({ kind: 'expr', expr: '8 mm' });
    expect(inputs.pitch).toMatchObject({ kind: 'expr', expr: '1.25 mm' });
    t.controller.setChoice('extent', 'length');
    t.controller.setExpr('length', '6 mm');
    t.controller.setChoice('hand', 'left');
    await settle();
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'thread', name: 'Thread1' });
    expect(threadSettings(feature?.inputs as never)).toMatchObject({
      faces: [SHAFT],
      extent: 'length',
      hand: 'left',
      auto: false,
    });
    // Editing it shows the preset again.
    const back = threadDialog.fromInputs?.(feature?.inputs ?? {}, {
      doc: t.store.getState().doc,
      bodies: {},
    });
    expect(back?.choices?.preset).toBe('m8');
  });

  it('refuses a flat face', () => {
    const values = mergeValues(defaultValues(threadDialog), {
      refs: { faces: [{ kind: 'face', id: FACE_IDS[2] as string }] },
    });
    const ctx = { doc: undefined as never, bodies: { [BOX]: namedBoxMesh() } };
    expect(threadDialog.validate?.(values, ctx)).toMatchObject({
      field: 'faces',
      message: expect.stringMatching(/Pick round faces/),
    });
    expect(
      threadDialog.validate?.(mergeValues(values, { refs: { faces: [SHAFT] } }), ctx),
    ).toBeUndefined();
  });
});

describe('thread sizes', () => {
  const values = (exprs: Record<string, string>, preset = 'custom'): DialogValues =>
    mergeValues(defaultValues(threadDialog), { exprs, choices: { preset } });

  it('shows the preset the numbers match', () => {
    expect(presetOf(values({ diameter: '8 mm', pitch: '1.25 mm' }))).toBe('m8');
    expect(presetOf(values({ diameter: '8 mm', pitch: '1 mm' }))).toBe('m8x1');
    expect(presetOf(values({ diameter: '0.25 in', pitch: '1 in / 20' }))).toBe('unc-1q4-20');
    expect(presetOf(values({ diameter: '8 mm', pitch: '1.3 mm' }))).toBe('custom');
  });

  it('fills the numbers from a preset, and goes custom when they change', () => {
    expect(threadOnChange('preset', values({}, 'm5'))).toEqual({
      exprs: { diameter: '5 mm', pitch: '0.8 mm' },
      choices: { preset: 'm5', profile: 'iso' },
    });
    // A trapezoidal preset sets the profile too.
    expect(threadOnChange('preset', values({}, 'tr20x4'))).toEqual({
      exprs: { diameter: '20 mm', pitch: '4 mm' },
      choices: { preset: 'tr20x4', profile: 'trapezoidal' },
    });
    expect(threadOnChange('pitch', values({ diameter: '5 mm', pitch: '0.5 mm' }, 'm5'))).toEqual({
      choices: { preset: 'custom' },
    });
    expect(
      threadOnChange('pitch', values({ diameter: '5 mm', pitch: '0.8 mm' }, 'custom')),
    ).toEqual({
      choices: { preset: 'm5' },
    });
    // A non-ISO profile leaves "fit the face" for custom.
    expect(
      threadOnChange('profile', mergeValues(values({}, AUTO), { choices: { profile: 'bottle' } })),
    ).toEqual({ choices: { preset: 'custom' } });
    expect(threadOnChange('preset', values({}, AUTO))).toBeUndefined();
  });

  it('takes the document’s tolerance parameter when there is one', () => {
    const doc = (names: string[]) =>
      ({
        parameters: names.map((name) => ({
          id: newId(),
          name,
          expression: '0.15 mm',
          unit: 'length',
        })),
      }) as unknown as ExtrudoDocument;
    expect(proposeThread(defaultValues(threadDialog), { doc: doc([]) })).toBeUndefined();
    expect(proposeThread(defaultValues(threadDialog), { doc: doc(['tolerance']) })).toEqual({
      exprs: { tolerance: 'tolerance' },
    });
  });
});
