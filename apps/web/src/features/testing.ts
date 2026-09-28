/**
 * Test fixtures for feature dialogs: a fake spec that uses every field
 * kind, a document with one box body, the box's mesh with persistent IDs,
 * and a fake kernel whose previews the test resolves.
 */

import {
  type BodyId,
  createDocument,
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type Feature,
  type FeatureId,
  FeatureInputsSchema,
  FeatureRegistry,
  type GeomRef,
} from '@extrudo/core';
import type { BodyMesh, Preview, PreviewToolStyle } from '@extrudo/kernel';
import type { ToastOptions } from '../design-system';
import { boxMesh } from '../selection/testing';
import { createDialogController, type DialogKernel } from './dialog';
import { faceFrame } from './geometry';
import { defineFeatureDialog, type FeatureDialogSpec } from './spec';
import { defaultFromInputs, defaultInputs } from './values';

export const BOX = 'box:0' as BodyId;

/** Face IDs of `boxMesh` in its face order (−Z, +Z, −Y, +Y, −X, +X). */
export const FACE_IDS = ['bottom', 'top', 'front', 'back', 'left', 'right'].map((f) => `box:${f}`);

/** A 10 mm box mesh whose faces, edges and vertices carry persistent IDs. */
export function namedBoxMesh(): BodyMesh {
  return {
    ...boxMesh(),
    faceIds: FACE_IDS,
    edgeIds: Array.from({ length: 12 }, (_, i) => `box:e${i}`),
    vertexIds: Array.from({ length: 8 }, (_, i) => `box:v${i}`),
  };
}

/**
 * `fake-press`: faces (one or two), a distance, an operation, and a toggle
 * that shows an angle (and isn't an input itself).
 */
export const fakeSpec: FeatureDialogSpec = defineFeatureDialog({
  type: 'fake-press',
  label: 'Press',
  category: 'create',
  icon: 'extrude',
  inputsSchema: FeatureInputsSchema,
  command: 'extrude',
  fields: [
    { kind: 'selection', name: 'faces', label: 'Faces', accepts: ['face'], max: 2 },
    {
      kind: 'choice',
      name: 'operation',
      label: 'Operation',
      default: 'join',
      options: [
        { value: 'join', label: 'Join' },
        { value: 'cut', label: 'Cut' },
      ],
    },
    { kind: 'expression', name: 'distance', label: 'Distance', unit: 'length', default: '5 mm' },
    { kind: 'toggle', name: 'tilted', label: 'Tilt', default: false },
    {
      kind: 'expression',
      name: 'angle',
      label: 'Angle',
      unit: 'angle',
      default: '10 deg',
      shown: (v) => v.toggles.tilted === true,
    },
  ],
  toInputs(values) {
    const { tilted: _, ...inputs } = defaultInputs(fakeSpec, values);
    return inputs;
  },
  fromInputs(inputs) {
    return {
      ...defaultFromInputs(fakeSpec, inputs),
      toggles: { tilted: inputs.angle !== undefined },
    };
  },
  validate: (values) =>
    values.exprs.distance?.trim() === '0 mm'
      ? { field: 'distance', message: 'The distance is zero.' }
      : undefined,
  manipulators(values, ctx) {
    const frame = faceFrame(ctx.bodies, values.refs.faces?.[0] as GeomRef);
    return frame
      ? [{ kind: 'distance', field: 'distance', origin: frame.origin, direction: frame.normal }]
      : [];
  },
  previewStyle: (values) => values.choices.operation as PreviewToolStyle,
});

export interface FakeKernel extends DialogKernel {
  previews: {
    draft: Feature;
    index: number;
    base: boolean;
    resolve(preview: Preview | undefined): void;
  }[];
  /** Whether each `reference` call asked for the preview's base. */
  references: boolean[];
  ended: number;
}

export function fakeKernel(): FakeKernel {
  const kernel: FakeKernel = {
    previews: [],
    references: [],
    ended: 0,
    preview: (draft, index, options) =>
      new Promise((resolve) =>
        kernel.previews.push({ draft, index, base: options?.base === true, resolve }),
      ),
    endPreview: () => {
      kernel.ended++;
    },
    reference: async (_body, kind, index, base = false) => {
      kernel.references.push(base);
      const ids = kind === 'face' ? FACE_IDS : [];
      const id = ids[index];
      return id ? { kind, id, fingerprint: { type: 'plane', at: [index, 0, 0] } } : undefined;
    },
  };
  return kernel;
}

/** A document with a box feature (whose body the model store holds) and the stores. */
export function setupDialogs(specs: FeatureDialogSpec[] = [fakeSpec]) {
  const doc = createDocument();
  const box: Feature = {
    id: 'box' as FeatureId,
    type: 'test-box',
    name: 'Box1',
    suppressed: false,
    inputs: { size: { kind: 'expr', expr: '10 mm', paramName: 'd1', unit: 'length' } },
  };
  const store = createDocumentStore({ ...doc, features: [box], timelineMarker: 1 });
  const session = createSessionStore();
  const model = createModelStore<BodyMesh>();
  const mesh = namedBoxMesh();
  model.getState().computed({ features: {}, bodies: { [BOX]: mesh } });
  const kernel = fakeKernel();
  const messages: string[] = [];
  /** The options of each message (a toast's action, its lifetime). */
  const toasts: (ToastOptions | undefined)[] = [];
  const dialogs = new FeatureRegistry<FeatureDialogSpec>();
  for (const spec of specs) dialogs.register(spec);
  const controller = createDialogController({
    store,
    session,
    model,
    dialogs,
    kernel,
    notify: (tone, text, options) => {
      messages.push(`${tone}: ${text}`);
      toasts.push(options);
    },
  });
  const open = () => controller.state.getState().open;
  return { store, session, model, mesh, kernel, messages, toasts, controller, open, dialogs };
}

/** The session item of face `index` of the box. */
export const faceItem = (index: number) => ({ kind: 'face' as const, id: `${BOX}:${index}` });

/** Lets queued promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
