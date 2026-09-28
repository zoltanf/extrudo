import { addParameter, type BodyId, type FeatureId, type ParameterId } from '@extrudo/core';
import type { Preview } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { boxMesh } from '../selection/testing';
import { canCommit, dialogBodies, type OpenDialog, viewPreview } from './dialog';
import { BOX, FACE_IDS, faceItem, namedBoxMesh, settle, setupDialogs } from './testing';

function preview(over: Partial<Preview> = {}): Preview {
  return { features: {}, bodies: {}, tools: [], ...over };
}

describe('opening a dialog', () => {
  it('starts with defaults, the first selection field taking picks, and OK refused', () => {
    const t = setupDialogs();
    expect(t.controller.start('fake-press')).toBe(true);
    const open = t.open() as OpenDialog;
    expect(open.mode).toBe('create');
    expect(open.name).toBe('Press1');
    expect(open.pickField).toBe('faces');
    expect(open.values.exprs).toEqual({ distance: '5 mm', angle: '10 deg' });
    expect(open.checked.fields).toEqual({ faces: 'Pick a face.' });
    expect(canCommit(open)).toBe(false);
    expect(t.controller.ok()).toBe(false);
    expect(t.messages).toEqual(['info: Pick a face.']);
    // Nothing to preview until the inputs are valid.
    expect(t.kernel.previews).toEqual([]);
    expect(t.controller.start('unknown')).toBe(false);
  });

  it('fills its selection field from the selection, then adds fingerprints', async () => {
    const t = setupDialogs();
    t.session
      .getState()
      .select([{ kind: 'edge', id: `${BOX}:3` }, faceItem(1), faceItem(5), faceItem(4)]);
    t.controller.start('fake-press');
    // Faces only (the edge isn't taken), at most two.
    expect(t.open()?.values.refs.faces?.map((r) => r.id)).toEqual(['box:top', 'box:right']);
    expect(t.open()?.values.refs.faces?.[0]?.fingerprint).toBeUndefined();
    await settle();
    expect(t.open()?.values.refs.faces?.map((r) => r.fingerprint?.at)).toEqual([
      [1, 0, 0],
      [5, 0, 0],
    ]);
  });

  it('never stores a reference without a persistent ID', () => {
    const t = setupDialogs();
    t.model.getState().computed({ features: {}, bodies: { [BOX]: boxMesh() } });
    t.session.getState().select([faceItem(1)]);
    t.controller.start('fake-press');
    expect(t.open()?.values.refs.faces).toEqual([]);
  });
});

describe('picking into a selection field', () => {
  it('toggles faces on click, up to its maximum, and ignores what it does not take', () => {
    const t = setupDialogs();
    t.controller.start('fake-press');
    const ids = () => t.open()?.values.refs.faces?.map((r) => r.id);
    t.controller.select.onClick(faceItem(1), false);
    t.controller.select.onClick(faceItem(2), false);
    t.controller.select.onClick(faceItem(3), false);
    expect(ids()).toEqual(['box:top', 'box:front']);
    t.controller.select.onClick(faceItem(1), false);
    expect(ids()).toEqual(['box:front']);
    t.controller.select.onClick({ kind: 'edge', id: `${BOX}:0` }, false);
    t.controller.select.onClick(undefined, false);
    expect(ids()).toEqual(['box:front']);
    t.controller.select.onBox([faceItem(4), faceItem(5), { kind: 'body', id: BOX }], false);
    expect(ids()).toEqual(['box:front', 'box:left']);
  });

  it('pre-highlights only what the pick field takes', () => {
    const t = setupDialogs();
    t.controller.start('fake-press');
    t.controller.select.onHover(faceItem(2));
    expect(t.session.getState().hover).toEqual(faceItem(2));
    t.controller.select.onHover({ kind: 'edge', id: `${BOX}:0` });
    expect(t.session.getState().hover).toBeUndefined();
  });
});

