import {
  type BodyId,
  createDocument,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  newId,
  type Parameter,
  type ParameterId,
  type UnitKind,
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
 * features have no geometry yet; they fill the timeline and the Parameters
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
  const features = [
    feature('sketch', 'Sketch1'),
    feature('extrude', 'Extrude1', {
      distance: { kind: 'expr', expr: 'inner / 4', paramName: 'd1', unit: 'length' },
      taper: { kind: 'expr', expr: 'tilt / 3', paramName: 'd2', unit: 'angle' },
    }),
    feature('sketch', 'Sketch2'),
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
