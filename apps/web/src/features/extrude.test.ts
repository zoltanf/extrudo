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
  sketchInputs,
  type Vec3,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { outline, profilesOf } from '../project/templates';
import type { OpenDialog } from './dialog';
import { extrudeDialog, extrudeManipulators, proposeOperation } from './extrude';
import { featureDialogs, specForCommand } from './registry';
import type { DialogContext, DialogValues, Manipulator, ManipulatorContext } from './spec';
import { BOX, faceItem, namedBoxMesh, setupDialogs } from './testing';
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

describe('the extrude dialog', () => {
  it('is the app’s dialog for the Extrude tool', () => {
    expect(specForCommand(featureDialogs(), 'extrude')).toBe(extrudeDialog);
    expect(extrudeDialog.type).toBe('extrude');
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
                  expression: 'exprs',
                  choice: 'choices',
                  toggle: 'toggles',
                } as const;
                const k = kind[field.kind];
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
  const at = (ms: readonly Manipulator[], field: string) => ms.find((m) => m.field === field);

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
