// The Canvas dialog and its calibration (P4-06, ADR-0066 §5): the fields,
// the image it is about, the width it proposes from the picture's pixels, the
// inputs it builds, OK adding the attachment and the feature as one undo step,
// a click on the plane, and the calibration's two points and its width.
import {
  type AttachmentId,
  CANVAS_TYPE,
  CanvasInputsSchema,
  canvasInputs,
  type ExtrudoDocument,
  type FeatureId,
  newId,
  originPlaneRef,
  type SketchFrame,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import { rememberCanvasPixels } from '../viewport/canvasImages';
import {
  calibratedCanvasWidth,
  calibrationStore,
  canvasDialog,
  canvasDialogInputs,
  canvasPlaceAt,
  checkCanvas,
  clearCalibration,
  clearPendingCanvas,
  type PendingCanvas,
  pendingCanvasStore,
  proposeCanvas,
} from './canvas';
import { featureDialogs, specForCommand } from './registry';
import type { DialogContext, DialogValues, ManipulatorContext } from './spec';
import { setupDialogs } from './testing';

/** A picked 200 × 100 picture, as the tool leaves it. */
function pick(pixels = { width: 200, height: 100 }): PendingCanvas {
  const pending: PendingCanvas = {
    id: newId<AttachmentId>(),
    attachment: {
      name: 'plan',
      fileName: 'plan.png',
      mediaType: 'image/png',
      sha256: 'a'.repeat(64),
      size: 1234,
    },
  };
  pendingCanvasStore.setState({ pending });
  rememberCanvasPixels(pending.id, pixels);
  return pending;
}

afterEach(() => {
  clearPendingCanvas();
  clearCalibration();
});

/** The dialog context of a document with the picked picture in it. */
function contextOf(pending: PendingCanvas | undefined): DialogContext {
  return {
    doc: {
      ...emptyDocument(),
      ...(pending && { attachments: { [pending.id]: pending.attachment } }),
    },
    featureId: 'F' as FeatureId,
    bodies: {},
  };
}

function emptyDocument(): ExtrudoDocument {
  return {
    format: 'extrudo',
    formatVersion: 1,
    id: 'd1' as ExtrudoDocument['id'],
    name: 'Design',
    settings: { units: 'mm', precision: 2 },
    parameters: [],
    features: [],
    timelineMarker: 0,
    bodies: {},
    views: [],
    meta: {
      created: '2026-10-04T00:00:00.000Z',
      modified: '2026-10-04T00:00:00.000Z',
      appVersion: '0.4.0',
    },
  };
}

/** A manipulators context with no bodies, over the document above. */
const manipulators = (): ManipulatorContext => ({
  ...contextOf(pendingCanvasStore.getState().pending),
  value: (name) => ({ x: 0, y: 0, width: 20, opacity: 0.5 })[name as 'x'],
});

describe('the Canvas dialog', () => {
  it("is the app's dialog for the canvas command", () => {
    expect(specForCommand(featureDialogs(), 'canvas')?.type).toBe(CANVAS_TYPE);
    expect(canvasDialog.fields.map((f) => f.name)).toEqual([
      'image',
      'plane',
      'x',
      'y',
      'width',
      'rotation',
      'opacity',
      'flip',
    ]);
    // The picture is a read-only line; the plane is picked like a primitive's.
    expect(canvasDialog.fields[0]).toMatchObject({ kind: 'info', label: 'Picture' });
    expect(canvasDialog.fields[1]).toMatchObject({ kind: 'selection', accepts: ['plane', 'face'] });
    expect(canvasDialog.fields.at(-1)).toMatchObject({ kind: 'toggle', label: 'Flip' });
  });

  it('names the picture it puts on the plane', () => {
    const pending = pick();
    const t = setupDialogs([canvasDialog]);
    t.controller.start(CANVAS_TYPE);
    const info = canvasDialog.fields[0];
    expect(info?.kind).toBe('info');
    const ctx = contextOf(pending);
    if (info?.kind !== 'info') throw new Error('not an info field');
    expect(info.text(t.open()?.values ?? EMPTY, ctx)).toBe('plan.png · 1 kB');
    // Without a picture (the picker was cancelled) the line says so.
    clearPendingCanvas();
    expect(info.text(EMPTY, contextOf(undefined))).toBe('No picture');
  });

  it('proposes the XY plane and the picture width at 100 dpi', () => {
    const pending = pick();
    const values = { ...EMPTY, refs: {}, exprs: {} };
    const ctx = contextOf(pending);
    expect(proposeCanvas(values, { ...ctx, value: () => undefined, chosen: () => false })).toEqual({
      refs: { plane: [originPlaneRef('origin:xy')] },
      exprs: { width: '20 mm' },
    });
    // A width the user typed is theirs (ADR-0059's rule, ADR-0027's `chosen`).
    expect(
      proposeCanvas(values, { ...ctx, value: () => undefined, chosen: (f) => f === 'width' }),
    ).toEqual({ refs: { plane: [originPlaneRef('origin:xy')] } });
    // A plane already picked is left alone.
    expect(
      proposeCanvas(
        { ...values, refs: { plane: [originPlaneRef('origin:xz')] } },
        { ...ctx, value: () => undefined, chosen: () => false },
      ),
    ).toEqual({ exprs: { width: '20 mm' } });
    // Nothing without a picture: only the plane is proposed.
    clearPendingCanvas();
    expect(
      proposeCanvas(values, {
        ...contextOf(undefined),
        value: () => undefined,
        chosen: () => false,
      }),
    ).toEqual({ refs: { plane: [originPlaneRef('origin:xy')] } });
  });

  it('fills the width in the dialog when the dialog opens', () => {
    pick();
    const t = setupDialogs([canvasDialog]);
    t.controller.start(CANVAS_TYPE);
    expect(t.open()?.values.exprs.width).toBe('20 mm');
    // The user's own width wins over the proposal.
    t.controller.setExpr('width', '40 mm');
    expect(t.open()?.values.exprs.width).toBe('40 mm');
  });

  it('builds the feature inputs from the values, and back', () => {
    const pending = pick();
    const ctx = contextOf(pending);
    const values: DialogValues = {
      refs: { plane: [originPlaneRef('origin:xz')] },
      exprs: { x: '10 mm', y: '-5 mm', width: '40 mm', rotation: '30 deg', opacity: '0.8' },
      choices: {},
      toggles: { flip: true },
      labels: {},
    };
    expect(canvasDialogInputs(values, ctx)).toEqual(
      canvasInputs({
        image: pending.id,
        plane: originPlaneRef('origin:xz'),
        numbers: { x: '10 mm', y: '-5 mm', width: '40 mm', rotation: '30 deg', opacity: '0.8' },
        flip: true,
      }),
    );
    expect(CanvasInputsSchema.safeParse(canvasDialogInputs(values, ctx)).success).toBe(true);
    // Every field's default reaches the inputs, and an empty field takes it too.
    const blank: DialogValues = { refs: {}, exprs: {}, choices: {}, toggles: {}, labels: {} };
    expect(canvasDialogInputs(blank, ctx)).toEqual({
      image: { kind: 'file', id: pending.id },
      x: { kind: 'expr', expr: '0 mm', unit: 'length' },
      y: { kind: 'expr', expr: '0 mm', unit: 'length' },
      width: { kind: 'expr', expr: '100 mm', unit: 'length' },
      rotation: { kind: 'expr', expr: '0 deg', unit: 'angle' },
      opacity: { kind: 'expr', expr: '0.5', unit: 'unitless' },
      flip: { kind: 'bool', value: false },
    });
  });

  it('adds the attachment record and the feature as one undo step', () => {
    const pending = pick();
    const t = setupDialogs([canvasDialog]);
    t.controller.start(CANVAS_TYPE);
    expect(CanvasInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const doc = t.store.getState().doc;
    expect(doc.features.at(-1)).toMatchObject({ type: CANVAS_TYPE, name: 'Canvas1' });
    expect(doc.attachments?.[pending.id]).toEqual(pending.attachment);
    // One step: undo takes the feature and the picture's record away together.
    t.store.getState().undo();
    expect(t.store.getState().doc.features.some((f) => f.type === CANVAS_TYPE)).toBe(false);
    expect(t.store.getState().doc.attachments).toBeUndefined();
    t.store.getState().redo();
    expect(t.store.getState().doc.attachments?.[pending.id]).toEqual(pending.attachment);
  });

  it('edits a stored canvas without adding the picture again', () => {
    const pending = pick();
    const t = setupDialogs([canvasDialog]);
    t.controller.start(CANVAS_TYPE);
    t.controller.ok();
    const id = t.store.getState().doc.features.at(-1)?.id;
    if (!id) throw new Error('no feature');
    t.controller.edit(id);
    clearPendingCanvas();
    expect(t.open()?.values.exprs.width).toBe('20 mm');
    t.controller.setExpr('width', '40 mm');
    expect(t.controller.ok()).toBe(true);
    expect(t.store.getState().doc.features.at(-1)?.inputs.width).toMatchObject({
      kind: 'expr',
      expr: '40 mm',
      unit: 'length',
    });
    expect(Object.keys(t.store.getState().doc.attachments ?? {})).toEqual([pending.id]);
  });

  it('refuses OK without a picture', () => {
    clearPendingCanvas();
    const t = setupDialogs([canvasDialog]);
    t.controller.start(CANVAS_TYPE);
    expect(checkCanvas(t.open()?.values ?? EMPTY, contextOf(undefined))?.message).toBe(
      'Pick a picture to put on the plane.',
    );
    expect(t.controller.ok()).toBe(false);
    // A width or an opacity that would draw nothing is the kernel's call: it
    // comes back with the preview and keeps OK disabled (ADR-0066 §5).
    expect(checkCanvas(EMPTY, contextOf(pick()))).toBeUndefined();
  });
});

const EMPTY: DialogValues = { refs: {}, exprs: {}, choices: {}, toggles: {}, labels: {} };

describe("a canvas's placement and calibration (ADR-0066 §5)", () => {
  const values: DialogValues = {
    ...EMPTY,
    refs: { plane: [originPlaneRef('origin:xy')] },
    exprs: { x: '0 mm', y: '0 mm' },
  };

  it('moves the picture to where the plane was clicked', () => {
    // A click at (12, −4) mm on the XY plane.
    expect(canvasPlaceAt([12, -4, 0], values, manipulators())).toEqual({
      exprs: { x: '12 mm', y: '-4 mm' },
    });
    // Without a plane there is nothing to measure the click in.
    expect(canvasPlaceAt([12, -4, 0], EMPTY, manipulators())).toBeUndefined();
  });

  it('marks the two clicks of a calibration instead of moving the picture', () => {
    calibrationStore.setState({ dialog: 'c1' as FeatureId, points: [] });
    // The clicks land in the store (the view draws them), not in the fields.
    expect(canvasPlaceAt([-7.5, 0, 20], values, manipulators())).toBeUndefined();
    expect(calibrationStore.getState().points).toEqual([[-7.5, 0, 20]]);
    canvasPlaceAt([7.5, 0, 20], values, manipulators());
    expect(calibrationStore.getState().points).toHaveLength(2);
    calibrationStore.setState({ dialog: 'c1' as FeatureId, points: [] });
    const frame: SketchFrame = {
      origin: [0, 0, 0],
      x: [1, 0, 0],
      y: [0, 1, 0],
      normal: [0, 0, 1],
    };
    const width = 20;
    // Before the pair is complete there is no new width.
    expect(calibratedCanvasWidth({ points: [[0, 0, 0]], frame, width, real: 30 })).toBeUndefined();
    const points: [number, number, number][] = [
      [-7.5, 0, 0],
      [7.5, 0, 0],
    ];
    // 15 mm on the picture, 30 mm in reality: the width doubles.
    expect(calibratedCanvasWidth({ points, frame, width, real: 30 })).toEqual({
      width: 40,
      measured: 15,
    });
    // Anything missing says nothing.
    expect(calibratedCanvasWidth({ points, frame, width: undefined, real: 30 })).toBeUndefined();
    expect(calibratedCanvasWidth({ points, frame, width, real: 0 })).toBeUndefined();
    expect(calibratedCanvasWidth({ points, frame: undefined, width, real: 30 })).toBeUndefined();
    // A calibration running takes the clicks for itself.
    expect(canvasPlaceAt([12, -4, 0], values, manipulators())).toBeUndefined();
  });

  it('forgets its calibration when it is cleared', () => {
    calibrationStore.setState({
      dialog: 'c1' as FeatureId,
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    });
    expect(calibrationStore.getState().points).toHaveLength(2);
    clearCalibration();
    expect(calibrationStore.getState()).toEqual({ dialog: undefined, points: [] });
  });
});