describe('the draft and its preview', () => {
  it('names expression inputs once per dialog, after the parameters in use', () => {
    const t = setupDialogs();
    t.controller.start('fake-press');
    t.controller.select.onClick(faceItem(1), false);
    expect(t.open()?.draft.inputs.distance).toEqual({
      kind: 'expr',
      expr: '5 mm',
      unit: 'length',
      paramName: 'd2',
    });
    t.controller.setToggle('tilted', true);
    expect(t.open()?.draft.inputs.angle).toMatchObject({ unit: 'angle', paramName: 'd3' });
    t.controller.setToggle('tilted', false);
    t.controller.setToggle('tilted', true);
    expect(t.open()?.paramNames).toEqual({ distance: 'd2', angle: 'd3' });
    expect(Object.keys(t.open()?.draft.inputs ?? {})).toEqual([
      'faces',
      'operation',
      'distance',
      'angle',
    ]);
  });

  it('previews a valid draft at the marker, and keeps the last result dimmed when invalid', async () => {
    const t = setupDialogs();
    t.controller.start('fake-press');
    t.controller.select.onClick(faceItem(1), false);
    await settle();
    const asked = t.kernel.previews.at(-1);
    expect(asked?.index).toBe(1);
    expect(asked?.draft).toMatchObject({ id: t.open()?.id, type: 'fake-press', name: 'Press1' });
    const tool = boxMesh([0, 0, 10], [10, 10, 15]);
    asked?.resolve(preview({ tools: [{ mesh: tool, style: 'join' }] }));
    await settle();
    expect(viewPreview(t.open())).toEqual({
      shapes: [{ mesh: tool, style: 'join' }],
      dimmed: false,
    });

    // Typing something that doesn't evaluate: no new preview, the old one dimmed, OK refused.
    const count = t.kernel.previews.length;
    t.controller.setTyping('distance', 'Distance: Unknown name `wal`.');
    expect(t.kernel.previews.length).toBe(count);
    expect(viewPreview(t.open())?.dimmed).toBe(true);
    expect(t.controller.ok()).toBe(false);

    // Valid again: a new preview; the draft fails in the kernel, so the old drawing stays, dimmed.
    t.controller.setExpr('distance', '0.5 mm');
    const failing = t.kernel.previews.at(-1);
    expect(failing?.draft.inputs.distance).toMatchObject({ expr: '0.5 mm' });
    expect(t.open()?.preview.pending).toBe(true);
    failing?.resolve(
      preview({ features: { [failing.draft.id]: { status: 'error', message: 'Too thin.' } } }),
    );
    await settle();
    expect(t.open()?.preview.status).toEqual({ status: 'error', message: 'Too thin.' });
    // The kernel refused it: OK says why.
    expect(canCommit(t.open() as OpenDialog)).toBe(false);
    expect(t.controller.ok()).toBe(false);
    expect(t.messages.at(-1)).toBe('info: Too thin.');
    expect(viewPreview(t.open())).toEqual({
      shapes: [{ mesh: tool, style: 'join' }],
      dimmed: true,
    });
  });

  it('draws the bodies a draft changed when it gives no tools, in the spec style', async () => {
    const t = setupDialogs();
    t.controller.start('fake-press');
    t.controller.select.onClick(faceItem(1), false);
    t.controller.setChoice('operation', 'cut');
    // The face's fingerprint arrives first and asks again.
    await settle();
    const changed = boxMesh([0, 0, 0], [10, 10, 5]);
    t.kernel.previews.at(-1)?.resolve(preview({ bodies: { [BOX]: changed } }));
    await settle();
    expect(viewPreview(t.open())?.shapes).toEqual([{ mesh: changed, style: 'cut' }]);
  });

  it('drops a late preview of an older draft, and asks again only when something changed', async () => {
    const t = setupDialogs();
    t.controller.start('fake-press');
    t.controller.select.onClick(faceItem(1), false);
    t.controller.setExpr('distance', '7 mm');
    const [older, newer] = t.kernel.previews.slice(-2);
    older?.resolve(preview({ tools: [{ mesh: boxMesh(), style: 'new' }] }));
    await settle();
    expect(viewPreview(t.open())).toBeUndefined();
    newer?.resolve(preview());
    const count = t.kernel.previews.length;
    t.controller.pickInto('faces');
    t.controller.activate('distance');
    t.controller.setExpr('distance', '7 mm');
    expect(t.kernel.previews.length).toBe(count);
    // A parameter change asks again, with the same draft.
    t.store.getState().dispatch(
      addParameter({
        parameter: { id: 'p1' as ParameterId, name: 'wall', expression: '2 mm', unit: 'length' },
      }),
    );
    expect(t.kernel.previews.length).toBe(count + 1);
  });

  it('checks expressions in context: parameters, units, and its own name', () => {
    const t = setupDialogs();
    t.controller.start('fake-press');
    t.controller.select.onClick(faceItem(1), false);
    expect(t.controller.evaluate('distance', 'd1 / 2')).toMatchObject({ ok: true, value: 5 });
    expect(t.controller.evaluate('distance', 'd2 * 2').ok).toBe(false);
    expect(t.controller.evaluate('distance', '3 deg').ok).toBe(false);
    t.controller.setExpr('distance', '0 mm');
    expect(t.open()?.checked.first).toEqual({
      field: 'distance',
      message: 'The distance is zero.',
    });
  });
});

