import { CombineInputsSchema, combineSettings } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { combineDialog } from './combine';
import { featureDialogs, specForCommand } from './registry';
import { BOX, setupDialogs } from './testing';

const body = (id: string) => ({ kind: 'body' as const, id });

describe('the combine dialog', () => {
  it('is the app’s dialog for the Combine tool', () => {
    expect(specForCommand(featureDialogs(), 'combine')?.type).toBe('combine');
  });

  it('fills the target with the first selected body and the tools with the rest', () => {
    const t = setupDialogs([combineDialog]);
    t.model.getState().computed({
      features: {},
      bodies: { [BOX]: t.mesh, 'other:0': t.mesh, 'third:0': t.mesh } as never,
    });
    t.session.getState().select([
      { kind: 'body', id: BOX },
      { kind: 'body', id: 'other:0' },
      { kind: 'body', id: 'third:0' },
    ]);
    t.controller.start('combine');
    expect(t.open()?.values.refs.target).toEqual([body(BOX)]);
    expect(t.open()?.values.refs.tools).toEqual([body('other:0'), body('third:0')]);
  });

  it('makes valid inputs; OK inserts a combine with its operation and keepTools', () => {
    const t = setupDialogs([combineDialog]);
    t.controller.start('combine');
    t.controller.setRefs('target', [body(BOX)]);
    t.controller.setRefs('tools', [body('other:0')]);
    t.controller.setChoice('operation', 'cut');
    t.controller.setToggle('keepTools', true);
    expect(CombineInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'combine', name: 'Combine1' });
    expect(combineSettings(feature?.inputs as never)).toMatchObject({
      operation: 'cut',
      keepTools: true,
    });
  });

  it('refuses a target that is also a tool, and empty fields', () => {
    const t = setupDialogs([combineDialog]);
    t.controller.start('combine');
    expect(t.open()?.checked.fields).toMatchObject({ target: 'Pick the target body.' });
    t.controller.setRefs('target', [body(BOX)]);
    t.controller.setRefs('tools', [body(BOX)]);
    expect(t.open()?.checked.fields).toEqual({
      tools: "The target can't be one of its own tools.",
    });
    expect(t.controller.ok()).toBe(false);
  });

  it('previews in the style of the operation', () => {
    const style = (operation: string) =>
      combineDialog.previewStyle?.({ refs: {}, exprs: {}, choices: { operation }, toggles: {} });
    expect([style('join'), style('cut'), style('intersect')]).toEqual(['join', 'cut', 'intersect']);
  });
});
