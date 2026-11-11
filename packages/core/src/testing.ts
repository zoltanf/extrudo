/** Test helpers: small documents and features with readable IDs. Not exported from the package. */
import { createDocument } from './document';
import type { BodyId, DocumentId, FeatureId, ParameterId, SheetId, SheetViewId } from './ids';
import type { ExtrudoDocument, Feature, Parameter } from './schema';
import type { Sheet, SheetView } from './sheet-schema';

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

/** A base view looking along +Y, up +Z (ADR-0143). */
export const front = (id = 'v1', name = 'Front'): SheetView => ({
  id: id as SheetViewId,
  name,
  at: [100, 120],
  from: { kind: 'base', direction: [0, 1, 0], up: [0, 0, 1] },
});

/** A view projected to the right of `parent`. */
export const projected = (id: string, parent: string, name = id): SheetView => ({
  id: id as SheetViewId,
  name,
  at: [200, 120],
  from: { kind: 'projected', parent: parent as SheetViewId, side: 'right' },
});

/** A sheet with no views or items: A3 landscape, 1:2, first angle. */
export function sheet(id = 's1', name = 'Sheet 1', extra: Partial<Sheet> = {}): Sheet {
  return {
    id: id as SheetId,
    name,
    size: 'A3',
    orientation: 'landscape',
    scale: [1, 2],
    projection: 'first',
    decimals: 1,
    views: [],
    items: [],
    ...extra,
  };
}
