import {
  type Feature,
  type FeatureId,
  insertFeature,
  originPlaneRef,
  RIB_CURVE_KINDS,
  RIB_SIDES,
  RibInputsSchema,
  type RibSide,
  ribInputs,
  type SketchData,
  sketchInputs,
  type Vec3,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { describe, expect, it } from 'vitest';
import { canCommit, type OpenDialog } from './dialog';
import { featureDialogs, specForCommand } from './registry';
import { ribDialog, ribManipulators } from './rib';
import type { DialogContext, DialogValues, ManipulatorContext } from './spec';
import { BOX, namedBoxMesh, setupDialogs } from './testing';
import { defaultValues, inputsFor, mergeValues, shownFields, valuesFor } from './values';

const bodies = { [BOX]: namedBoxMesh() };

const values = (over: Partial<DialogValues> = {}): DialogValues =>
  mergeValues(defaultValues(ribDialog), over);

const round = (v: Vec3 | undefined): number[] =>
  (v ?? []).map((c) => Math.round(c * 1000) / 1000 + 0);

/**
 * A sketch on XZ with one line: an L-bracket's rib line, from the wall's inner
 * face at (2, 40) to the base's top at (30, 2), and its reference.
 */
function ribSketch() {
  const t = setupDialogs([ribDialog]);
  const b = new SketchBuilder();
  const line = b.line(2, 40, 30, 2);
  const data = b.sketch as SketchData;
  const sketch: Feature = {
    id: 'SR' as FeatureId,
    type: 'sketch',
    name: 'Sketch1',
    suppressed: false,
    inputs: sketchInputs(originPlaneRef('origin:xz'), data),
  };
  t.store.getState().dispatch(insertFeature({ feature: sketch, index: 1 }));
  return { ...t, sketch, line: { kind: 'sketchEntity', id: `SR/${line.id}` } as const };
}

const context = (t: ReturnType<typeof ribSketch>): DialogContext => ({
  doc: t.store.getState().doc,
  bodies,
});

describe('the rib dialog', () => {
  it('is the app’s dialog for the Rib tool, a create feature', () => {
    expect(specForCommand(featureDialogs(), 'rib')).toBe(ribDialog);
    expect(featureDialogs().get('rib')).toBe(ribDialog);
    expect(ribDialog.category).toBe('create');
    expect(ribDialog.command).toBe('rib');
    expect(ribDialog.fields.map((f) => f.name)).toEqual(['curve', 'thickness', 'side', 'flip']);
    expect(ribDialog.fields.map((f) => f.label)).toEqual([
      'Line',
      'Thickness',
      'Thickness side',
      'Flip',
    ]);
    // A 2 mm wall centred on the sketch plane, as the ADR has it.
    const defaults = defaultValues(ribDialog);
    expect(defaults.exprs.thickness).toBe('2 mm');
    expect(defaults.choices.side).toBe('both');
    expect(defaults.toggles.flip).toBe(false);
  });

  it('takes one sketch line, a thickness, the side and flip', () => {
    expect(ribDialog.fields.find((f) => f.name === 'curve')).toMatchObject({
      kind: 'selection',
      accepts: RIB_CURVE_KINDS,
      max: 1,
    });
    expect(ribDialog.fields.find((f) => f.name === 'thickness')).toMatchObject({
      kind: 'expression',
      unit: 'length',
      default: '2 mm',
    });
    expect(ribDialog.fields.find((f) => f.name === 'side')).toMatchObject({
      kind: 'choice',
      default: 'both',
      options: RIB_SIDES.map((value) => ({
        value,
        label: value === 'both' ? 'Centred' : value === 'one' ? 'One side' : 'Other side',
      })),
    });
    expect(ribDialog.fields.find((f) => f.name === 'flip')).toMatchObject({
      kind: 'toggle',
      default: false,
    });
  });

  it('turns every combination of options into valid inputs and back', () => {
    const t = ribSketch();
    const ctx = context(t);
    let checked = 0;
    for (const side of RIB_SIDES) {
      for (const flip of [false, true]) {
        const v = values({
          refs: { curve: [t.line] },
          exprs: { thickness: '3 mm' },
          choices: { side },
          toggles: { flip },
        });
        const inputs = inputsFor(ribDialog, v, ctx);
        expect(RibInputsSchema.safeParse(inputs).success).toBe(true);
        expect(inputs).toEqual(ribInputs(t.line, { thickness: '3 mm', side, flip }));
        const back = valuesFor(
          ribDialog,
          { id: 'R', type: 'rib', name: 'Rib1', inputs } as Feature,
          ctx,
        );
        for (const field of shownFields(ribDialog, v)) {
          const k =
            field.kind === 'selection'
              ? 'refs'
              : field.kind === 'expression'
                ? 'exprs'
                : field.kind === 'choice'
                  ? 'choices'
                  : 'toggles';
          expect(back[k][field.name], field.name).toEqual(v[k][field.name]);
        }
        checked++;
      }
    }
    expect(checked).toBe(RIB_SIDES.length * 2);
  });

  it('reads a feature stored by ribInputs', () => {
    const t = ribSketch();
    const ctx = context(t);
    const v = valuesFor(
      ribDialog,
      {
        id: 'R',
        type: 'rib',
        name: 'Rib1',
        inputs: ribInputs(t.line, { thickness: '5 mm', side: 'one' }),
      } as Feature,
      ctx,
    );
    expect(v.refs.curve).toEqual([t.line]);
    expect(v.exprs.thickness).toBe('5 mm');
    expect(v.choices.side).toBe('one');
  });

  it('wants a line, and a thickness above 0', () => {
    const t = ribSketch();
    t.controller.start('rib');
    // Nothing picked: the first field asks for itself.
    expect(t.open()?.pickField).toBe('curve');
    expect(t.open()?.checked.fields).toEqual({ curve: 'Pick a sketch line.' });
    expect(canCommit(t.open() as OpenDialog)).toBe(false);
    t.controller.setRefs('curve', [t.line]);
    expect(t.open()?.checked.first).toBeUndefined();
    expect(canCommit(t.open() as OpenDialog)).toBe(true);
    t.controller.setExpr('thickness', '0 mm');
    expect(t.open()?.checked.first).toEqual({
      field: 'thickness',
      message: 'The thickness must be greater than 0.',
    });
    expect(canCommit(t.open() as OpenDialog)).toBe(false);
    t.controller.setExpr('thickness', '-2 mm');
    expect(t.open()?.checked.fields.thickness).toBe('The thickness must be greater than 0.');
    // A thickness the dialog can't read itself is the framework's business.
    t.controller.setExpr('thickness', 'd1');
    expect(t.open()?.checked.first).toBeUndefined();
  });

  it('a selected sketch line fills the Line field', () => {
    const t = ribSketch();
    t.session.getState().select([t.line]);
    t.controller.start('rib');
    expect(t.open()?.values.refs).toEqual({ curve: [t.line] });
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'rib', name: 'Rib1' });
    expect(feature?.inputs.curve).toEqual({ kind: 'ref', refs: [t.line] });
  });

  it('draws the preview as the join it makes', () => {
    expect(ribDialog.previewStyle?.(values())).toBe('join');
  });
});

