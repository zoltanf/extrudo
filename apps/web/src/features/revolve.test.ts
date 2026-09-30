import {
  type Feature,
  type FeatureId,
  type GeomRef,
  insertFeature,
  originAxisRef,
  originPlaneRef,
  REVOLVE_DIRECTIONS,
  REVOLVE_OPERATIONS,
  RevolveInputsSchema,
  revolveInputs,
  type SketchData,
  sketchInputs,
  type Vec3,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { outline, profilesOf } from '../project/templates';
import { axisLine, sketchLine } from './geometry';
import { featureDialogs, specForCommand } from './registry';
import {
  proposeRevolveOperation,
  revolveDialog,
  revolveFrame,
  revolveManipulators,
} from './revolve';
import type { DialogContext, DialogValues, ManipulatorContext } from './spec';
import { BOX, namedBoxMesh, setupDialogs } from './testing';
import { defaultValues, inputsFor, mergeValues, shownFields, valuesFor } from './values';

const TOP: GeomRef = { kind: 'face', id: 'box:top' };
const Y = originAxisRef('origin:y');

/** A 20 × 10 mm rectangle sketch on XY from (10, 0), a line along it and a circle. */
function rectangleSketch() {
  const id = 'S' as FeatureId;
  const data = outline([
    [10, 0],
    [30, 0],
    [30, 10],
    [10, 10],
  ]);
  const entities = {
    ...data.entities,
    pa: { type: 'point', x: 0, y: -5 },
    pb: { type: 'point', x: 0, y: 15 },
    axis: { type: 'line', start: 'pa', end: 'pb', construction: true },
    pc: { type: 'point', x: -20, y: 0 },
    round: { type: 'circle', center: 'pc', radius: 2, construction: false },
  } as typeof data.entities;
  const sketch: Feature = {
    id,
    type: 'sketch',
    name: 'Sketch1',
    suppressed: false,
    inputs: sketchInputs(originPlaneRef('origin:xy'), { ...data, entities }),
  };
  const [profile] = profilesOf(id, data);
  return {
    sketch,
    profile: profile as GeomRef,
    line: { kind: 'sketchEntity', id: 'S/axis' } as GeomRef,
    circle: { kind: 'sketchEntity', id: 'S/round' } as GeomRef,
  };
}

function values(over: Partial<DialogValues>): DialogValues {
  return mergeValues(defaultValues(revolveDialog), over);
}

function context(features: Feature[] = []): DialogContext {
  const t = setupDialogs([revolveDialog]);
  for (const feature of features) {
    t.store.getState().dispatch(insertFeature({ feature, index: 0 }));
  }
  return { doc: t.store.getState().doc, bodies: { [BOX]: namedBoxMesh() } };
}

const manipulatorContext = (base: DialogContext): ManipulatorContext => ({
  ...base,
  value: () => 90,
});

/** The operation a revolve of these values proposes with the angle field at `angle` degrees. */
function proposal(over: Partial<DialogValues>, angle: number | undefined) {
  const ctx = { ...context(), value: () => angle } as ManipulatorContext;
  return proposeRevolveOperation(values(over), ctx)?.choices?.operation;
}

const round = (v: Vec3) => v.map((c) => Math.round(c * 1000) / 1000 + 0);

describe('the revolve dialog', () => {
  it('is the app’s dialog for the Revolve tool', () => {
    expect(specForCommand(featureDialogs(), 'revolve')).toBe(revolveDialog);
    expect(revolveDialog.type).toBe('revolve');
    // A whole turn by default.
    expect(defaultValues(revolveDialog).exprs.angle).toBe('360 deg');
  });

  it('turns every combination of options into valid inputs and back', () => {
    const { sketch, profile, line } = rectangleSketch();
    const ctx = context([sketch]);
    let checked = 0;
    for (const direction of REVOLVE_DIRECTIONS) {
      for (const operation of REVOLVE_OPERATIONS) {
        for (const flip of [false, true]) {
          for (const axis of [Y, line, { kind: 'edge', id: 'box:e3' } as GeomRef]) {
            const v = values({
              refs: { profiles: [profile, TOP], axis: [axis], bodies: [{ kind: 'body', id: BOX }] },
              exprs: { angle: '120 deg', angle2: 'd9 / 2' },
              choices: { direction, operation },
              toggles: { flip },
            });
            const inputs = inputsFor(revolveDialog, v, ctx);
            expect(RevolveInputsSchema.safeParse(inputs).success).toBe(true);
            const feature = { id: 'V', type: 'revolve', name: 'Revolve1', inputs } as Feature;
            const back = valuesFor(revolveDialog, feature, ctx);
            for (const field of shownFields(revolveDialog, v)) {
              const kind = {
                selection: 'refs',
                features: 'refs',
                expression: 'exprs',
                choice: 'choices',
                toggle: 'toggles',
              } as const;
              const k = kind[field.kind];
              expect(back[k][field.name], `${field.name} (${direction})`).toEqual(v[k][field.name]);
            }
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(3 * 4 * 2 * 3);
  });

  it('makes the inputs revolveInputs makes, with only the shown fields', () => {
    const { sketch, profile, line } = rectangleSketch();
    const ctx = context([sketch]);
    const inputs = inputsFor(
      revolveDialog,
      values({ refs: { profiles: [profile], axis: [line] }, exprs: { angle: '90 deg' } }),
      ctx,
    );
    expect(inputs).toEqual({
      ...revolveInputs([profile], line, {
        direction: 'one-side',
        angle: '90 deg',
        flip: false,
        operation: 'new-body',
      }),
    });
    // Two sides adds angle 2; a new body has no bodies.
    const two = inputsFor(
      revolveDialog,
      values({ refs: { profiles: [profile], axis: [Y] }, choices: { direction: 'two-sides' } }),
      ctx,
    );
    expect(two.angle2).toEqual({ kind: 'expr', expr: '90 deg', unit: 'angle' });
    expect(two.bodies).toBeUndefined();
  });

  it('wants a straight sketch line for the axis', () => {
    const { sketch, profile, line, circle } = rectangleSketch();
    const ctx = context([sketch]);
    expect(
      revolveDialog.validate?.(values({ refs: { profiles: [profile], axis: [line] } }), ctx),
    ).toBeUndefined();
    expect(
      revolveDialog.validate?.(values({ refs: { profiles: [profile], axis: [circle] } }), ctx),
    ).toEqual({ field: 'axis', message: 'Pick a straight line for the axis.' });
  });

  it('proposes a new body for profiles and a join for faces', () => {
    const { profile } = rectangleSketch();
    expect(proposal({ refs: { profiles: [profile] } }, 90)).toBe('new-body');
    expect(proposal({ refs: { profiles: [TOP] } }, 90)).toBe('join');
    expect(proposal({}, 90)).toBeUndefined();
  });

  it('proposes a cut for a face turned into its body, a join out of it (P3-08)', () => {
    // TOP is the top of the box (z = 10, normal +Z): a positive turn about the Y axis
    // takes its centre (5, 5, 10) down and across, into the box.
    const refs = { profiles: [TOP], axis: [Y] };
    expect(proposal({ refs }, 90)).toBe('cut');
    expect(proposal({ refs, toggles: { flip: true } }, 90)).toBe('join');
    expect(proposal({ refs }, -90)).toBe('join');
    expect(proposal({ refs, toggles: { flip: true } }, -90)).toBe('cut');
    // A whole turn, symmetric and two-sided turns go both ways.
    expect(proposal({ refs }, 360)).toBe('join');
    expect(proposal({ refs, choices: { direction: 'symmetric' } }, 90)).toBe('join');
    expect(proposal({ refs, choices: { direction: 'two-sides' } }, 90)).toBe('join');
    // Without an axis the way isn't known: the join it always proposed. No angle, no proposal.
    expect(proposal({ refs: { profiles: [TOP] } }, 90)).toBe('join');
    expect(proposal({ refs }, undefined)).toBeUndefined();
  });

  it('treats a profile sketched on a face like the face (P2-09, P3-08)', () => {
    const { sketch, profile } = rectangleSketch();
    const onFace: Feature = {
      ...sketch,
      inputs: sketchInputs(TOP, (sketch.inputs.sketch as { sketch: SketchData }).sketch),
    };
    const ctx = (angle: number): Pick<ManipulatorContext, 'value' | 'doc'> => ({
      doc: context([onFace]).doc,
      value: () => angle,
    });
    const op = (over: Partial<DialogValues>, angle: number) =>
      proposeRevolveOperation(
        values({ refs: { profiles: [profile], axis: [Y] }, ...over }),
        ctx(angle),
      )?.choices?.operation;
    // Drawn on a body's face the profile joins or cuts; on a plain plane it is a new body.
    expect(op({}, 360)).toBe('join');
    expect(['join', 'cut']).toContain(op({}, 90));
    const plain = { ...ctx(90), doc: context([sketch]).doc };
    expect(proposeRevolveOperation(values({ refs: { profiles: [profile] } }), plain)).toEqual({
      choices: { operation: 'new-body' },
    });
  });

  it('fills the profiles and the axis from what was selected before Revolve', () => {
    const t = setupDialogs([revolveDialog]);
    const { sketch, profile } = rectangleSketch();
    t.store.getState().dispatch(insertFeature({ feature: sketch, index: 1 }));
    t.session.getState().select([
      { kind: 'axis', id: 'origin:y' },
      { kind: 'profile', id: profile.id },
    ]);
    t.controller.start('revolve');
    expect(t.open()?.values.refs.profiles).toEqual([profile]);
    expect(t.open()?.values.refs.axis).toEqual([Y]);
  });
});

describe('revolve arcs', () => {
  it('turn about the axis from the profiles’ side, reversed by Flip', () => {
    const { sketch, profile } = rectangleSketch();
    const ctx = context([sketch]);
    const frame = revolveFrame(values({ refs: { profiles: [profile], axis: [Y] } }), ctx);
    // The rectangle's centre (20, 5, 0) is 20 mm from the Y axis along +X.
    expect(frame && round(frame.axis.origin)).toEqual([0, 5, 0]);
    expect(frame && round(frame.zero)).toEqual([1, 0, 0]);
    const [arc] = revolveManipulators(
      values({ refs: { profiles: [profile], axis: [Y] } }),
      manipulatorContext(ctx),
    );
    expect(arc).toMatchObject({ kind: 'angle', field: 'angle', axis: [0, 1, 0], fullTurn: true });
    const flipped = revolveManipulators(
      values({ refs: { profiles: [profile], axis: [Y] }, toggles: { flip: true } }),
      manipulatorContext(ctx),
    );
    expect(round(flipped[0]?.kind === 'angle' ? flipped[0].axis : [0, 0, 0])).toEqual([0, -1, 0]);
  });

  it('show half the angle when symmetric, and one arc per side for two sides', () => {
    const { sketch, profile } = rectangleSketch();
    const ctx = manipulatorContext(context([sketch]));
    const refs = { profiles: [profile], axis: [Y] };
    const symmetric = revolveManipulators(
      values({ refs, choices: { direction: 'symmetric' } }),
      ctx,
    );
    expect(symmetric).toHaveLength(1);
    expect(symmetric[0]).toMatchObject({ scale: 0.5 });
    const two = revolveManipulators(values({ refs, choices: { direction: 'two-sides' } }), ctx);
    expect(two.map((m) => m.field)).toEqual(['angle', 'angle2']);
    expect(two[1]).toMatchObject({ axis: [-0, -1, -0] });
    // Nothing until both are picked.
    expect(revolveManipulators(values({ refs: { profiles: [profile] } }), ctx)).toEqual([]);
  });
});

describe('axis lines', () => {
  it('of origin axes, sketch lines and straight mesh edges', () => {
    const { sketch, line, circle } = rectangleSketch();
    const ctx = context([sketch]);
    expect(axisLine(Y, ctx)).toEqual({ origin: [0, 0, 0], direction: [0, 1, 0] });
    expect(axisLine(line, ctx)).toEqual({ origin: [0, -5, 0], direction: [0, 1, 0] });
    expect(sketchLine(ctx.doc, line)).toEqual([
      [0, -5, 0],
      [0, 15, 0],
    ]);
    expect(axisLine(circle, ctx)).toBeUndefined();
    const edge = axisLine({ kind: 'edge', id: 'box:e0' }, ctx);
    expect(edge && Math.hypot(...edge.direction)).toBeCloseTo(1);
    expect(axisLine({ kind: 'edge', id: 'nope' }, ctx)).toBeUndefined();
    expect(axisLine({ kind: 'axis', id: 'origin:w' }, ctx)).toBeUndefined();
  });
});
