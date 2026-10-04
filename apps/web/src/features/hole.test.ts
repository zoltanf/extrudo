import {
  addParameter,
  createDocument,
  type DocumentStore,
  type Feature,
  type FeatureId,
  type GeomRef,
  HOLE_DEFAULT_PLANE,
  HOLE_PRESETS,
  HoleInputsSchema,
  holeInputs,
  insertFeature,
  newId,
  originPlaneRef,
  type ParameterId,
  type SketchData,
  sketchInputs,
  TOLERANCE_PARAMETER,
  type Vec3,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER } from '../selection/filter';
import { repeatableFeatures } from './featureList';
import {
  holeDialog,
  holeManipulators,
  holeOnChange,
  holePlaceAt,
  presetOf,
  proposeHole,
} from './hole';
import { dialogPlanePicker } from './planePicker';
import { fieldFilter } from './refs';
import { featureDialogs, specForCommand } from './registry';
import type { DialogValues, ManipulatorContext } from './spec';
import { BOX, faceItem, namedBoxMesh, setupDialogs } from './testing';
import { defaultValues, inputsFor, mergeValues, shownFields, valuesFor } from './values';

/** The 10 mm test box's top face (z = 10). */
const TOP: GeomRef = { kind: 'face', id: 'box:top' };
const XY = originPlaneRef('origin:xy');

const bodies = { [BOX]: namedBoxMesh() };

/** Round-trips a 0.2 mm print tolerance into the document (P4-08). */
const toleranceParameter = () => ({
  id: newId<ParameterId>(),
  name: TOLERANCE_PARAMETER,
  expression: '0.2 mm',
  unit: 'length' as const,
});

const addTolerance = (store: DocumentStore) =>
  store.getState().dispatch(addParameter({ parameter: toleranceParameter() }));

const values = (over: Partial<DialogValues> = {}): DialogValues =>
  mergeValues(defaultValues(holeDialog), over);

const withValues = (numbers: Record<string, number> = {}): ManipulatorContext => ({
  doc: setupDialogs().store.getState().doc,
  bodies,
  value: (field) => numbers[field],
});

const round = (v: readonly number[]) => v.map((c) => Math.round(c * 1000) / 1000 + 0);

/** A document with a sketch on XY holding two points, and the dialogs on it. */
function withSketch() {
  const t = setupDialogs([holeDialog]);
  const b = new SketchBuilder();
  const p1 = b.point(2, 3);
  const p2 = b.point(6, 7);
  const line = b.line(0, 0, 4, 0);
  const sketch: Feature = {
    id: 'SK' as FeatureId,
    type: 'sketch',
    name: 'Sketch1',
    suppressed: false,
    inputs: sketchInputs(XY, b.sketch as SketchData),
  };
  t.store.getState().dispatch(insertFeature({ feature: sketch, index: 1 }));
  const point = (id: string): GeomRef => ({ kind: 'sketchEntity', id: `SK/${id}` });
  return { ...t, p1: point(p1), p2: point(p2), line: point(line.id) };
}

