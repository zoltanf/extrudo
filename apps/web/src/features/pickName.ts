import {
  type BodyId,
  type ExtrudoDocument,
  type GeomRef,
  originAxis,
  originPlane,
  parseProfileRefId,
  parseSketchEntityRefId,
  readSketch,
} from '@extrudo/core';

/** What `pickName` reads: the document's features and body names. */
export interface PickNameContext {
  doc: Pick<ExtrudoDocument, 'features' | 'bodies'>;
}

const ENTITY_NAMES: Record<string, string> = {
  point: 'Point',
  line: 'Line',
  circle: 'Circle',
  arc: 'Arc',
  ellipse: 'Ellipse',
  spline: 'Spline',
};

/**
 * How a selection field names its one pick (P3-17, ADR-0029 open item): "Y axis", "XY plane",
 * a construction feature's name, "Line · Sketch1", "Profile · Sketch2", a body's name.
 * Undefined when the pick can't be named (a sketch that's gone, a body not stored yet, any
 * face, edge or vertex); the field then counts ("1 face").
 */
export function pickName(ref: GeomRef, ctx: PickNameContext | undefined): string | undefined {
  if (ref.kind === 'axis' && originAxis(ref.id)) return originAxis(ref.id)?.label;
  if (ref.kind === 'plane' && originPlane(ref.id)) return originPlane(ref.id)?.label;
  if (!ctx) return undefined;
  const { doc } = ctx;
  const featureName = (id: string) => doc.features.find((f) => f.id === id)?.name;
  switch (ref.kind) {
    case 'axis':
    case 'plane':
    case 'point':
    case 'feature':
      // Construction geometry and repeated features are referred to by their feature's ID.
      return featureName(ref.id);
    case 'sketchEntity': {
      const parsed = parseSketchEntityRefId(ref.id);
      const sketch = parsed && doc.features.find((f) => f.id === parsed.feature);
      const entity = sketch && readSketch(sketch)?.data.entities[parsed.entity];
      if (!sketch || !entity) return undefined;
      return `${ENTITY_NAMES[entity.type] ?? 'Curve'} · ${sketch.name}`;
    }
    case 'profile': {
      const parsed = parseProfileRefId(ref.id);
      const sketch = parsed && featureName(parsed.feature);
      return sketch ? `Profile · ${sketch}` : undefined;
    }
    case 'body':
      return doc.bodies[ref.id as BodyId]?.name;
    default:
      // Faces, edges and vertices have no name a person would recognise ("Face · Body1" says
      // little more than "1 face"): the field counts them.
      return undefined;
  }
}
