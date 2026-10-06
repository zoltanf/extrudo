import {
  EXTRUDE_DIRECTIONS,
  EXTRUDE_EXTENTS,
  EXTRUDE_OPERATIONS,
  ExtrudeInputsSchema,
  extrudeInputs,
  type Feature,
  type FeatureId,
  type GeomRef,
  insertFeature,
  originPlaneRef,
  type SketchData,
  type SketchEntityId,
  setFeatureVisibility,
  sketchInputs,
  type Vec3,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { outline, profilesOf } from '../project/templates';
import { textSketch } from '../sketch/textTesting';
import { HIDDEN_TOAST_MS, hiddenMessage, type OpenDialog } from './dialog';
import { extrudeDialog, extrudeManipulators, proposeOperation } from './extrude';
import { featureDialogs, specForCommand } from './registry';
import type { DialogContext, DialogValues, Manipulator, ManipulatorContext } from './spec';
import { BOX, faceItem, namedBoxMesh, settle, setupDialogs } from './testing';
import { defaultValues, inputsFor, mergeValues, shownFields, valuesFor } from './values';

const TOP: GeomRef = { kind: 'face', id: 'box:top' };
const VERTEX: GeomRef = { kind: 'vertex', id: 'box:v3' };

/** A 20 × 10 mm rectangle sketch on XY from (10, 0), and its profile reference. */
function rectangleSketch() {
  const id = 'S' as FeatureId;
  const data = outline([
    [10, 0],
    [30, 0],
    [30, 10],
    [10, 10],
  ]);
  const sketch: Feature = {
    id,
    type: 'sketch',
    name: 'Sketch1',
    suppressed: false,
    inputs: sketchInputs(originPlaneRef('origin:xy'), data),
  };
  const [profile] = profilesOf(id, data);
  return { sketch, profile: profile as GeomRef };
}

function values(over: Partial<DialogValues>): DialogValues {
  return mergeValues(defaultValues(extrudeDialog), over);
}

function context(over: Partial<DialogContext> = {}): DialogContext {
  const t = setupDialogs([extrudeDialog]);
  return { doc: t.store.getState().doc, bodies: { [BOX]: namedBoxMesh() }, ...over };
}

function manipulatorContext(
  base: DialogContext,
  numbers: Record<string, number>,
): ManipulatorContext {
  return { ...base, value: (field) => numbers[field] };
}

const round = (v: Vec3) => v.map((c) => Math.round(c * 1000) / 1000 + 0);

describe('OK on a new extrude', () => {
  it('hides the sketch whose profile it used, in the same undo step; an edit does not', async () => {
    const t = setupDialogs([extrudeDialog]);
    const { sketch, profile } = rectangleSketch();
    t.store.getState().dispatch(insertFeature({ feature: sketch, index: 1 }));
    t.session.getState().select([{ kind: 'profile', id: profile.id }]);
    t.controller.start('extrude');
    await settle();
    expect(t.controller.ok()).toBe(true);
    const shown = () => t.store.getState().doc.features.find((f) => f.id === sketch.id)?.visible;
    expect(shown()).toBe(false);
    expect(t.store.getState().undoLabel).toBe('Add feature');
    // A toast says so for a while, with a button that shows it again (its own undo step).
    expect(t.messages).toEqual(['info: Sketch1 is hidden: Extrude1 used its profile.']);
    const toast = t.toasts[0];
    expect(toast?.lifetime).toBe(HIDDEN_TOAST_MS);
    expect(toast?.action?.label).toBe('Show');
    toast?.action?.run();
    expect(shown()).toBeUndefined();
    expect(t.store.getState().undoLabel).toBe('Change visibility');
    t.store.getState().undo();
    expect(shown()).toBe(false);

    // Shown again by hand, then an edit of the extrude leaves it shown, and says nothing.
    t.store.getState().dispatch(setFeatureVisibility({ ids: [sketch.id], visible: true }));
    const extrude = t.store.getState().doc.features.at(-1)?.id as FeatureId;
    expect(t.controller.edit(extrude)).toBe(true);
    t.controller.setExpr('distance', '7 mm');
    expect(t.controller.ok()).toBe(true);
    expect(shown()).toBeUndefined();
    expect(t.messages).toHaveLength(1);

    // One undo each: the edit, the eye, then the extrude and the hiding together.
    t.store.getState().undo();
    t.store.getState().undo();
    expect(shown()).toBe(false);
    t.store.getState().undo();
    expect(shown()).toBeUndefined();
    expect(t.store.getState().doc.features.map((f) => f.id)).toEqual(['box', sketch.id]);
  });
});

describe('hiddenMessage', () => {
  const features = ['Sketch1', 'Sketch2', 'Sketch3'].map((name, i) => ({
    id: `S${i + 1}` as FeatureId,
    name,
  }));
  it('names one sketch, or lists several', () => {
    expect(hiddenMessage(features, ['S2' as FeatureId], 'Revolve1')).toBe(
      'Sketch2 is hidden: Revolve1 used its profile.',
    );
    expect(hiddenMessage(features, ['S1', 'S3'] as FeatureId[], 'Extrude2')).toBe(
      'Sketch1 and Sketch3 are hidden: Extrude2 used their profiles.',
    );
    expect(hiddenMessage(features, ['S1', 'S2', 'S3'] as FeatureId[], 'Extrude2')).toBe(
      'Sketch1, Sketch2 and Sketch3 are hidden: Extrude2 used their profiles.',
    );
  });
});

describe('the extrude dialog', () => {
  it('is the app’s dialog for the Extrude tool', () => {
    expect(specForCommand(featureDialogs(), 'extrude')).toBe(extrudeDialog);
    expect(extrudeDialog.type).toBe('extrude');
  });

  it('fills its profiles field from a selected text (P4-03)', () => {
    const t = setupDialogs([extrudeDialog]);
    const id = 'T' as FeatureId;
    const data = textSketch({ text: 'Ag', height: 10 });
    t.store.getState().dispatch(
      insertFeature({
        feature: {
          id,
          type: 'sketch',
          name: 'Sketch1',
          suppressed: false,
          inputs: sketchInputs(originPlaneRef('origin:xy'), data),
        },
        index: t.store.getState().doc.features.length,
      }),
    );
    // The text a whole-text pick names (its own ID within the sketch).
    const word = 'word' as SketchEntityId;
    t.session.getState().select([{ kind: 'sketchEntity', id: `${id}/${word}` }]);
    t.controller.start('extrude');
    expect(t.open()?.values.refs.profiles).toEqual([{ kind: 'sketchEntity', id: `${id}/${word}` }]);
    // A sketch curve is not a profile the sweep takes: it fills no field.
    t.controller.cancel();
    t.session.getState().select([{ kind: 'sketchEntity', id: `${id}/l0` }]);
    t.controller.start('extrude');
    expect(t.open()?.values.refs.profiles).toEqual([]);
  });

  it('turns every combination of options into valid inputs and back', () => {
    const ctx = context();
    const { profile } = rectangleSketch();
    let checked = 0;
    for (const direction of EXTRUDE_DIRECTIONS) {
      for (const extent of EXTRUDE_EXTENTS) {
        for (const extent2 of EXTRUDE_EXTENTS) {
          for (const operation of EXTRUDE_OPERATIONS) {
            for (const flip of [false, true]) {
              const v = values({
                refs: {
                  profiles: [profile, TOP],
                  toObject: [VERTEX],
                  toObject2: [TOP],
                  bodies: [{ kind: 'body', id: BOX }],
                },
                exprs: { distance: '12 mm', distance2: 'd9 / 2', taper: '3 deg', taper2: '-2 deg' },
                choices: { direction, extent, extent2, operation },
                toggles: { flip },
              });
              const inputs = inputsFor(extrudeDialog, v, ctx);
              expect(ExtrudeInputsSchema.safeParse(inputs).success).toBe(true);
              const feature = { id: 'E', type: 'extrude', name: 'Extrude1', inputs } as Feature;
              const back = valuesFor(extrudeDialog, feature, ctx);
              // Every shown field comes back as it was.
              for (const field of shownFields(extrudeDialog, v)) {
                const kind = {
                  selection: 'refs',
                  features: 'refs',
                  expression: 'exprs',
                  choice: 'choices',
                  toggle: 'toggles',
                } as Record<string, keyof typeof v>;
                const k = kind[field.kind] as keyof typeof v;
                expect(back[k][field.name], `${field.name} (${direction} ${extent})`).toEqual(
                  v[k][field.name],
                );
              }
              expect(shownFields(extrudeDialog, back).map((f) => f.name)).toEqual(
                shownFields(extrudeDialog, v).map((f) => f.name),
              );
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(3 * 3 * 3 * 4 * 2);
  });

  it('makes the inputs extrudeInputs makes, with only the shown fields', () => {
    const ctx = context();
    const one = inputsFor(extrudeDialog, values({ refs: { profiles: [TOP] } }), ctx);
    expect(one).toEqual(
      extrudeInputs([TOP], {
        direction: 'one-side',
        extent: 'distance',
        distance: '10 mm',
        taper: '0 deg',
        flip: false,
        operation: 'new-body',
      }),
    );
    // Two sides through all, cutting picked bodies: side 2 and the bodies appear, distances go.
    const two = inputsFor(
      extrudeDialog,
      values({
        refs: { profiles: [TOP], bodies: [{ kind: 'body', id: BOX }] },
        choices: {
          direction: 'two-sides',
          extent: 'through-all',
          extent2: 'to-object',
          operation: 'cut',
        },
      }),
      ctx,
    );
    expect(Object.keys(two).sort()).toEqual(
      [
        'profiles',
        'direction',
        'extent',
        'taper',
        'extent2',
        'toObject2',
        'offset2',
        'taper2',
        'flip',
        'operation',
        'bodies',
      ].sort(),
    );
  });

  it('reads an old extrude with no options as the defaults', () => {
    const ctx = context();
    const old: Feature = {
      id: 'E' as FeatureId,
      type: 'extrude',
      name: 'Extrude1',
      suppressed: false,
      inputs: { distance: { kind: 'expr', expr: 'inner / 4', paramName: 'd1', unit: 'length' } },
    };
    const v = valuesFor(extrudeDialog, old, ctx);
    expect(v.choices).toEqual({
      direction: 'one-side',
      extent: 'distance',
      extent2: 'distance',
      operation: 'new-body',
      symmetricMeasure: 'whole',
    });
    expect(v.exprs.distance).toBe('inner / 4');
    expect(v.refs.profiles).toEqual([]);
  });

  it('refuses a symmetric extrude up to an object', () => {
    const ctx = context();
    const v = values({
      refs: { profiles: [TOP], toObject: [VERTEX] },
      choices: { direction: 'symmetric', extent: 'to-object' },
    });
    expect(extrudeDialog.validate?.(v, ctx)).toEqual({
      field: 'extent',
      message: "A symmetric extrude can't end at an object. Use two sides instead.",
    });
    expect(
      extrudeDialog.validate?.({ ...v, choices: { ...v.choices, direction: 'two-sides' } }, ctx),
    ).toBeUndefined();
  });

  it('previews in the operation’s style', () => {
    const style = (operation: string) =>
      extrudeDialog.previewStyle?.(values({ choices: { operation } }));
    expect(['new-body', 'join', 'cut', 'intersect'].map(style)).toEqual([
      'new',
      'join',
      'cut',
      'intersect',
    ]);
  });
});

describe('extrude manipulators', () => {
  /** The arrow or arc of a field; the kinds with no `origin` are a pattern's (P4-12). */
  type WithOrigin = Extract<Manipulator, { origin: unknown }>;
  const at = (ms: readonly Manipulator[], field: string): WithOrigin | undefined =>
    ms.find((m): m is WithOrigin => 'origin' in m && m.field === field);

  it('put a distance arrow on a profile’s centroid along its plane’s normal, flip-aware', () => {
    const { sketch, profile } = rectangleSketch();
    const base = context();
    const ctx = { ...base, doc: { ...base.doc, features: [sketch] } };
    const v = values({ refs: { profiles: [profile] } });
    const ms = extrudeManipulators(v, manipulatorContext(ctx, { distance: 10, taper: 0 }));
    expect(ms.map((m) => `${m.kind}:${m.field}`)).toEqual(['distance:distance', 'angle:taper']);
    const arrow = at(ms, 'distance');
    expect(arrow?.origin).toEqual([20, 5, 0]);
    expect(arrow?.kind === 'distance' && arrow.direction).toEqual([0, 0, 1]);
    // The taper arc sits at the arrow's tip and opens from the direction.
    const arc = at(ms, 'taper');
    expect(arc?.origin).toEqual([20, 5, 10]);
    expect(arc?.kind === 'angle' && round(arc.zero)).toEqual([0, 0, 1]);

    const flipped = extrudeManipulators(
      { ...v, toggles: { flip: true } },
      manipulatorContext(ctx, { distance: 10 }),
    );
    const down = at(flipped, 'distance');
    expect(down?.kind === 'distance' && round(down.direction)).toEqual([0, 0, -1]);
    expect(at(flipped, 'taper')?.origin).toEqual([20, 5, -10]);
  });

  it('start on a picked face, outwards', () => {
    const ms = extrudeManipulators(
      values({ refs: { profiles: [TOP] } }),
      manipulatorContext(context(), { distance: -4 }),
    );
    const arrow = at(ms, 'distance');
    expect(arrow?.origin).toEqual([5, 5, 10]);
    expect(arrow?.kind === 'distance' && arrow.direction).toEqual([0, 0, 1]);
    // A negative distance puts the tip (and the taper arc) inside the box, the arc opening down.
    const arc = at(ms, 'taper');
    expect(arc?.origin).toEqual([5, 5, 6]);
    expect(arc?.kind === 'angle' && round(arc.zero)).toEqual([0, 0, -1]);
  });

  it('halve a symmetric arrow and add side 2’s arrow and arc for two sides', () => {
    const ctx = context();
    const symmetric = extrudeManipulators(
      values({ refs: { profiles: [TOP] }, choices: { direction: 'symmetric' } }),
      manipulatorContext(ctx, { distance: 8 }),
    );
    const half = at(symmetric, 'distance');
    expect(half?.kind === 'distance' && half.scale).toBe(0.5);
    expect(at(symmetric, 'taper')?.origin).toEqual([5, 5, 14]);

    // With the `half` measure (P4-12's amendment) the arrow reaches the
    // distance itself: the value is each side's.
    const perSide = extrudeManipulators(
      values({
        refs: { profiles: [TOP] },
        choices: { direction: 'symmetric', symmetricMeasure: 'half' },
      }),
      manipulatorContext(ctx, { distance: 8 }),
    );
    const reach = at(perSide, 'distance');
    expect(reach?.kind === 'distance' && reach.scale).toBeUndefined();
    expect(at(perSide, 'taper')?.origin).toEqual([5, 5, 18]);

    const two = extrudeManipulators(
      values({ refs: { profiles: [TOP] }, choices: { direction: 'two-sides' } }),
      manipulatorContext(ctx, { distance: 8, distance2: 3 }),
    );
    expect(two.map((m) => `${m.kind}:${m.field}`)).toEqual([
      'distance:distance',
      'angle:taper',
      'distance:distance2',
      'angle:taper2',
    ]);
    const side2 = at(two, 'distance2');
    expect(side2?.kind === 'distance' && round(side2.direction)).toEqual([0, 0, -1]);
    expect(side2?.kind === 'distance' && side2.scale).toBeUndefined();
    expect(at(two, 'taper2')?.origin).toEqual([5, 5, 7]);
  });

  it('stores the symmetric measure only when it is `half`', () => {
    const ctx = context();
    const { profile } = rectangleSketch();
    const inputs = (choices: Record<string, string>) =>
      inputsFor(extrudeDialog, values({ refs: { profiles: [profile] }, choices }), ctx);
    // Whole (the default) makes no input; half does.
    expect(inputs({ direction: 'symmetric' })).not.toHaveProperty('symmetricMeasure');
    expect(inputs({ direction: 'symmetric', symmetricMeasure: 'half' })).toEqual({
      profiles: { kind: 'ref', refs: [profile] },
      distance: { kind: 'expr', expr: '10 mm', unit: 'length' },
      direction: { kind: 'enum', value: 'symmetric' },
      extent: { kind: 'enum', value: 'distance' },
      symmetricMeasure: { kind: 'enum', value: 'half' },
      taper: { kind: 'expr', expr: '0 deg', unit: 'angle' },
      flip: { kind: 'bool', value: false },
      operation: { kind: 'enum', value: 'new-body' },
    });
    // One side and two sides never store it, whatever the select said.
    expect(inputs({ symmetricMeasure: 'half' })).not.toHaveProperty('symmetricMeasure');
    expect(inputs({ direction: 'two-sides', symmetricMeasure: 'half' })).not.toHaveProperty(
      'symmetricMeasure',
    );
    // A stored one-sided extrude reads the select as the default again.
    const back = valuesFor(
      extrudeDialog,
      {
        id: 'E',
        type: 'extrude',
        name: 'Extrude1',
        inputs: inputs({ direction: 'symmetric' }),
      } as Feature,
      ctx,
    );
    expect(back.choices.symmetricMeasure).toBe('whole');
  });

  it('have no arrow for a side that goes to an object or through all', () => {
    const ms = extrudeManipulators(
      values({ refs: { profiles: [TOP] }, choices: { extent: 'through-all' } }),
      manipulatorContext(context(), { distance: 8 }),
    );
    expect(ms.map((m) => `${m.kind}:${m.field}`)).toEqual(['angle:taper']);
    expect(at(ms, 'taper')?.origin).toEqual([5, 5, 10]);
  });

  it('need something picked', () => {
    expect(extrudeManipulators(values({}), manipulatorContext(context(), {}))).toEqual([]);
  });
});

describe('the press-pull proposal', () => {
  const propose = (over: Partial<DialogValues>, distance?: number) =>
    proposeOperation(values(over), { value: (f) => (f === 'distance' ? distance : undefined) })
      ?.choices?.operation;

  it('proposes a new body for profiles, join outwards and cut inwards for faces', () => {
    const { profile } = rectangleSketch();
    expect(propose({ refs: { profiles: [profile] } }, -5)).toBe('new-body');
    expect(propose({ refs: { profiles: [TOP] } }, 5)).toBe('join');
    expect(propose({ refs: { profiles: [TOP] } }, -5)).toBe('cut');
    expect(propose({ refs: { profiles: [TOP] }, toggles: { flip: true } }, 5)).toBe('cut');
    expect(propose({ refs: { profiles: [TOP] }, toggles: { flip: true } }, -5)).toBe('join');
    expect(propose({ refs: { profiles: [TOP] }, choices: { direction: 'symmetric' } }, -5)).toBe(
      'join',
    );
    expect(propose({ refs: { profiles: [TOP] }, choices: { extent: 'through-all' } })).toBe('join');
    expect(
      propose({
        refs: { profiles: [TOP] },
        choices: { extent: 'through-all' },
        toggles: { flip: true },
      }),
    ).toBe('cut');
  });

  it('treats a profile sketched on a face like the face (P2-09)', () => {
    const { sketch, profile } = rectangleSketch();
    const onFace: Feature = {
      ...sketch,
      inputs: sketchInputs(TOP, (sketch.inputs.sketch as { sketch: SketchData }).sketch),
    };
    const doc = { ...context().doc, features: [onFace] };
    const ctx = (distance: number) => ({
      doc,
      value: (f: string) => (f === 'distance' ? distance : undefined),
    });
    const op = (distance: number) =>
      proposeOperation(values({ refs: { profiles: [profile] } }), ctx(distance))?.choices
        ?.operation;
    expect(op(-5)).toBe('cut');
    expect(op(5)).toBe('join');
  });

  it('proposes nothing without picks, up to an object, or without a distance', () => {
    expect(propose({}, 5)).toBeUndefined();
    expect(propose({ refs: { profiles: [TOP] }, choices: { extent: 'to-object' } }, 5)).toBe(
      undefined,
    );
    expect(propose({ refs: { profiles: [TOP] } }, undefined)).toBeUndefined();
    expect(propose({ refs: { profiles: [TOP] } }, 0)).toBeUndefined();
  });

  it('follows the distance in the dialog until the user picks an operation', () => {
    const t = setupDialogs([extrudeDialog]);
    t.session.getState().select([faceItem(1)]);
    t.controller.start('extrude');
    const op = () => (t.open() as OpenDialog).values.choices.operation;
    expect(t.open()?.values.refs.profiles?.map((r) => r.id)).toEqual(['box:top']);
    expect(op()).toBe('join');
    expect(t.open()?.draft.inputs.operation).toEqual({ kind: 'enum', value: 'join' });
    t.controller.setExpr('distance', '-3 mm');
    expect(op()).toBe('cut');
    t.controller.setToggle('flip', true);
    expect(op()).toBe('join');
    t.controller.setChoice('operation', 'intersect');
    t.controller.setExpr('distance', '4 mm');
    expect(op()).toBe('intersect');
  });

  it('keeps an edited feature’s operation when the rule would not have given it', () => {
    const t = setupDialogs([extrudeDialog]);
    const inputs = (operation: 'cut' | 'join') => ({
      ...extrudeInputs([TOP], { distance: '5 mm', operation }),
    });
    const add = (id: string, operation: 'cut' | 'join') =>
      t.store.getState().dispatch(
        insertFeature({
          feature: {
            id: id as FeatureId,
            type: 'extrude',
            name: id,
            suppressed: false,
            inputs: inputs(operation),
          },
        }),
      );
    add('Chosen', 'cut');
    add('Proposed', 'join');
    const op = () => (t.open() as OpenDialog).values.choices.operation;
    // Cut outwards isn't what the rule gives: the user chose it.
    t.controller.edit('Chosen' as FeatureId);
    expect(t.open()?.chosen).toEqual(['operation']);
    t.controller.setExpr('distance', '-5 mm');
    expect(op()).toBe('cut');
    t.controller.setExpr('distance', '6 mm');
    expect(op()).toBe('cut');
    // Join outwards is: pushing the face in turns it into a cut.
    t.controller.edit('Proposed' as FeatureId);
    expect(t.open()?.chosen).toEqual([]);
    expect(op()).toBe('join');
    t.controller.setExpr('distance', '-2 mm');
    expect(op()).toBe('cut');
  });
});