describe('the hole dialog', () => {
  it('is the app’s dialog for the Hole tool', () => {
    const dialogs = featureDialogs();
    expect(specForCommand(dialogs, 'hole')).toBe(holeDialog);
    expect(dialogs.get('hole')).toBe(holeDialog);
    expect(holeDialog.fields.map((f) => f.name)).toEqual([
      'plane',
      'points',
      'x',
      'y',
      'preset',
      'type',
      'extent',
      'diameter',
      'depth',
      'tipAngle',
      'cbDiameter',
      'cbDepth',
      'csDiameter',
      'csAngle',
      'flip',
    ]);
  });

  it('shows the fields that apply: a through simple hole at a point has no depth', () => {
    const shown = (over: Partial<DialogValues>) =>
      shownFields(holeDialog, values(over)).map((f) => f.name);
    expect(shown({})).toEqual([
      'plane',
      'points',
      'x',
      'y',
      'preset',
      'type',
      'extent',
      'diameter',
      'flip',
    ]);
    expect(shown({ choices: { extent: 'blind' } })).toContain('tipAngle');
    expect(shown({ choices: { type: 'counterbore' } })).toEqual(
      expect.arrayContaining(['cbDiameter', 'cbDepth']),
    );
    expect(shown({ choices: { type: 'countersink' } })).toEqual(
      expect.arrayContaining(['csDiameter', 'csAngle']),
    );
    // With sketch points X and Y go.
    const points = shown({ refs: { points: [{ kind: 'sketchEntity', id: 'SK/p1' }] } });
    expect(points).not.toContain('x');
    expect(points).not.toContain('y');
  });

  it('makes valid inputs without a Preset, and reads them back', () => {
    const ctx = { doc: setupDialogs().store.getState().doc, bodies };
    const v = values({
      refs: { plane: [TOP] },
      exprs: { x: '3 mm', diameter: 'd9 / 2', depth: '8 mm' },
      choices: { type: 'counterbore', extent: 'blind' },
      toggles: { flip: true },
    });
    const inputs = inputsFor(holeDialog, v, ctx);
    expect(HoleInputsSchema.safeParse(inputs).success).toBe(true);
    expect('preset' in inputs).toBe(false);
    expect(Object.keys(inputs).sort()).toEqual(
      [
        'plane',
        'points',
        'x',
        'y',
        'type',
        'extent',
        'diameter',
        'depth',
        'tipAngle',
        'cbDiameter',
        'cbDepth',
        'flip',
      ].sort(),
    );
    const back = valuesFor(
      holeDialog,
      { id: 'H', type: 'hole', name: 'Hole1', inputs } as Feature,
      ctx,
    );
    expect(back.exprs).toMatchObject({ x: '3 mm', diameter: 'd9 / 2', depth: '8 mm' });
    expect(back.choices).toMatchObject({ type: 'counterbore', extent: 'blind' });
    expect(back.toggles.flip).toBe(true);
    expect(back.refs.plane).toEqual([TOP]);
  });

  it('reads a hole stored by holeInputs, without a plane: on XY', () => {
    const ctx = { doc: setupDialogs().store.getState().doc, bodies };
    const feature = {
      id: 'H',
      type: 'hole',
      name: 'Hole1',
      inputs: holeInputs({ numbers: { diameter: '6 mm' } }),
    } as Feature;
    const v = valuesFor(holeDialog, feature, ctx);
    expect(v.refs.plane).toEqual([HOLE_DEFAULT_PLANE]);
    expect(v.exprs.diameter).toBe('6 mm');
  });

  it('wants a flat face and sketch points, not curves', () => {
    const t = withSketch();
    const ctx = { doc: t.store.getState().doc, bodies: t.model.getState().bodies };
    expect(
      holeDialog.validate?.(values({ refs: { plane: [TOP], points: [t.p1] } }), ctx),
    ).toBeUndefined();
    expect(holeDialog.validate?.(values({ refs: { points: [t.line] } }), ctx)).toEqual({
      field: 'points',
      message: 'Pick sketch points, not curves.',
    });
    // A curved face.
    const curved = namedBoxMesh();
    const positions = Float32Array.from(curved.positions);
    positions[6 * 3 + 2] = 13;
    expect(
      holeDialog.validate?.(values({ refs: { plane: [TOP] } }), {
        ...ctx,
        bodies: { [BOX]: { ...curved, positions } },
      }),
    ).toEqual({ field: 'plane', message: 'Pick a flat face or a plane.' });
  });
});

