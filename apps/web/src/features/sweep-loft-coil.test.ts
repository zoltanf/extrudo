import {
  CoilInputsSchema,
  coilSettings,
  LoftInputsSchema,
  loftSettings,
  originPlaneRef,
  SweepInputsSchema,
  sweepSettings,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { coilDialog, coilManipulators, proposeCoil } from './coil';
import { loftDialog } from './loft';
import { featureDialogs, specForCommand } from './registry';
import type { ManipulatorContext } from './spec';
import { sweepDialog } from './sweep';
import { BOX, FACE_IDS, namedBoxMesh, setupDialogs } from './testing';
import { defaultValues, mergeValues } from './values';

const profile = (id: string) => ({ kind: 'profile' as const, id });
const curve = (id: string) => ({ kind: 'sketchEntity' as const, id });
const face = (index: number) => ({ kind: 'face' as const, id: FACE_IDS[index] as string });

describe('the sweep, loft and coil dialogs', () => {
  it('are the app’s dialogs for their tools, create features', () => {
    const dialogs = featureDialogs();
    for (const type of ['sweep', 'loft', 'coil']) {
      const spec = specForCommand(dialogs, type);
      expect(spec?.type).toBe(type);
      expect(spec?.category).toBe('create');
    }
  });
});

describe('the sweep dialog', () => {
  it('needs profiles and a path, then makes inputs the kernel reads', () => {
    const t = setupDialogs([sweepDialog]);
    t.controller.start('sweep');
    expect(t.open()?.pickField).toBe('profiles');
    t.controller.setRefs('profiles', [profile('S/r1')]);
    expect(t.controller.ok()).toBe(false);
    t.controller.setRefs('path', [curve('P/l1'), curve('P/a1')]);
    t.controller.setExpr('twist', '45 deg');
    t.controller.setExpr('scale', '0.5');
    const inputs = t.open()?.draft.inputs ?? {};
    expect(SweepInputsSchema.safeParse(inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'sweep', name: 'Sweep1' });
    expect(sweepSettings(feature?.inputs as never)).toMatchObject({
      path: [curve('P/l1'), curve('P/a1')],
      orientation: 'follow',
      twist: 'twist',
      scale: 'scale',
      operation: 'new-body',
    });
  });

  it('hides the twist while the profile stays fixed, so it makes no input', () => {
    const t = setupDialogs([sweepDialog]);
    t.controller.start('sweep');
    t.controller.setRefs('profiles', [profile('S/r1')]);
    t.controller.setRefs('path', [curve('P/l1')]);
    t.controller.setExpr('twist', '45 deg');
    t.controller.setChoice('orientation', 'fixed');
    const inputs = t.open()?.draft.inputs ?? {};
    expect(inputs.twist).toBeUndefined();
    expect(inputs.orientation).toEqual({ kind: 'enum', value: 'fixed' });
  });

  it('proposes a join for a body’s face, a new body for a profile', () => {
    const t = setupDialogs([sweepDialog]);
    t.controller.start('sweep');
    t.controller.setRefs('profiles', [face(1)]);
    expect(t.open()?.values.choices.operation).toBe('join');
    t.controller.setRefs('profiles', [profile('S/r1')]);
    expect(t.open()?.values.choices.operation).toBe('new-body');
  });
});

describe('the loft dialog', () => {
  it('takes sections in order, ruled and closed', () => {
    const t = setupDialogs([loftDialog]);
    t.controller.start('loft');
    t.controller.setRefs('sections', [profile('A/r1')]);
    expect(t.controller.ok()).toBe(false);
    const sections = [profile('A/r1'), profile('B/r1'), { kind: 'point' as const, id: 'Q' }];
    t.controller.setRefs('sections', sections);
    t.controller.setToggle('ruled', true);
    const inputs = t.open()?.draft.inputs ?? {};
    expect(LoftInputsSchema.safeParse(inputs).success).toBe(true);
    expect(loftSettings(inputs as never)).toMatchObject({ sections, ruled: true, closed: false });
    expect(t.controller.ok()).toBe(true);
  });

  it('refuses a closed loft of two sections before the kernel does', () => {
    const t = setupDialogs([loftDialog]);
    t.controller.start('loft');
    t.controller.setRefs('sections', [profile('A/r1'), profile('B/r1')]);
    t.controller.setToggle('closed', true);
    const values = t.open()?.values ?? defaultValues(loftDialog);
    expect(loftDialog.validate?.(values, {} as never)).toEqual({
      field: 'sections',
      message: 'A closed loft needs at least three sections.',
    });
    expect(t.controller.ok()).toBe(false);
  });
});

describe('the coil dialog', () => {
  it('starts on XY with the defaults; the type decides which numbers it stores', () => {
    const t = setupDialogs([coilDialog]);
    t.controller.start('coil');
    expect(t.open()?.values.refs.plane).toEqual([originPlaneRef('origin:xy')]);
    let inputs = t.open()?.draft.inputs ?? {};
    expect(CoilInputsSchema.safeParse(inputs).success).toBe(true);
    expect(Object.keys(inputs)).toEqual(expect.arrayContaining(['revolutions', 'height']));
    expect(inputs.pitch).toBeUndefined();
    t.controller.setChoice('type', 'height-pitch');
    inputs = t.open()?.draft.inputs ?? {};
    expect(inputs.revolutions).toBeUndefined();
    expect(inputs.pitch).toMatchObject({ kind: 'expr', expr: '4 mm', unit: 'length' });
    t.controller.setChoice('section', 'triangle-out');
    t.controller.setChoice('direction', 'clockwise');
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(coilSettings(feature?.inputs as never)).toMatchObject({
      type: 'height-pitch',
      section: 'triangle-out',
      direction: 'clockwise',
      position: 'on',
      operation: 'new-body',
    });
  });

  it('proposes the centre of a picked face and a join', () => {
    const ctx = { bodies: { [BOX]: namedBoxMesh() } } as unknown as ManipulatorContext;
    const values = mergeValues(defaultValues(coilDialog), { refs: { plane: [face(1)] } });
    const proposed = proposeCoil(values, ctx);
    expect(proposed.choices).toEqual({ operation: 'join' });
    expect(proposed.exprs).toBeDefined();
    expect(proposeCoil(defaultValues(coilDialog), ctx)).toMatchObject({
      refs: { plane: [originPlaneRef('origin:xy')] },
      choices: { operation: 'new-body' },
    });
  });

  it('has a diameter arrow from the axis and a height arrow up it', () => {
    const ctx = {
      bodies: {},
      value: (name: string) => ({ x: 5, y: 0, offset: 2 })[name],
    } as unknown as ManipulatorContext;
    const values = mergeValues(defaultValues(coilDialog), {
      refs: { plane: [originPlaneRef('origin:xy')] },
    });
    expect(coilManipulators(values, ctx)).toEqual([
      { kind: 'distance', field: 'diameter', origin: [5, 0, 2], direction: [1, 0, 0], scale: 0.5 },
      { kind: 'distance', field: 'height', origin: [5, 0, 2], direction: [0, 0, 1] },
    ]);
    const pitched = mergeValues(values, { choices: { type: 'revolutions-pitch' } });
    expect(coilManipulators(pitched, ctx).map((m) => m.field)).toEqual(['diameter']);
  });
});