describe("the rib's arrows", () => {
  const arrows = (t: ReturnType<typeof ribSketch>, over: Partial<DialogValues> = {}) =>
    ribManipulators(values({ refs: { curve: [t.line] }, ...over }), {
      ...context(t),
      value: () => 2,
    } as ManipulatorContext);

  it('are the thickness across the sketch plane and the way the wall grows', () => {
    const t = ribSketch();
    const handles = arrows(t);
    expect(handles).toHaveLength(2);
    const [thickness, flip] = handles;
    // The line's middle on XZ: (16, 0, 21); a centred wall's arrow starts half
    // a thickness below it (the XZ normal is −Y) and is half its length.
    expect(thickness?.kind).toBe('distance');
    expect(thickness?.field).toBe('thickness');
    expect(round(thickness?.kind === 'distance' ? thickness.origin : undefined)).toEqual([
      16, 1, 21,
    ]);
    expect(round(thickness?.kind === 'distance' ? thickness.direction : undefined)).toEqual([
      0, -1, 0,
    ]);
    expect(thickness?.kind === 'distance' ? thickness.scale : 1).toBe(0.5);
    expect(flip?.kind).toBe('arrow');
    expect(flip?.field).toBe('flip');
    expect(round(flip?.kind === 'arrow' ? flip.origin : undefined)).toEqual([16, 0, 21]);
  });

  it('move the thickness arrow for a wall on one side of the plane', () => {
    const t = ribSketch();
    for (const [side, origin] of [
      ['one', [16, 0, 21]],
      ['other', [16, 2, 21]],
    ] as [RibSide, number[]][]) {
      const handle = arrows(t, { choices: { side } })[0];
      expect(round(handle?.kind === 'distance' ? handle.origin : undefined)).toEqual(origin);
      // The whole thickness from its own plane, so no half scale.
      expect(handle?.kind === 'distance' ? handle.scale : 0.5).toBeUndefined();
    }
  });

  it('turn the flip arrow to the other side of the line', () => {
    const t = ribSketch();
    const way = (over: Partial<DialogValues>): Vec3 | undefined => {
      const handle = arrows(t, over)[1];
      return handle?.kind === 'arrow' ? handle.direction : undefined;
    };
    // Square to the line, and towards the body's mass: away from the line's
    // up-right side, down towards the corner the wall fills.
    const towards = way({});
    expect(round(towards)).toEqual([-0.805, 0, -0.593]);
    // Square to the line itself: the dot product of the two is 0.
    const length = Math.hypot(28, 38);
    expect(
      (towards as Vec3)[0] * (28 / length) + (towards as Vec3)[2] * (-38 / length),
    ).toBeCloseTo(0, 12);
    // The other way round is exactly its opposite.
    const flipped = way({ toggles: { flip: true } }) as Vec3;
    expect(flipped[0]).toBeCloseTo(-(towards as Vec3)[0], 12);
    expect(flipped[2]).toBeCloseTo(-(towards as Vec3)[2], 12);
  });

  it('are nothing without a line, or a line the document has not got', () => {
    const t = setupDialogs([ribDialog]);
    const empty = { doc: t.store.getState().doc, bodies, value: () => 2 } as ManipulatorContext;
    expect(ribManipulators(values(), empty)).toEqual([]);
    expect(
      ribManipulators(
        values({ refs: { curve: [{ kind: 'sketchEntity', id: 'gone/l0' }] } }),
        empty,
      ),
    ).toEqual([]);
  });
});
