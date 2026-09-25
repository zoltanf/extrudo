/** Test helpers: small documents and features with readable IDs. Not exported from the package. */
import { createDocument } from './document';
import type { BodyId, DocumentId, FeatureId, ParameterId } from './ids';
import type { ExtrudoDocument, Feature, Parameter } from './schema';

export const fid = (id: string) => id as FeatureId;
export const pid = (id: string) => id as ParameterId;
export const bid = (id: string) => id as BodyId;

export function feature(id: string, type = 'extrude', name = `${type}-${id}`): Feature {
  return {
    id: fid(id),
    type,
    name,
    suppressed: false,
    inputs: { distance: { kind: 'expr', expr: '10 mm' } },
  };
}

export function parameter(id: string, name: string, expression = '1 mm'): Parameter {
  return { id: pid(id), name, expression, unit: 'length' };
}

/** A document with two parameters and three features, marker at the end. */
export function sampleDocument(): ExtrudoDocument {
  return {
    ...createDocument({
      id: 'doc-1' as DocumentId,
      name: 'Sample',
      now: '2026-09-25T10:00:00.000Z',
    }),
    parameters: [parameter('p1', 'width', '40 mm'), parameter('p2', 'wall', '3 mm')],
    features: [
      feature('f1', 'sketch', 'Sketch1'),
      feature('f2', 'extrude', 'Extrude1'),
      feature('f3', 'fillet', 'Fillet1'),
    ],
    timelineMarker: 3,
  };
}
