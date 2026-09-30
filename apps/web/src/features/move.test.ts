import { MoveInputsSchema, moveSettings, originAxisRef } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { moveDialog, moveManipulators, pivotOf } from './move';
import { featureDialogs, specForCommand } from './registry';
import type { DialogValues, ManipulatorContext } from './spec';
import { BOX, setupDialogs } from './testing';
import { defaultValues, mergeValues, shownFields } from './values';

const body = { kind: 'body' as const, id: BOX };

function setup() {
  return setupDialogs([moveDialog]);
}

describe('the move dialog', () => {
  it('is the app’s dialog for the Move tool', () => {
    expect(specForCommand(featureDialogs(), 'move')?.type).toBe('move');
  });

  it('shows the fields of the move type: free move, rotate, point to point', () => {
    const shown = (mode: string) =>
      shownFields(moveDialog, mergeValues(defaultValues(moveDialog), { choices: { mode } })).map(
        (f) => f.name,
      );
    expect(shown('free')).toEqual(['bodies', 'mode', 'dx', 'dy', 'dz', 'rx', 'ry', 'rz', 'copy']);
    expect(shown('rotate')).toEqual(['bodies', 'mode', 'axis', 'angle', 'copy']);
    expect(shown('point-to-point')).toEqual(['bodies', 'mode', 'from', 'to', 'copy']);
  });

  it('takes the body selected before the tool, and makes valid inputs; OK inserts a move', () => {
    const t = setup();
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('move');
    expect(t.open()?.values.refs.bodies).toEqual([body]);
    t.controller.setExpr('dx', '12 mm');
    t.controller.setExpr('rz', '90 deg');
    const inputs = t.open()?.draft.inputs ?? {};
    expect(MoveInputsSchema.safeParse(inputs).success).toBe(true);
    expect(Object.keys(inputs).sort()).toEqual(
      ['bodies', 'copy', 'dx', 'dy', 'dz', 'mode', 'rx', 'ry', 'rz'].sort(),
    );
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'move', name: 'Move1' });
    expect(moveSettings(feature?.inputs as never)).toMatchObject({ mode: 'free', copy: false });
    expect(feature?.inputs.dx).toMatchObject({ kind: 'expr', expr: '12 mm', unit: 'length' });
    expect(feature?.inputs.rz).toMatchObject({ kind: 'expr', expr: '90 deg', unit: 'angle' });
  });

  it('a rotate move has its axis and angle and none of the distances', () => {
    const t = setup();
    t.controller.start('move');
    t.controller.setRefs('bodies', [body]);
    t.controller.setChoice('mode', 'rotate');
    t.controller.setRefs('axis', [originAxisRef('origin:z')]);
    t.controller.setExpr('angle', '45 deg');
    const inputs = t.open()?.draft.inputs ?? {};
    expect(MoveInputsSchema.safeParse(inputs).success).toBe(true);
    expect(Object.keys(inputs).sort()).toEqual(['angle', 'axis', 'bodies', 'copy', 'mode']);
    expect(inputs.mode).toEqual({ kind: 'enum', value: 'rotate' });
  });

  it('refuses OK with no bodies', () => {
    const t = setup();
    t.controller.start('move');
    expect(t.open()?.checked.fields).toEqual({ bodies: 'Pick bodies.' });
    expect(t.controller.ok()).toBe(false);
  });
});

describe('the move gizmo', () => {
  const t = setup();
  const ctx: ManipulatorContext = {
    doc: t.store.getState().doc,
    bodies: { [BOX]: t.mesh },
    value: () => 0,
  };
  const values = (more: Partial<DialogValues> = {}) =>
    mergeValues(defaultValues(moveDialog), { refs: { bodies: [body] }, ...more });

  it('finds the middle and half sizes of the picked bodies', () => {
    expect(pivotOf(values(), ctx)).toEqual({ centre: [5, 5, 5], half: [5, 5, 5] });
    expect(pivotOf(mergeValues(defaultValues(moveDialog), {}), ctx)).toBeUndefined();
  });

  it('free move: an arrow per axis from its box face, and a ring per axis about the middle', () => {
    const gizmo = moveManipulators(values(), ctx);
    expect(gizmo.map((m) => `${m.kind}:${m.field}`)).toEqual([
      'distance:dx',
      'angle:rx',
      'distance:dy',
      'angle:ry',
      'distance:dz',
      'angle:rz',
    ]);
    const arrows = gizmo.filter((m) => m.kind === 'distance');
    expect(arrows.map((m) => m.origin)).toEqual([
      [10, 5, 5],
      [5, 10, 5],
      [5, 5, 10],
    ]);
    expect(arrows.map((m) => m.direction)).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    const rings = gizmo.filter((m) => m.kind === 'angle');
    for (const ring of rings) {
      expect(ring.origin).toEqual([5, 5, 5]);
      // The start of the ring is square to its axis, and on a diagonal between two arrows.
      expect(
        Math.abs(
          ring.axis[0] * ring.zero[0] + ring.axis[1] * ring.zero[1] + ring.axis[2] * ring.zero[2],
        ),
      ).toBeLessThan(1e-9);
      expect(Math.hypot(...ring.zero)).toBeCloseTo(1, 9);
    }
  });

  it('rotate: one ring about the axis, starting from the bodies’ side of it', () => {
    const gizmo = moveManipulators(
      values({
        choices: { mode: 'rotate' },
        refs: { bodies: [body], axis: [originAxisRef('origin:z')] },
      }),
      ctx,
    );
    expect(gizmo).toHaveLength(1);
    const [ring] = gizmo;
    expect(ring).toMatchObject({
      kind: 'angle',
      field: 'angle',
      axis: [0, 0, 1],
      origin: [0, 0, 5],
    });
    // From the axis towards the middle of the box (5, 5, 5).
    const zero = ring?.kind === 'angle' ? ring.zero : [];
    expect(zero[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(zero[1]).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('has no gizmo before an axis is picked, for point to point, or without bodies', () => {
    expect(moveManipulators(values({ choices: { mode: 'rotate' } }), ctx)).toEqual([]);
    expect(moveManipulators(values({ choices: { mode: 'point-to-point' } }), ctx)).toEqual([]);
    expect(moveManipulators(mergeValues(defaultValues(moveDialog), {}), ctx)).toEqual([]);
  });
});