describe('OK and Cancel', () => {
  it('OK inserts the feature at the marker as one undo step and closes', async () => {
    const t = setupDialogs();
    t.session.getState().select([faceItem(1)]);
    t.controller.start('fake-press');
    await settle();
    t.controller.setExpr('distance', 'd1 + 1 mm');
    expect(t.controller.ok()).toBe(true);
    const { doc, undoLabel } = t.store.getState();
    expect(doc.features.map((f) => f.name)).toEqual(['Box1', 'Press1']);
    expect(doc.timelineMarker).toBe(2);
    expect(doc.features[1]?.inputs).toEqual({
      faces: {
        kind: 'ref',
        refs: [{ kind: 'face', id: 'box:top', fingerprint: { type: 'plane', at: [1, 0, 0] } }],
      },
      operation: { kind: 'enum', value: 'join' },
      distance: { kind: 'expr', expr: 'd1 + 1 mm', unit: 'length', paramName: 'd2' },
    });
    expect(undoLabel).toBe('Add feature');
    expect(t.open()).toBeUndefined();
    expect(t.session.getState().selection).toEqual([]);
    expect(t.kernel.ended).toBe(1);
    t.store.getState().undo();
    expect(t.store.getState().doc.features).toHaveLength(1);
  });

  it('Cancel leaves the document alone', () => {
    const t = setupDialogs();
    const before = t.store.getState().doc;
    t.session.getState().select([faceItem(1)]);
    t.controller.start('fake-press');
    t.controller.cancel();
    expect(t.open()).toBeUndefined();
    expect(t.store.getState().doc).toBe(before);
    expect(t.session.getState().selection).toEqual([faceItem(1)]);
  });

  it('edits an existing feature: its values, its parameter names, one step replacing its inputs', () => {
    const t = setupDialogs();
    t.session.getState().select([faceItem(1)]);
    t.controller.start('fake-press');
    t.controller.setToggle('tilted', true);
    t.controller.ok();
    const id = t.store.getState().doc.features[1]?.id as FeatureId;

    expect(t.controller.edit(id)).toBe(true);
    const open = t.open() as OpenDialog;
    expect(open.mode).toBe('edit');
    expect(open.index).toBe(1);
    expect(open.values.toggles.tilted).toBe(true);
    expect(open.values.refs.faces?.map((r) => r.id)).toEqual(['box:top']);
    expect(open.paramNames).toEqual({ distance: 'd2', angle: 'd3' });
    t.controller.setToggle('tilted', false);
    t.controller.setExpr('distance', '8 mm');
    expect(t.controller.ok()).toBe(true);
    const inputs = t.store.getState().doc.features[1]?.inputs;
    expect(inputs?.angle).toBeUndefined();
    expect(inputs?.distance).toEqual({
      kind: 'expr',
      expr: '8 mm',
      unit: 'length',
      paramName: 'd2',
    });
    expect(t.store.getState().undoLabel).toBe('Edit feature');
    t.store.getState().undo();
    expect(t.store.getState().doc.features[1]?.inputs.angle).toBeDefined();
  });

  it('shows and picks the bodies before an edited feature once its preview has them', async () => {
    const t = setupDialogs();
    t.session.getState().select([faceItem(1)]);
    t.controller.start('fake-press');
    expect(t.kernel.previews.at(-1)?.base).toBe(false);
    t.controller.ok();
    const id = t.store.getState().doc.features[1]?.id as FeatureId;
    t.controller.edit(id);
    const asked = t.kernel.previews.at(-1);
    expect(asked?.base).toBe(true);
    expect(asked?.index).toBe(1);
    // The model (after the press) has no `box:right` face; the base (before it) has.
    const before = { ...namedBoxMesh(), faceIds: FACE_IDS.map((f) => `${f}-before`) };
    asked?.resolve(preview({ base: { [BOX]: before } }));
    await settle();
    expect(t.open()?.base).toEqual({ [BOX]: before });
    expect(dialogBodies(t.open(), t.model.getState().bodies)[BOX]).toBe(before);
    expect(t.controller.context()?.bodies[BOX]).toBe(before);
    t.controller.select.onClick(faceItem(5), false);
    expect(t.open()?.values.refs.faces?.map((r) => r.id)).toEqual(['box:top', 'box:right-before']);
    await settle();
    expect(t.kernel.references.at(-1)).toBe(true);
  });

  it('closes an edit dialog whose feature goes away', () => {
    const t = setupDialogs();
    t.session.getState().select([faceItem(1)]);
    t.controller.start('fake-press');
    t.controller.ok();
    const id = t.store.getState().doc.features[1]?.id as FeatureId;
    t.controller.edit(id);
    t.store.getState().undo();
    expect(t.open()).toBeUndefined();
    expect(t.controller.edit('box' as FeatureId)).toBe(false);
  });

  it('fixes references: lost ones out, guesses replaced, the field taking picks (P2-11)', () => {
    const t = setupDialogs();
    t.session.getState().select([faceItem(1), faceItem(2)]);
    t.controller.start('fake-press');
    t.controller.ok();
    const id = t.store.getState().doc.features[1]?.id as FeatureId;
    const now = { kind: 'face' as const, id: 'box:front#1' };
    expect(
      t.controller.edit(id, {
        fix: [
          { ref: { kind: 'face', id: 'box:top' }, state: 'lost' },
          { ref: { kind: 'face', id: 'box:front' }, state: 'guessed', now },
        ],
      }),
    ).toBe(true);
    const open = t.open() as OpenDialog;
    expect(open.values.refs.faces).toEqual([now]);
    expect(open.pickField).toBe('faces');
    expect(open.note).toBe(
      'Press1 lost 1 reference: pick it again in Faces. Where the model changed, the fields show the closest match the kernel took: keep it with OK, or pick again.',
    );
    t.controller.select.onClick(faceItem(5), false);
    expect(t.controller.ok()).toBe(true);
    const faces = t.store.getState().doc.features[1]?.inputs.faces;
    expect(faces?.kind === 'ref' && faces.refs.map((r) => r.id)).toEqual([
      'box:front#1',
      'box:right',
    ]);
    // One undo step.
    t.store.getState().undo();
    const back = t.store.getState().doc.features[1]?.inputs.faces;
    expect(back?.kind === 'ref' && back.refs.map((r) => r.id)).toEqual(['box:top', 'box:front']);
  });

  it('gives the manipulators the field values in the context', () => {
    const t = setupDialogs();
    t.session.getState().select([faceItem(1)]);
    t.controller.start('fake-press');
    const ctx = t.controller.context();
    expect(ctx?.value('distance')).toBe(5);
    const open = t.open() as OpenDialog;
    expect(open.spec.manipulators?.(open.values, ctx as NonNullable<typeof ctx>)).toEqual([
      { kind: 'distance', field: 'distance', origin: [5, 5, 10], direction: [0, 0, 1] },
    ]);
    expect(t.model.getState().bodies[BOX as BodyId]).toBe(t.mesh);
  });
});
