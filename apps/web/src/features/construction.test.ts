import {
  CONSTRUCTION_FEATURES,
  CONSTRUCTION_TYPES,
  type ConstructionReports,
  type FeatureId,
  type GeomRef,
  originPlaneRef,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  axisAlongEdgeDialog,
  axisThroughCylinderDialog,
  CONSTRUCTION_DIALOGS,
  midplaneDialog,
  offsetPlaneDialog,
  planeAnchor,
  planeAtAngleDialog,
  squareTo,
  tangentPlaneDialog,
} from './construction';
import { dialogPlanePick, dialogPlanePicker } from './planePicker';
import { featureDialogs, specForCommand } from './registry';
import type { DialogValues, ManipulatorContext } from './spec';
import { BOX, faceItem, namedBoxMesh, setupDialogs } from './testing';
import { defaultValues, inputsFor, mergeValues, shownFields, valuesFor } from './values';

const XY = originPlaneRef('origin:xy');
const TOP: GeomRef = { kind: 'face', id: 'box:top' };
const OP: GeomRef = { kind: 'plane', id: 'OP' };

const construction = {
  ['OP' as FeatureId]: {
    kind: 'plane',
    frame: { origin: [0, 0, 30], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
    anchor: [5, 5, 30],
  },
  ['AX' as FeatureId]: { kind: 'axis', origin: [0, 0, 5], direction: [1, 0, 0] },
} as unknown as ConstructionReports;

const bodies = { [BOX]: namedBoxMesh() };
const doc = setupDialogs().store.getState().doc;
const ctx = (numbers: Record<string, number> = {}): ManipulatorContext => ({
  doc,
  bodies,
  construction,
  value: (field) => numbers[field],
});

const values = (spec: (typeof CONSTRUCTION_DIALOGS)[number], over: Partial<DialogValues> = {}) =>
  mergeValues(defaultValues(spec), over);

describe('the construction dialogs', () => {
  it('are the app’s dialogs for the nine construction tools', () => {
    const dialogs = featureDialogs();
    expect(CONSTRUCTION_DIALOGS).toHaveLength(9);
    for (const type of CONSTRUCTION_TYPES) {
      const spec = specForCommand(dialogs, type);
      expect(spec?.type).toBe(type);
      expect(spec?.category).toBe('construct');
      expect(dialogs.get(type)).toBe(spec);
    }
  });

  it('name their fields like the feature inputs, so the schema accepts what they make', () => {
    const picks: Record<string, Record<string, GeomRef[]>> = {
      offsetPlane: { plane: [XY] },
      planeAtAngle: { axis: [{ kind: 'axis', id: 'origin:x' }] },
      midplane: { planes: [XY, OP] },
      planeThroughPoints: {
        points: [1, 2, 3].map((n): GeomRef => ({ kind: 'point', id: `P${n}` })),
      },
      tangentPlane: { face: [TOP] },
      axisThroughPoints: { points: [1, 2].map((n): GeomRef => ({ kind: 'point', id: `P${n}` })) },
      axisThroughCylinder: { face: [TOP] },
      axisAlongEdge: { edge: [{ kind: 'edge', id: 'e' }] },
      constructionPoint: {},
    };
    for (const spec of CONSTRUCTION_DIALOGS) {
      const v = values(spec, { refs: picks[spec.type] ?? {} });
      const inputs = inputsFor(spec, v, undefined as never);
      const feature = CONSTRUCTION_FEATURES[spec.type as (typeof CONSTRUCTION_TYPES)[number]];
      expect(feature.inputsSchema.safeParse(inputs).success, spec.type).toBe(true);
      // And back again.
      const stored = {
        id: 'F' as FeatureId,
        type: spec.type,
        name: 'F',
        suppressed: false,
        inputs,
      };
      const back = valuesFor(spec, stored, undefined as never).refs;
      const picked = Object.fromEntries(Object.entries(back).filter(([, list]) => list.length > 0));
      expect(picked).toEqual(picks[spec.type] ?? {});
    }
  });

  it('an offset plane wants a plane and a distance in mm; a midplane exactly two planes', () => {
    expect(offsetPlaneDialog.fields.map((f) => f.name)).toEqual(['plane', 'distance']);
    expect(offsetPlaneDialog.fields[1]).toMatchObject({
      kind: 'expression',
      unit: 'length',
      default: '10 mm',
    });
    expect(midplaneDialog.fields[0]).toMatchObject({ min: 2, max: 2 });
    expect(planeAtAngleDialog.fields.map((f) => f.name)).toEqual(['axis', 'plane', 'angle']);
    expect(planeAtAngleDialog.fields[2]).toMatchObject({ unit: 'angle', default: '45 deg' });
    expect(shownFields(offsetPlaneDialog, values(offsetPlaneDialog))).toHaveLength(2);
  });

  it('refuses a flat face where a curved one is needed, and a curved sketch curve as a line', () => {
    // The 10 mm test box's faces are all flat.
    const flat = values(tangentPlaneDialog, { refs: { face: [TOP] } });
    expect(tangentPlaneDialog.validate?.(flat, ctx())).toMatchObject({ field: 'face' });
    expect(
      axisThroughCylinderDialog.validate?.(
        values(axisThroughCylinderDialog, { refs: { face: [TOP] } }),
        ctx(),
      ),
    ).toMatchObject({
      field: 'face',
    });
    // A face the meshes don't show is the kernel's to judge.
    const unknown = values(tangentPlaneDialog, { refs: { face: [{ kind: 'face', id: 'nope' }] } });
    expect(tangentPlaneDialog.validate?.(unknown, ctx())).toBeUndefined();
    // Edges are fine.
    expect(
      axisAlongEdgeDialog.validate?.(
        values(axisAlongEdgeDialog, { refs: { edge: [{ kind: 'edge', id: 'e' }] } }),
        ctx(),
      ),
    ).toBeUndefined();
  });

  it('an offset plane’s arrow starts at the plane’s centre and points along its normal', () => {
    const arrow = (plane: GeomRef) =>
      offsetPlaneDialog.manipulators?.(
        values(offsetPlaneDialog, { refs: { plane: [plane] } }),
        ctx(),
      );
    expect(arrow(XY)).toEqual([
      { kind: 'distance', field: 'distance', origin: [0, 0, 0], direction: [0, 0, 1] },
    ]);
    // A construction plane: its report's anchor and frame.
    expect(arrow(OP)).toEqual([
      { kind: 'distance', field: 'distance', origin: [5, 5, 30], direction: [0, 0, 1] },
    ]);
    expect(arrow({ kind: 'plane', id: 'gone' })).toEqual([]);
    expect(offsetPlaneDialog.manipulators?.(values(offsetPlaneDialog), ctx())).toEqual([]);
  });

  it('a plane at angle draws an arc about the line, from where the plane starts', () => {
    const arc = (plane?: GeomRef) =>
      planeAtAngleDialog.manipulators?.(
        values(planeAtAngleDialog, {
          refs: { axis: [{ kind: 'axis', id: 'AX' }], ...(plane && { plane: [plane] }) },
        }),
        ctx(),
      );
    const [manipulator] = arc() ?? [];
    expect(manipulator).toMatchObject({ kind: 'angle', field: 'angle', axis: [1, 0, 0] });
    // Without a reference the arc starts along the kernel's `perpendicular`: Z for an X line.
    expect(manipulator).toMatchObject({ zero: [0, 0, 1] });
    expect(squareTo([1, 0, 0])).toEqual([0, 0, 1]);
    // With a reference plane it starts along the plane's normal (here XY's, Z).
    expect(arc(XY)?.[0]).toMatchObject({ zero: [0, 0, 1] });
    expect(planeAtAngleDialog.manipulators?.(values(planeAtAngleDialog), ctx())).toEqual([]);
  });

  it('finds a plane’s normal and centre: origin, construction and face', () => {
    expect(planeAnchor(XY, ctx())).toEqual({ anchor: [0, 0, 0], normal: [0, 0, 1] });
    expect(planeAnchor(OP, ctx())).toEqual({ anchor: [5, 5, 30], normal: [0, 0, 1] });
    expect(planeAnchor(undefined, ctx())).toBeUndefined();
    const face = planeAnchor(TOP, ctx());
    expect(face?.normal).toEqual([0, 0, 1]);
    expect(face?.anchor[2]).toBeCloseTo(10);
  });
});

describe('picking planes into a construction dialog', () => {
  it('a Plane field picks like Create Sketch: origin planes, construction planes and faces', () => {
    const t = setupDialogs([offsetPlaneDialog]);
    t.controller.start('offsetPlane');
    const open = () => t.open();
    expect(open()?.pickField).toBe('plane');
    expect(dialogPlanePick(t.controller, open())).toBe(true);
    const picker = dialogPlanePicker(t.controller, open(), t.session, undefined);
    expect(picker?.faces).toBeDefined();
    picker?.onPick('OP');
    expect(open()?.values.refs.plane).toEqual([{ kind: 'plane', id: 'OP' }]);
    expect(dialogPlanePicker(t.controller, open(), t.session, undefined)?.selected).toEqual(['OP']);
    picker?.onPick('origin:xz');
    expect(open()?.values.refs.plane).toEqual([originPlaneRef('origin:xz')]);
    picker?.faces?.onPick(faceItem(1));
    expect(open()?.values.refs.plane?.[0]?.kind).toBe('face');
  });

  it('a midplane collects two planes, then takes no more', () => {
    const t = setupDialogs([midplaneDialog]);
    t.controller.start('midplane');
    const picker = dialogPlanePicker(t.controller, t.open(), t.session, undefined);
    picker?.onPick('origin:xy');
    picker?.onPick('OP');
    expect(t.open()?.values.refs.planes).toEqual([XY, OP]);
    picker?.onPick('origin:yz');
    expect(t.open()?.values.refs.planes).toHaveLength(2);
    expect(dialogPlanePicker(t.controller, t.open(), t.session, undefined)?.selected).toEqual([
      'origin:xy',
      'OP',
    ]);
  });
});