describe('presets', () => {
  it('choosing one fills the sizes and the dropdowns it sets, and shows as chosen', () => {
    const t = setupDialogs([holeDialog]);
    t.controller.start('hole');
    t.controller.setChoice('preset', 'm3-insert');
    expect(t.open()?.values.exprs).toMatchObject({
      diameter: '4 mm',
      depth: '6.5 mm',
      tipAngle: '0 deg',
    });
    expect(t.open()?.values.choices).toMatchObject({ type: 'simple', extent: 'blind' });
    expect(t.open()?.values.choices.preset).toBe('m3-insert');
    // The stored inputs are the plain values: no preset.
    const inputs = t.open()?.draft.inputs ?? {};
    expect(inputs.preset).toBeUndefined();
    expect(inputs.diameter).toMatchObject({ kind: 'expr', expr: '4 mm', unit: 'length' });
    expect(inputs.extent).toEqual({ kind: 'enum', value: 'blind' });
  });

  it('a clearance preset fills the counterbore and countersink sizes as well', () => {
    const t = setupDialogs([holeDialog]);
    t.controller.start('hole');
    t.controller.setChoice('preset', 'm4-clearance');
    expect(t.open()?.values.exprs).toMatchObject({
      diameter: '4.5 mm',
      cbDiameter: '7.5 mm',
      cbDepth: '4.3 mm',
      csDiameter: '9 mm',
      csAngle: '90 deg',
    });
    // The hole stays through and simple: a preset says nothing about those.
    expect(t.open()?.values.choices).toMatchObject({ type: 'simple', extent: 'through' });
    t.controller.setChoice('type', 'counterbore');
    expect(t.open()?.values.choices.preset).toBe('m4-clearance');
  });

  it('editing a size leaves the preset: back to Custom; typing a preset’s size finds it', () => {
    const t = setupDialogs([holeDialog]);
    t.controller.start('hole');
    t.controller.setChoice('preset', 'm3-clearance');
    t.controller.setExpr('diameter', '3.5 mm');
    expect(t.open()?.values.choices.preset).toBe('custom');
    t.controller.setExpr('diameter', '5.5 mm');
    expect(t.open()?.values.choices.preset).toBe('m5-clearance');
    // Choosing Custom keeps the sizes.
    t.controller.setChoice('preset', 'custom');
    expect(t.open()?.values.exprs.diameter).toBe('5.5 mm');
    expect(t.open()?.values.choices.preset).toBe('custom');
  });

  it('an insert preset is left by changing the extent', () => {
    const t = setupDialogs([holeDialog]);
    t.controller.start('hole');
    t.controller.setChoice('preset', 'm2-insert');
    t.controller.setChoice('extent', 'through');
    expect(t.open()?.values.choices.preset).toBe('custom');
  });

  it('every preset is recognised by its own values, and only by them', () => {
    const ctx = { doc: createDocument() };
    for (const preset of HOLE_PRESETS) {
      const v = mergeValues(values(), {
        exprs: preset.exprs,
        choices: preset.choices ?? {},
      });
      expect(presetOf(v), preset.id).toBe(preset.id);
      expect(
        holeOnChange('preset', { ...v, choices: { ...v.choices, preset: preset.id } }, ctx),
      ).toEqual({
        exprs: preset.exprs,
        choices: { ...preset.choices, preset: preset.id },
      });
    }
    expect(presetOf(values())).toBe('custom');
    expect(holeOnChange('preset', values(), ctx)).toBeUndefined();
  });

  it('in a document with a tolerance a preset adds it to every diameter (P4-08)', () => {
    const t = setupDialogs([holeDialog]);
    addTolerance(t.store);
    t.controller.start('hole');
    t.controller.setChoice('preset', 'm4-clearance');
    expect(t.open()?.values.exprs).toMatchObject({
      diameter: '4.5 mm + 2 * tolerance',
      cbDiameter: '7.5 mm + 2 * tolerance',
      csDiameter: '9 mm + 2 * tolerance',
      // Depths and angles are the sizes themselves.
      cbDepth: '4.3 mm',
      csAngle: '90 deg',
    });
    // The sizes are the preset's, so the dropdown still shows it.
    expect(t.open()?.values.choices.preset).toBe('m4-clearance');
    // Both forms are the preset's sizes, whatever the spacing; anything else leaves it.
    t.controller.setExpr('diameter', '4.5 mm+2*tolerance');
    expect(t.open()?.values.choices.preset).toBe('m4-clearance');
    t.controller.setExpr('diameter', '4.5 mm');
    expect(t.open()?.values.choices.preset).toBe('m4-clearance');
    t.controller.setExpr('diameter', '5 mm');
    expect(t.open()?.values.choices.preset).toBe('custom');
  });

  it('a stored hole whose sizes carry the tolerance shows its preset', () => {
    const ctx = {
      doc: { ...setupDialogs().store.getState().doc, parameters: [toleranceParameter()] },
      bodies,
    };
    const feature = {
      id: 'H',
      type: 'hole',
      name: 'Hole1',
      inputs: holeInputs({ numbers: { diameter: '3.4 mm + 2 * tolerance' } }),
    } as Feature;
    expect(valuesFor(holeDialog, feature, ctx).choices.preset).toBe('m3-clearance');
  });

  it('shows the preset of a stored hole when the dialog edits it', () => {
    const ctx = { doc: setupDialogs().store.getState().doc, bodies };
    const inputs = holeInputs({
      extent: 'blind',
      numbers: { diameter: '5.6 mm', depth: '8.5 mm', tipAngle: '0 deg' },
    });
    const feature = { id: 'H', type: 'hole', name: 'Hole1', inputs } as Feature;
    expect(valuesFor(holeDialog, feature, ctx).choices.preset).toBe('m4-insert');
  });
});

