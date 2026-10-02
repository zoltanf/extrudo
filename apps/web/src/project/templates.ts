import {
  type BodyId,
  type ConstraintId,
  createDocument,
  EXTRUDE_TYPE,
  type ExtrudeInputOptions,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  filletInputs,
  type GeomRef,
  newId,
  originPlaneRef,
  type Parameter,
  type ParameterId,
  profileRefId,
  type SketchData,
  type SketchEntityId,
  sketchInputs,
  type UnitKind,
  type Vec2,
} from '@extrudo/core';
import { createdName, edgeName } from '@extrudo/kernel';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { APP_VERSION } from '../version';

/**
 * A small wall bracket with parameters, a timeline and one body (P2-06):
 * Sketch1 is its side view, an L on the XZ plane (40 mm deep, 60 mm tall,
 * 2.4 mm thick), which Extrude1 pulls `width` wide, symmetric about the
 * plane. Sketch2 has two screw holes on the XY plane, 20 mm either side of
 * the middle, which Extrude2 cuts `wall * 5` up through the foot with a
 * slight taper (`tilt / 3`), so they widen towards the top. Fillet1 rounds
 * the bend two ways (P3-01): the inside corner with `wall / 2` and the
 * outside one with `wall * 1.5`, two edge sets that stay concentric when
 * `wall` changes. Plane1 is rolled back, to show the marker.
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
    [25, 20],
    [25, -20],
  ]);
  const sketch1 = feature('sketch', 'Sketch1', sketchInputs(originPlaneRef('origin:xz'), profile));
  const sketch2 = feature('sketch', 'Sketch2', sketchInputs(originPlaneRef('origin:xy'), holes));
  const extrude1 = feature(
    EXTRUDE_TYPE,
    'Extrude1',
    extrude(
      profilesOf(sketch1.id, profile),
      { direction: 'symmetric', distance: 'width' },
      {
        distance: 'd1',
      },
    ),
  );
  const extrude2 = feature(
    EXTRUDE_TYPE,
    'Extrude2',
    extrude(
      profilesOf(sketch2.id, holes),
      { distance: 'wall * 5', taper: 'tilt / 3', operation: 'cut' },
      { distance: 'd3', taper: 'd2' },
    ),
  );
  // The bend's two edges, named after the side faces of Sketch1's outline
  // (ADR-0005): the inside corner between sides 2 and 3, the outside one
  // between sides 5 and 0.
  const sides = lineIds(profile).map((line) => createdName('extrude', extrude1.id, 'side', line));
  const bend = (a: number, b: number): GeomRef => ({
    kind: 'edge',
    id: edgeName([sides[a] as string, sides[b] as string]),
  });
  const filletSets = filletInputs([
    { edges: [bend(2, 3)], radius: 'wall / 2' },
    { edges: [bend(5, 0)], radius: 'wall * 1.5' },
  ]);
  for (const [key, paramName] of [
    ['radius', 'd4'],
    ['radius2', 'd6'],
  ] as const) {
    const input = filletSets[key];
    if (input?.kind === 'expr') filletSets[key] = { ...input, paramName };
  }
  const fillet1 = feature('fillet', 'Fillet1', filletSets);
  const features = [
    sketch1,
    extrude1,
    sketch2,
    extrude2,
    fillet1,
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
    // Extrude1's body (the kernel's `<feature>:<n>` ID), which the cut keeps.
    bodies: { [`${extrude1.id}:0` as BodyId]: { name: 'Bracket', visible: true } },
  };
}

/** The IDs of a sketch's lines, in the order they were made. */
function lineIds(data: SketchData): SketchEntityId[] {
  return Object.entries(data.entities)
    .filter(([, entity]) => entity.type === 'line')
    .map(([id]) => id as SketchEntityId);
}

/** Every closed profile of a sketch, as references (region IDs as the kernel names them). */
export function profilesOf(sketch: FeatureId, data: SketchData): GeomRef[] {
  return detectProfiles(data).map((p) => ({ kind: 'profile', id: profileRefId(sketch, p.id) }));
}

/** An extrude's inputs with the model parameter names of its expressions. */
function extrude(
  profiles: GeomRef[],
  options: ExtrudeInputOptions,
  names: Partial<Record<'distance' | 'taper', string>>,
): Feature['inputs'] {
  const inputs: Feature['inputs'] = { ...extrudeInputs(profiles, options) };
  for (const [key, paramName] of Object.entries(names)) {
    const input = inputs[key];
    if (input?.kind === 'expr') inputs[key] = { ...input, paramName };
  }
  return inputs;
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
