import {
  type BodyId,
  type ConstraintId,
  createDocument,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  newId,
  originPlaneRef,
  type Parameter,
  type ParameterId,
  type SketchData,
  type SketchEntityId,
  sketchInputs,
  type UnitKind,
  type Vec2,
} from '@extrudo/core';
import { APP_VERSION } from '../version';

export interface Template {
  id: string;
  name: string;
  summary: string;
  create(): ExtrudoDocument;
}

/**
 * Templates on the home screen's "Start from template" row (UI spec §6). The
 * gallery grows with P3-12; for now there is the wall bracket.
 */
export const TEMPLATES: readonly Template[] = [
  {
    id: 'wall-bracket',
    name: 'Wall bracket',
    summary: 'Parameters, a timeline and a body to explore.',
    create: () => wallBracket(),
  },
];

/**
 * A small wall bracket with parameters, a timeline and one body. The
 * sketches hold its profile: an L on the XZ plane (the side view, 40 mm deep
 * and 60 mm tall) and two screw holes on the XY plane. The other features
 * have no geometry yet (Phase 2); they fill the timeline and the Parameters
 * dialog.
 */
export function wallBracket(): ExtrudoDocument {
  const param = (
    name: string,
    expression: string,
    unit: UnitKind,
    comment?: string,
  ): Parameter => ({
    id: newId<ParameterId>(),
    name,
    expression,
    unit,
    ...(comment ? { comment } : {}),
  });
  const feature = (type: string, name: string, inputs: Feature['inputs'] = {}): Feature => ({
    id: newId<FeatureId>(),
    type,
    name,
    suppressed: false,
    inputs,
  });
  const t = 2.4;
  const profile = outline([
    [0, 0],
    [40, 0],
    [40, t],
    [t, t],
    [t, 60],
    [0, 60],
  ]);
  const holes = circles(2.5, [
    [25, -20],
    [25, -60],
  ]);
  const features = [
    feature('sketch', 'Sketch1', sketchInputs(originPlaneRef('origin:xz'), profile)),
    feature('extrude', 'Extrude1', {
      distance: { kind: 'expr', expr: 'inner / 4', paramName: 'd1', unit: 'length' },
      taper: { kind: 'expr', expr: 'tilt / 3', paramName: 'd2', unit: 'angle' },
    }),
    feature('sketch', 'Sketch2', sketchInputs(originPlaneRef('origin:xy'), holes)),
    feature('extrude', 'Extrude2', {
      distance: { kind: 'expr', expr: 'wall * 5', paramName: 'd3', unit: 'length' },
    }),
    feature('fillet', 'Fillet1', {
      radius: { kind: 'expr', expr: 'wall / 2', paramName: 'd4', unit: 'length' },
    }),
    feature('plane', 'Plane1', {
      offset: { kind: 'expr', expr: '10 mm', paramName: 'd5', unit: 'length' },
    }),
  ];
  return {
    ...createDocument({ name: 'Wall bracket', appVersion: APP_VERSION }),
    parameters: [
      param('width', '80 mm', 'length', 'Along the wall'),
      param('wall', '2.4 mm', 'length', 'Six perimeters of a 0.4 mm nozzle'),
      param('inner', 'width - 2 * wall', 'length'),
      param('tilt', '15 deg', 'angle'),
      param('holes', '2', 'unitless'),
    ],
    features,
    // The last feature is rolled back, to show the marker.
    timelineMarker: features.length - 1,
    bodies: { [newId<BodyId>()]: { name: 'Bracket', visible: true } },
  };
}

/**
 * A closed polyline as a sketch: one line per side, each with its own
 * endpoints, joined by coincident constraints; axis-aligned sides get a
 * horizontal or vertical constraint.
 */
export function outline(corners: readonly Vec2[]): SketchData {
  const sketch: SketchData = { entities: {}, constraints: {}, dimensions: {} };
  const constrain = (c: SketchData['constraints'][ConstraintId]) => {
    sketch.constraints[newId<ConstraintId>()] = c;
  };
  const lines = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length] as Vec2;
    const start = newId<SketchEntityId>();
    const end = newId<SketchEntityId>();
    const line = newId<SketchEntityId>();
    sketch.entities[start] = { type: 'point', x: a[0], y: a[1] };
    sketch.entities[end] = { type: 'point', x: b[0], y: b[1] };
    sketch.entities[line] = { type: 'line', start, end, construction: false };
    if (a[1] === b[1]) constrain({ type: 'horizontal', a: line });
    else if (a[0] === b[0]) constrain({ type: 'vertical', a: line });
    return { start, end };
  });
  lines.forEach(({ end }, i) => {
    const next = lines[(i + 1) % lines.length];
    if (next) constrain({ type: 'coincident', a: end, b: next.start });
  });
  return sketch;
}

/** Circles of one radius, with a constraint making them equal. */
export function circles(radius: number, centers: readonly Vec2[]): SketchData {
  const sketch: SketchData = { entities: {}, constraints: {}, dimensions: {} };
  const ids = centers.map(([x, y]) => {
    const center = newId<SketchEntityId>();
    const circle = newId<SketchEntityId>();
    sketch.entities[center] = { type: 'point', x, y };
    sketch.entities[circle] = { type: 'circle', center, radius, construction: false };
    return circle;
  });
  for (let i = 1; i < ids.length; i++) {
    sketch.constraints[newId<ConstraintId>()] = {
      type: 'equal',
      a: ids[0] as SketchEntityId,
      b: ids[i] as SketchEntityId,
    };
  }
  return sketch;
}