describe('placing the hole', () => {
  it('opens on the XY plane; a picked face gives its centre as X and Y', () => {
    const t = setupDialogs([holeDialog]);
    t.controller.start('hole');
    expect(t.open()?.values.refs.plane).toEqual([XY]);
    expect(t.open()?.values.exprs).toMatchObject({ x: '0 mm', y: '0 mm' });
    dialogPlanePicker(t.controller, t.open(), t.session, undefined)?.faces?.onPick(faceItem(1));
    expect(t.open()?.values.refs.plane).toEqual([TOP]);
    expect(t.open()?.values.exprs).toMatchObject({ x: '5 mm', y: '5 mm' });
  });

  it('takes a face selected before the tool', () => {
    const t = setupDialogs([holeDialog]);
    t.session.getState().select([faceItem(1)]);
    t.controller.start('hole');
    expect(t.open()?.values.refs.plane).toEqual([TOP]);
    expect(t.open()?.values.exprs).toMatchObject({ x: '5 mm', y: '5 mm' });
  });

  it('a click on a face puts the hole where it landed, and again moves it', () => {
    const t = setupDialogs([holeDialog]);
    t.controller.start('hole');
    const picker = () => dialogPlanePicker(t.controller, t.open(), t.session, undefined);
    picker()?.faces?.onPick(faceItem(1), [2, 7.5, 10]);
    expect(t.open()?.values.refs.plane).toEqual([TOP]);
    expect(t.open()?.values.exprs).toMatchObject({ x: '2 mm', y: '7.5 mm' });
    // The same face again: still picked, the point moves.
    picker()?.faces?.onPick(faceItem(1), [8.123, 1.987, 10]);
    expect(t.open()?.values.refs.plane).toEqual([TOP]);
    expect(t.open()?.values.exprs).toMatchObject({ x: '8.12 mm', y: '1.99 mm' });
    // A click on an origin plane's square works the same.
    picker()?.onPick('origin:xy', [-4, 6, 0]);
    expect(t.open()?.values.refs.plane).toEqual([XY]);
    expect(t.open()?.values.exprs).toMatchObject({ x: '-4 mm', y: '6 mm' });
  });

  it('a clicked point (in the face’s own frame) is what holePlaceAt gives', () => {
    const v = values({ refs: { plane: [TOP], points: [{ kind: 'sketchEntity', id: 'SK/p1' }] } });
    expect(holePlaceAt([2, 7.5, 10], v, withValues())).toEqual({
      refs: { points: [] },
      exprs: { x: '2 mm', y: '7.5 mm' },
    });
    expect(holePlaceAt([2, 7.5, 0], values({ refs: { plane: [XY] } }), withValues())).toMatchObject(
      {
        exprs: { x: '2 mm', y: '7.5 mm' },
      },
    );
    expect(holePlaceAt([1, 1, 1], values({ refs: { plane: [] } }), withValues())).toBeUndefined();
  });

  it('sketch points: the plane follows the first point’s sketch, X and Y go', () => {
    const t = withSketch();
    t.controller.start('hole');
    // A tool with nothing picked opens on XY; points then keep it.
    t.controller.pickInto('points');
    t.controller.setRefs('points', [t.p1, t.p2]);
    expect(t.open()?.values.refs.points).toEqual([t.p1, t.p2]);
    const inputs = t.open()?.draft.inputs ?? {};
    expect(inputs.x).toBeUndefined();
    expect(inputs.points).toEqual({ kind: 'ref', refs: [t.p1, t.p2] });
    expect(t.open()?.checked.first).toBeUndefined();
    // With no plane, the sketch's own is proposed.
    const proposal = proposeHole(values({ refs: { points: [t.p1] } }), {
      ...withValues(),
      doc: t.store.getState().doc,
      sketches: undefined,
    });
    expect(proposal?.refs?.plane).toEqual([XY]);
    expect(proposal?.exprs).toBeUndefined();
  });

  it('until a plane is picked, the plane follows the sketch the points are in', () => {
    const t = setupDialogs([holeDialog]);
    const b = new SketchBuilder();
    const p = b.point(2, 3);
    // A sketch on the box's top face.
    const sketch: Feature = {
      id: 'ST' as FeatureId,
      type: 'sketch',
      name: 'Sketch2',
      suppressed: false,
      inputs: sketchInputs(TOP, b.sketch as SketchData),
    };
    t.store.getState().dispatch(insertFeature({ feature: sketch, index: 1 }));
    t.controller.start('hole');
    expect(t.open()?.values.refs.plane).toEqual([XY]);
    t.controller.pickInto('points');
    t.controller.setRefs('points', [{ kind: 'sketchEntity', id: `ST/${p}` }]);
    expect(t.open()?.values.refs.plane).toEqual([TOP]);
    // A plane the user picks stays.
    t.controller.pickInto('plane');
    t.controller.setRefs('plane', [XY]);
    expect(t.open()?.values.refs.plane).toEqual([XY]);
  });

  it('the Points field takes sketch points only, and says "points"', () => {
    const field = holeDialog.fields.find((f) => f.name === 'points');
    expect(field).toMatchObject({ kind: 'selection', sketchPoints: true, min: 0 });
    const filter = fieldFilter(['sketchEntity'], { sketchPoints: true });
    expect(filter).toMatchObject({
      sketchPoints: true,
      sketches: false,
      construction: false,
      faces: false,
    });
    // The plane field asks for no points, and the nav bar's filter has them off.
    expect(fieldFilter(['plane', 'face']).sketchPoints).toBe(false);
    expect(DEFAULT_FILTER.sketchPoints).toBe(false);
  });
});

