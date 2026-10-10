import type { JointId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { draftOf, frameLabel, jointInfo, LOOSE_BODY_HINT } from './jointController';
import { BASE, LEAF, settle, setupJoints } from './testing';

const face = (body: string, index: number) => ({ kind: 'face' as const, id: `${body}:${index}` });

describe('the Joint dialog controller (ADR-0081 §6)', () => {
  it('fills Moving and Fixed part from the selection, in order', async () => {
    const t = setupJoints();
    t.session.getState().select([face('L:0', 2), face('B:0', 4)], 'replace');
    t.dialog.start();
    const open = t.dialog.state.getState().open;
    expect(open?.name).toBe('Joint1');
    expect(open?.type).toBe('revolute');
    expect(open?.frames.a).toEqual({ component: LEAF, ref: { kind: 'face', id: 'L:face2' } });
    expect(open?.frames.b?.component).toBe(BASE);
    expect(open?.pickField).toBeUndefined();
    await settle();
    // The fingerprints came from the kernel, and the read-only line from its resolve.
    const now = t.dialog.state.getState().open;
    expect(now?.frames.a?.ref.fingerprint?.type).toBe('cylinder');
    expect(t.dialog.frameText('a')).toBe('Cylinder face · Leaf');
    expect(now && jointInfo(now, t.store.getState().doc)).toBe("Turns Leaf about Base's axis.");
  });

  it('takes the kinds each type takes', () => {
    const t = setupJoints();
    t.dialog.start();
    expect(t.dialog.kinds()).toEqual(['face', 'edge', 'axis', 'sketchEntity']);
    t.dialog.setType('rigid');
    expect(t.dialog.kinds()).toEqual(['face', 'edge', 'vertex', 'body']);
    // A vertex is no frame for a revolute; a rigid joint takes it.
    t.dialog.setType('revolute');
    t.dialog.select.onClick({ kind: 'vertex', id: 'L:0:3' }, false);
    expect(t.dialog.state.getState().open?.frames.a).toBeUndefined();
    t.dialog.setType('rigid');
    t.dialog.select.onClick({ kind: 'body', id: 'L:0' }, false);
    expect(t.dialog.state.getState().open?.frames.a?.ref).toEqual({ kind: 'body', id: 'L:0' });
    // A type that doesn't take a picked kind drops that frame.
    t.dialog.setType('slider');
    expect(t.dialog.state.getState().open?.frames.a).toBeUndefined();
  });

  it('refuses a pick on a body in no component, with the hint', () => {
    const t = setupJoints();
    t.dialog.start();
    t.dialog.select.onClick(face('X:0', 1), false);
    const open = t.dialog.state.getState().open;
    expect(open?.frames.a).toBeUndefined();
    expect(open?.hints.a).toBe(LOOSE_BODY_HINT);
  });

  it('OK adds the joint in one step, with its limits', async () => {
    const t = setupJoints();
    t.dialog.start();
    t.dialog.select.onClick(face('L:0', 2), false);
    t.dialog.select.onClick(face('B:0', 4), false);
    t.dialog.setLimit('max', '90 deg');
    expect(t.dialog.problem()).toBeUndefined();
    const before = t.store.getState().doc;
    expect(t.dialog.ok()).toBe(true);
    const joint = t.store.getState().doc.joints?.[0];
    expect(joint?.name).toBe('Joint1');
    expect(joint?.max).toEqual({ kind: 'expr', expr: '90 deg', unit: 'angle' });
    expect(joint).not.toHaveProperty('min');
    expect(t.dialog.state.getState().open).toBeUndefined();
    t.store.getState().undo();
    expect(t.store.getState().doc).toEqual(before);
  });

  it("won't commit both sides on one component or a limit that doesn't evaluate", () => {
    const t = setupJoints();
    t.dialog.start();
    t.dialog.select.onClick(face('L:0', 2), false);
    expect(t.dialog.problem()).toBe('Pick the part that stays.');
    t.dialog.select.onClick(face('L:0', 3), false);
    expect(t.dialog.problem()).toBe('Both sides are in Leaf: pick a frame on another component.');
    t.dialog.pickInto('b');
    t.dialog.select.onClick(face('B:0', 4), false);
    t.dialog.setLimit('min', '5 mm');
    expect(t.dialog.problem()).toMatch(/angle/i);
    expect(t.dialog.ok()).toBe(false);
    expect(t.store.getState().doc.joints).toBeUndefined();
  });

  it('edits a joint, and Fix References opens it with the lost frame to pick again', () => {
    const t = setupJoints();
    t.dialog.start();
    t.dialog.select.onClick(face('L:0', 2), false);
    t.dialog.select.onClick(face('B:0', 4), false);
    t.dialog.ok();
    const joint = t.store.getState().doc.joints?.[0];
    if (!joint) throw new Error('no joint');
    t.dialog.edit(joint.id, {
      fix: [{ ref: { kind: joint.b.ref.kind, id: joint.b.ref.id }, state: 'lost' }],
    });
    const open = t.dialog.state.getState().open;
    expect(open?.mode).toBe('edit');
    expect(open?.fix).toEqual(['b']);
    expect(open?.pickField).toBe('b');
    expect(open?.note).toBe('Joint1 lost its fixed part frame: pick it again.');
    t.dialog.select.onClick(face('B:0', 5), false);
    expect(t.dialog.ok()).toBe(true);
    expect(t.store.getState().doc.joints?.[0]?.b.ref.id).toBe('B:face5');
    // Undo takes the edit back, and an edited joint that disappears closes its dialog.
    t.dialog.edit(joint.id);
    t.store.getState().undo();
    t.store.getState().undo();
    expect(t.dialog.state.getState().open).toBeUndefined();
  });

  it('names frames and builds the draft', () => {
    const t = setupJoints();
    const doc = t.store.getState().doc;
    expect(frameLabel({ component: LEAF, ref: { kind: 'edge', id: 'e' } }, doc)).toBe(
      'Edge · Leaf',
    );
    expect(frameLabel({ component: BASE, ref: { kind: 'axis', id: 'origin:x' } }, doc)).toBe(
      'X axis · Base',
    );
    const draft = draftOf(
      {
        mode: 'create',
        id: 'j' as JointId,
        name: 'Joint1',
        type: 'slider',
        frames: {
          a: { component: LEAF, ref: face('L:0', 0) },
          b: { component: BASE, ref: face('B:0', 0) },
        },
        min: '',
        max: ' 10 mm ',
        flip: true,
        pickField: undefined,
        hints: {},
        typing: {},
        report: undefined,
      },
      doc,
    );
    expect(draft?.max).toEqual({ kind: 'expr', expr: '10 mm', unit: 'length' });
    expect(draft?.flip).toBe(true);
  });
});
