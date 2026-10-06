import {
  BoxInputsSchema,
  CylinderInputsSchema,
  type Feature,
  type GeomRef,
  originPlaneRef,
  PRIMITIVE_OPERATIONS,
  PRIMITIVE_TYPES,
  type PrimitiveType,
  primitiveInputs,
  SphereInputsSchema,
  TorusInputsSchema,
  type Vec3,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { dialogPlanePick, dialogPlanePicker } from './planePicker';
import { armCorners, corners, disarmCorners, footprintOf } from './primitiveCorners';
import {
  boxDialog,
  PRIMITIVE_DIALOGS,
  placementFrame,
  positionManipulators,
  primitiveFrame,
  primitiveManipulators,
  primitivePlaceAt,
  proposePrimitive,
  sphereDialog,
  torusDialog,
} from './primitives';
import { featureDialogs, specForCommand } from './registry';
import type { DialogValues, ManipulatorContext } from './spec';
import { BOX, faceItem, namedBoxMesh, setupDialogs } from './testing';
import { defaultValues, inputsFor, mergeValues, shownFields, valuesFor } from './values';

/** The 10 mm test box's top face (z = 10) and front wall (y = 0). */
const TOP: GeomRef = { kind: 'face', id: 'box:top' };
const FRONT: GeomRef = { kind: 'face', id: 'box:front' };
const XZ = originPlaneRef('origin:xz');

const SCHEMAS = {
  box: BoxInputsSchema,
  cylinder: CylinderInputsSchema,
  sphere: SphereInputsSchema,
  torus: TorusInputsSchema,
} as const;

const dialogOf = (type: PrimitiveType) =>
  PRIMITIVE_DIALOGS.find((d) => d.type === type) ?? boxDialog;

function values(type: PrimitiveType, over: Partial<DialogValues> = {}): DialogValues {
  return mergeValues(defaultValues(dialogOf(type)), over);
}

const bodies = { [BOX]: namedBoxMesh() };

/** A manipulator context where every expression field has its value from `numbers` (else none). */
const withValues = (numbers: Record<string, number> = {}): ManipulatorContext => ({
  doc: setupDialogs().store.getState().doc,
  bodies,
  value: (field) => numbers[field],
});

const round = (v: readonly number[]) => v.map((c) => Math.round(c * 1000) / 1000 + 0);

describe('the primitive dialogs', () => {
  it('are the app’s dialogs for the Box, Cylinder, Sphere and Torus tools', () => {
    const dialogs = featureDialogs();
    for (const type of PRIMITIVE_TYPES) {
      const spec = specForCommand(dialogs, type);
      expect(spec?.type).toBe(type);
      expect(dialogs.get(type)).toBe(spec);
    }
    expect(boxDialog.fields.map((f) => f.name)).toEqual([
      'plane',
      'length',
      'width',
      'height',
      'x',
      'y',
      'offset',
      'rotation',
      'operation',
      'bodies',
    ]);
    expect(torusDialog.fields.map((f) => f.name)).toEqual([
      'plane',
      'diameter',
      'tube',
      'axis',
      'seat',
      'x',
      'y',
      'offset',
      'operation',
      'bodies',
    ]);
    expect(defaultValues(sphereDialog).exprs).toEqual({
      diameter: '20 mm',
      x: '0 mm',
      y: '0 mm',
      offset: '0 mm',
    });
  });

  it('turns every type and operation into valid inputs and back', () => {
    const ctx = { doc: setupDialogs().store.getState().doc, bodies };
    let checked = 0;
    for (const type of PRIMITIVE_TYPES) {
      const spec = dialogOf(type);
      for (const operation of PRIMITIVE_OPERATIONS) {
        for (const plane of [XZ, TOP]) {
          const v = values(type, {
            refs: { plane: [plane], bodies: [{ kind: 'body', id: BOX }] },
            exprs: { x: '5 mm', offset: 'd9 / 2' },
            choices: {
              operation,
              ...(type === 'torus' ? { axis: 'x', seat: 'plane' } : {}),
            },
          });
          const inputs = inputsFor(spec, v, ctx);
          expect(SCHEMAS[type].safeParse(inputs).success, `${type} ${operation}`).toBe(true);
          const feature = { id: 'P', type, name: 'P1', inputs } as Feature;
          const back = valuesFor(spec, feature, ctx);
          for (const field of shownFields(spec, v)) {
            const kind = {
              selection: 'refs',
              features: 'refs',
              expression: 'exprs',
              choice: 'choices',
              toggle: 'toggles',
            } as Record<string, keyof typeof v>;
            const k = kind[field.kind] as keyof typeof v;
            expect(back[k][field.name], `${type} ${field.name}`).toEqual(v[k][field.name]);
          }
          checked++;
        }
      }
    }
    expect(checked).toBe(4 * 4 * 2);
  });

  it('makes the inputs primitiveInputs makes', () => {
    const ctx = { doc: setupDialogs().store.getState().doc, bodies };
    const inputs = inputsFor(
      boxDialog,
      values('box', { refs: { plane: [TOP] }, exprs: { length: '30 mm' } }),
      ctx,
    );
    expect(inputs).toEqual(
      primitiveInputs('box', {
        plane: TOP,
        numbers: {
          length: '30 mm',
          width: '20 mm',
          height: '20 mm',
          x: '0 mm',
          y: '0 mm',
          offset: '0 mm',
          rotation: '0 deg',
        },
        operation: 'new-body',
      }),
    );
  });

  it('stores a torus’s axis and seat only when they aren’t the default (P4-12)', () => {
    const ctx = { doc: setupDialogs().store.getState().doc, bodies };
    const inputsOf = (choices: Record<string, string>) =>
      inputsFor(torusDialog, values('torus', { refs: { plane: [XZ] }, choices }), ctx);
    expect(Object.keys(inputsOf({ axis: 'x', seat: 'plane' })).sort()).toEqual([
      'axis',
      'diameter',
      'offset',
      'operation',
      'plane',
      'seat',
      'tube',
      'x',
      'y',
    ]);
    expect(inputsOf({})).not.toHaveProperty('axis');
    expect(inputsOf({ seat: 'plane' })).not.toHaveProperty('axis');
    expect(inputsOf({ axis: 'x' })).not.toHaveProperty('seat');
    // A torus stored without them reads the selects as the defaults again.
    const back = valuesFor(
      torusDialog,
      { id: 'P', type: 'torus', name: 'Torus1', inputs: inputsOf({}) } as Feature,
      ctx,
    );
    expect(back.choices.axis).toBe('normal');
    expect(back.choices.seat).toBe('centre');
  });

  it('shows a primitive stored without a plane on the XY plane', () => {
    const ctx = { doc: setupDialogs().store.getState().doc, bodies };
    const feature = { id: 'P', type: 'box', name: 'Box1', inputs: {} } as Feature;
    expect(valuesFor(boxDialog, feature, ctx).refs.plane).toEqual([originPlaneRef('origin:xy')]);
  });

  it('wants a flat face to sit on', () => {
    const curved: BodyMesh = namedBoxMesh();
    const positions = Float32Array.from(curved.positions);
    // Lift one corner of the top face (face 1, vertices 4…7): its triangles no longer agree.
    positions[6 * 3 + 2] = 13;
    const ctx = {
      doc: setupDialogs().store.getState().doc,
      bodies: { [BOX]: { ...curved, positions } },
    };
    expect(boxDialog.validate?.(values('box', { refs: { plane: [TOP] } }), ctx)).toEqual({
      field: 'plane',
      message: 'Pick a flat face or a plane.',
    });
    expect(boxDialog.validate?.(values('box', { refs: { plane: [FRONT] } }), ctx)).toBeUndefined();
    expect(boxDialog.validate?.(values('box', { refs: { plane: [XZ] } }), ctx)).toBeUndefined();
  });
});

describe('what a primitive proposes', () => {
  it('the XY plane at the origin, a new body, when nothing is picked', () => {
    expect(proposePrimitive('box', values('box'), withValues())).toEqual({
      refs: { plane: [originPlaneRef('origin:xy')] },
      exprs: { x: '0 mm', y: '0 mm' },
      choices: { operation: 'new-body' },
    });
    expect(
      proposePrimitive('torus', values('torus', { refs: { plane: [XZ] } }), withValues()),
    ).toEqual({
      exprs: { x: '0 mm', y: '0 mm' },
      choices: { operation: 'new-body' },
    });
  });

  it('the centre of a picked face in its sketch frame, and a join', () => {
    // The top face's frame: origin (0, 0, 10), X along world X; its centre is (5, 5).
    expect(
      proposePrimitive('sphere', values('sphere', { refs: { plane: [TOP] } }), withValues()),
    ).toEqual({
      exprs: { x: '5 mm', y: '5 mm' },
      choices: { operation: 'join' },
    });
    // The front wall (normal −Y): X along world X, Y up.
    expect(
      proposePrimitive(
        'cylinder',
        values('cylinder', { refs: { plane: [FRONT] } }),
        withValues({ height: 3 }),
      ),
    ).toEqual({ exprs: { x: '5 mm', y: '5 mm' }, choices: { operation: 'join' } });
  });

  it('a cut for a box or cylinder going into the face', () => {
    const v = values('box', { refs: { plane: [TOP] } });
    expect(proposePrimitive('box', v, withValues({ height: -4 })).choices).toEqual({
      operation: 'cut',
    });
    // Spheres and tori sit across the face: always a join.
    expect(proposePrimitive('sphere', v, withValues({ height: -4 })).choices).toEqual({
      operation: 'join',
    });
  });

  it('the picked face’s fingerprint centre until the meshes have the face', () => {
    const lost: GeomRef = {
      kind: 'face',
      id: 'extrude:gone:cap:end',
      fingerprint: { type: 'plane', at: [30, 20, 10], dir: [0, 0, 1] },
    };
    expect(
      proposePrimitive('box', values('box', { refs: { plane: [lost] } }), withValues()).exprs,
    ).toEqual({
      x: '30 mm',
      y: '20 mm',
    });
  });
});

describe('where a primitive sits and its handles', () => {
  it('takes an origin plane’s frame, or a face’s sketch frame', () => {
    expect(placementFrame(XZ, { bodies })).toEqual({
      origin: [0, 0, 0],
      x: [1, 0, 0],
      y: [0, 0, 1],
      normal: [0, -1, 0],
    });
    const top = placementFrame(TOP, { bodies });
    expect(top && round(top.origin)).toEqual([0, 0, 10]);
    expect(top && round(top.normal)).toEqual([0, 0, 1]);
    expect(placementFrame(undefined, { bodies })).toBeUndefined();
  });

  it('moves to X and Y, lifts by Offset and turns a box by Rotation', () => {
    const placed = primitiveFrame(
      'box',
      values('box', { refs: { plane: [TOP] } }),
      withValues({ x: 5, y: 2, offset: 1, rotation: 90 }),
    );
    expect(placed && round(placed.frame.origin)).toEqual([5, 2, 11]);
    expect(placed && round(placed.frame.x)).toEqual([0, 1, 0]);
    expect(placed && round(placed.frame.y)).toEqual([-1, 0, 0]);
    // Other primitives don't turn; an invalid field takes its default.
    const sphere = primitiveFrame(
      'sphere',
      values('sphere', { refs: { plane: [XZ] } }),
      withValues({ x: 3 }),
    );
    expect(sphere && round(sphere.frame.origin)).toEqual([3, 0, 0]);
    expect(sphere && round(sphere.frame.x)).toEqual([1, 0, 0]);
  });

  it('puts arrows on the sizes and an arc on a box’s rotation', () => {
    const on = (type: PrimitiveType, numbers: Record<string, number>) =>
      primitiveManipulators(type, values(type, { refs: { plane: [XZ] } }), withValues(numbers));
    const box = on('box', { length: 20, rotation: 0 });
    expect(box.map((m) => `${m.kind}:${m.field}`)).toEqual([
      'distance:length',
      'distance:width',
      'distance:height',
      'angle:rotation',
      'distance:x',
      'distance:y',
      'distance:offset',
    ]);
    expect(box[0]).toMatchObject({ direction: [1, 0, 0], scale: 0.5 });
    expect(box[2]).toMatchObject({ direction: [0, -1, 0] });
    expect(box[3]).toMatchObject({ axis: [0, -1, 0], zero: [1, 0, 0] });
    const torus = on('torus', { diameter: 40 });
    expect(torus.map((m) => m.field)).toEqual(['diameter', 'tube', 'x', 'y', 'offset']);
    expect((torus[1] as { origin: Vec3 }).origin).toEqual([20, 0, 0]);
    expect(on('sphere', {}).map((m) => m.field)).toEqual(['diameter', 'x', 'y', 'offset']);
    expect(on('cylinder', {}).map((m) => m.field)).toEqual([
      'diameter',
      'height',
      'x',
      'y',
      'offset',
    ]);
    // A torus on edge runs its ring arrows up the plane's Y (world Z on XZ);
    // resting on the plane lifts them by the seat lift along the normal.
    const rings = (choices: Record<string, string>, numbers: Record<string, number>) =>
      primitiveManipulators(
        'torus',
        values('torus', { refs: { plane: [XZ] }, choices }),
        withValues(numbers),
      ).slice(0, 2);
    const onEdge = rings({ axis: 'x' }, { diameter: 40, tube: 10 });
    expect((onEdge[0] as { origin: Vec3 }).origin).toEqual([0, 0, 0]);
    expect(round((onEdge[0] as { direction: Vec3 }).direction)).toEqual([0, 0, 1]);
    expect((onEdge[1] as { origin: Vec3 }).origin).toEqual([0, 0, 20]);
    const resting = rings({ axis: 'x', seat: 'plane' }, { diameter: 40, tube: 10 });
    expect((resting[0] as { origin: Vec3 }).origin).toEqual([0, -25, 0]);
    expect((resting[1] as { origin: Vec3 }).origin).toEqual([0, -25, 20]);
    expect(
      (rings({ seat: 'plane' }, { diameter: 40, tube: 10 })[0] as { origin: Vec3 }).origin,
    ).toEqual([0, -5, 0]);
    // No plane, no handles.
    expect(
      primitiveManipulators('box', values('box', { refs: { plane: [] } }), withValues()),
    ).toEqual([]);
  });
});

describe('the position handles', () => {
  const distance = (m: unknown) =>
    m as { field: string; origin: Vec3; direction: Vec3; lift?: number };

  it('walk from the plane’s origin to a box’s base centre on XY', () => {
    const xy = placementFrame(originPlaneRef('origin:xy'), { bodies });
    if (!xy) throw new Error('no frame');
    const [mx, my, mo] = positionManipulators(
      'box',
      xy,
      withValues({ x: 10, y: -5, offset: 3 }),
    ).map(distance);
    expect([mx?.field, my?.field, mo?.field]).toEqual(['x', 'y', 'offset']);
    expect(mx && [round(mx.origin), round(mx.direction)]).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(my && [round(my.origin), round(my.direction)]).toEqual([
      [10, 0, 0],
      [0, 1, 0],
    ]);
    expect(mo && [round(mo.origin), round(mo.direction)]).toEqual([
      [10, -5, 0],
      [0, 0, 1],
    ]);
    expect([mx?.lift, my?.lift, mo?.lift]).toEqual([undefined, undefined, undefined]);
  });

  it('follow a tilted plane’s frame', () => {
    const s = Math.SQRT1_2;
    const tilted = {
      origin: [0, 0, 5] as Vec3,
      x: [1, 0, 0] as Vec3,
      y: [0, s, s] as Vec3,
      normal: [0, -s, s] as Vec3,
    };
    const [mx, my, mo] = positionManipulators(
      'box',
      tilted,
      withValues({ x: 2, y: 10, offset: 4 }),
    ).map(distance);
    const r = Math.round(Math.SQRT1_2 * 1000) / 1000;
    expect(mx && round(mx.direction)).toEqual([1, 0, 0]);
    expect(my && round(my.origin)).toEqual([2, 0, 5]);
    expect(my && round(my.direction)).toEqual([0, r, r]);
    expect(mo && round(mo.origin)).toEqual([2, 7.071, 12.071]);
    expect(mo && round(mo.direction)).toEqual([0, -r, r]);
  });

  it('lift a head that lands on an earlier one', () => {
    const xy = placementFrame(originPlaneRef('origin:xy'), { bodies });
    if (!xy) throw new Error('no frame');
    const lifts = positionManipulators('box', xy, withValues({})).map((m) => distance(m).lift);
    // At the origin all three heads meet: 0, one lift, two lifts.
    expect(lifts).toEqual([undefined, 14, 28]);
    const apart = positionManipulators('box', xy, withValues({ x: 5, y: 5, offset: 5 }));
    expect(apart.map((m) => distance(m).lift)).toEqual([undefined, undefined, undefined]);
  });
});

describe('placing by a click', () => {
  const ctx = withValues({});
  afterEach(disarmCorners);

  it('puts a world point on the plane into X and Y in the plane’s frame', () => {
    const placed = primitivePlaceAt(
      'cylinder',
      [12.5, 3, 7],
      values('cylinder', { refs: { plane: [XZ] } }),
      ctx,
    );
    // The XZ plane's X is world X and its Y is world Z.
    expect(placed).toEqual({ exprs: { x: '12.5 mm', y: '7 mm' } });
    expect(
      primitivePlaceAt('box', [1, 1, 1], values('box', { refs: { plane: [] } }), ctx),
    ).toBeUndefined();
  });

  it('takes two clicks as a box’s corners while armed, then disarms', () => {
    const box = values('box', { refs: { plane: [XZ] } });
    armCorners('d1');
    expect(primitivePlaceAt('box', [10, 0, 5], box, ctx)).toBeUndefined();
    expect(corners().points).toHaveLength(1);
    expect(primitivePlaceAt('box', [-10, 0, -5], box, withValues({ rotation: 30 }))).toEqual({
      exprs: { x: '0 mm', y: '0 mm', length: '20 mm', width: '10 mm', rotation: '0 deg' },
    });
    expect(corners().dialog).toBeUndefined();
  });
});

describe('the two-corner maths', () => {
  const xy = {
    origin: [0, 0, 0] as Vec3,
    x: [1, 0, 0] as Vec3,
    y: [0, 1, 0] as Vec3,
    normal: [0, 0, 1] as Vec3,
  };

  it('gives the centre and the sides in either order', () => {
    const want = { footprint: { x: 15, y: 5, length: 10, width: 20 } };
    expect(footprintOf([10, -5, 0], [20, 15, 0], xy)).toEqual(want);
    expect(footprintOf([20, 15, 0], [10, -5, 0], xy)).toEqual(want);
    expect(footprintOf([20, -5, 0], [10, 15, 0], xy)).toEqual(want);
  });

  it('works in the plane’s frame and rounds to 0.01 mm', () => {
    const xz = placementFrame(XZ, { bodies });
    if (!xz) throw new Error('no frame');
    expect(footprintOf([0.004, 0, 0], [10.136, 0, 3.337], xz)).toEqual({
      footprint: { x: 5.07, y: 1.67, length: 10.13, width: 3.34 },
    });
  });

  it('refuses two corners that share a side', () => {
    const refused = footprintOf([1, 1, 0], [9, 1, 0], xy);
    expect(refused).toEqual({ error: expect.stringContaining('opposite corners') });
    expect(footprintOf([1, 1, 0], [1.004, 5, 0], xy)).toHaveProperty('error');
  });
});

describe('picking the plane', () => {
  it('opens on the XY plane and puts a picked origin plane or face in the field', () => {
    const t = setupDialogs([...PRIMITIVE_DIALOGS]);
    t.controller.start('cylinder');
    const open = () => t.open();
    expect(open()?.values.refs.plane).toEqual([originPlaneRef('origin:xy')]);
    expect(open()?.pickField).toBe('plane');
    expect(dialogPlanePick(t.controller, open())).toBe(true);
    let picker = dialogPlanePicker(t.controller, open(), t.session, undefined);
    expect(picker?.selected).toEqual(['origin:xy']);
    expect(picker?.faces).toBeDefined();

    picker?.onHover('origin:yz');
    expect(t.session.getState().hover).toEqual({ kind: 'plane', id: 'origin:yz' });
    picker?.onLeave('origin:yz');
    expect(t.session.getState().hover).toBeUndefined();

    picker?.onPick('origin:xz');
    expect(open()?.values.refs.plane).toEqual([XZ]);
    picker = dialogPlanePicker(t.controller, open(), t.session, { kind: 'plane', id: 'origin:yz' });
    expect(picker).toMatchObject({ selected: ['origin:xz'], hover: 'origin:yz' });

    // The box's top face: the dialog centres on it and proposes a join.
    picker?.faces?.onPick(faceItem(1));
    expect(open()?.values.refs.plane).toEqual([TOP]);
    expect(open()?.values.exprs).toMatchObject({ x: '5 mm', y: '5 mm' });
    expect(open()?.values.choices.operation).toBe('join');
    expect(dialogPlanePicker(t.controller, open(), t.session, undefined)?.selected).toBeUndefined();

    // Another pick field (Bodies) picks in the model again.
    t.controller.pickInto('bodies');
    expect(dialogPlanePick(t.controller, open())).toBe(false);
    expect(dialogPlanePicker(t.controller, open(), t.session, undefined)).toBeUndefined();
  });

  it('keeps the user’s own X and operation when the plane changes', () => {
    const t = setupDialogs([...PRIMITIVE_DIALOGS]);
    t.controller.start('box');
    t.controller.setExpr('x', '12 mm');
    t.controller.setChoice('operation', 'intersect');
    dialogPlanePicker(t.controller, t.open(), t.session, undefined)?.faces?.onPick(faceItem(1));
    expect(t.open()?.values.exprs).toMatchObject({ x: '12 mm', y: '5 mm' });
    expect(t.open()?.values.choices.operation).toBe('intersect');
  });

  it('takes a face selected before the tool', () => {
    const t = setupDialogs([...PRIMITIVE_DIALOGS]);
    t.session.getState().select([faceItem(1)]);
    t.controller.start('torus');
    expect(t.open()?.values.refs.plane).toEqual([TOP]);
    expect(t.open()?.values.choices.operation).toBe('join');
  });
});