describe('the handles', () => {
  const on = (over: Partial<DialogValues>, numbers: Record<string, number> = {}) =>
    holeManipulators(values({ refs: { plane: [TOP] }, ...over }), withValues(numbers));

  it('a through hole has a diameter arrow; a blind one adds the depth', () => {
    const through = on({}, { x: 3, y: 4 });
    expect(through.map((m) => m.kind === 'distance' && m.field)).toEqual(['diameter']);
    expect(through[0]).toMatchObject({ scale: 0.5, direction: [1, 0, 0] });
    expect(round((through[0]?.origin ?? [0, 0, 0]) as Vec3)).toEqual([3, 4, 10]);
    const blind = on({ choices: { extent: 'blind' } }, { x: 3, y: 4 });
    expect(blind.map((m) => m.kind === 'distance' && m.field)).toEqual(['diameter', 'depth']);
    // Into the face: against its outward normal.
    const direction = (m: (typeof blind)[number] | undefined) =>
      m?.kind === 'distance' ? round(m.direction) : undefined;
    expect(direction(blind[1])).toEqual([0, 0, -1]);
    expect(direction(on({ choices: { extent: 'blind' }, toggles: { flip: true } })[1])).toEqual([
      0, 0, 1,
    ]);
  });

  it('a counterbore and a countersink add their diameters and the step’s depth', () => {
    const bore = on({ choices: { type: 'counterbore', extent: 'blind' } }, { cbDiameter: 8 });
    expect(bore.map((m) => m.kind === 'distance' && m.field)).toEqual([
      'diameter',
      'depth',
      'cbDiameter',
      'cbDepth',
    ]);
    // The depth arrow starts on the step's edge, 4 mm from the axis.
    expect(round((bore[3]?.origin ?? [0, 0, 0]) as Vec3)).toEqual([0, 4, 10]);
    const sink = on({ choices: { type: 'countersink' } });
    expect(sink.map((m) => m.kind === 'distance' && m.field)).toEqual(['diameter', 'csDiameter']);
  });

  it('follows the first sketch point, dropped onto the plane; none without a plane', () => {
    const t = withSketch();
    const ctx: ManipulatorContext = {
      doc: t.store.getState().doc,
      bodies: t.model.getState().bodies,
      value: () => undefined,
    };
    const arrows = holeManipulators(values({ refs: { plane: [TOP], points: [t.p1] } }), ctx);
    // p1 is (2, 3) on XY (z = 0): dropped onto the top face at z = 10.
    expect(round((arrows[0]?.origin ?? [0, 0, 0]) as Vec3)).toEqual([2, 3, 10]);
    expect(holeManipulators(values({ refs: { plane: [{ kind: 'face', id: 'x' }] } }), ctx)).toEqual(
      [],
    );
  });
});

describe('patterns and mirrors can repeat a hole', () => {
  it('lists it as a cut', () => {
    const t = setupDialogs([holeDialog]);
    const hole: Feature = {
      id: 'H' as FeatureId,
      type: 'hole',
      name: 'Hole1',
      suppressed: false,
      inputs: holeInputs({ plane: TOP }),
    };
    t.store.getState().dispatch(insertFeature({ feature: hole, index: 1 }));
    expect(repeatableFeatures(t.store.getState().doc, 2, ['hole'])).toEqual([
      { id: 'H', name: 'Hole1', operation: 'cut' },
    ]);
  });
});
