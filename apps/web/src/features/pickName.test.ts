import {
  type BodyId,
  createDocument,
  createDocumentStore,
  createSketch,
  type FeatureId,
  newId,
  originPlaneRef,
  readSketch,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { pickName } from './pickName';

function setup() {
  const store = createDocumentStore(createDocument());
  const sketch = newId<FeatureId>();
  store.getState().dispatch(createSketch({ id: sketch, plane: originPlaneRef('origin:xy') }));
  const doc = store.getState().doc;
  return { doc, sketch };
}

describe('pickName', () => {
  it('names origin geometry without a document', () => {
    expect(pickName({ kind: 'axis', id: 'origin:y' }, undefined)).toBe('Y axis');
    expect(pickName({ kind: 'plane', id: 'origin:xz' }, undefined)).toBe('XZ plane');
  });

  it('names sketch curves and profiles after their sketch', () => {
    const { doc, sketch } = setup();
    const feature = doc.features.find((f) => f.id === sketch);
    const view = feature && readSketch(feature);
    expect(view).toBeDefined();
    // Put a line and a point in the sketch the way a document would hold them.
    const data = {
      ...view?.data,
      entities: {
        p1: { type: 'point', x: 0, y: 0 },
        p2: { type: 'point', x: 10, y: 0 },
        l1: { type: 'line', start: 'p1', end: 'p2' },
      },
    };
    const withLine = {
      ...doc,
      features: doc.features.map((f) =>
        f.id === sketch
          ? { ...f, inputs: { ...f.inputs, sketch: { kind: 'sketchData', sketch: data } } }
          : f,
      ),
    } as typeof doc;
    const name = doc.features.find((f) => f.id === sketch)?.name;
    expect(pickName({ kind: 'sketchEntity', id: `${sketch}/l1` }, { doc: withLine })).toBe(
      `Line · ${name}`,
    );
    expect(pickName({ kind: 'sketchEntity', id: `${sketch}/p1` }, { doc: withLine })).toBe(
      `Point · ${name}`,
    );
    expect(pickName({ kind: 'profile', id: `${sketch}/r1` }, { doc })).toBe(`Profile · ${name}`);
    // Gone: the field counts instead.
    expect(pickName({ kind: 'sketchEntity', id: `${sketch}/l9` }, { doc })).toBeUndefined();
    expect(pickName({ kind: 'profile', id: 'nope/r1' }, { doc })).toBeUndefined();
  });

  it('names construction features, bodies and repeated features; counts topology', () => {
    const { doc, sketch } = setup();
    const name = doc.features.find((f) => f.id === sketch)?.name;
    const withBody = {
      ...doc,
      bodies: { b1: { name: 'Bracket', visible: true } } as typeof doc.bodies,
    };
    expect(pickName({ kind: 'feature', id: sketch }, { doc })).toBe(name);
    expect(pickName({ kind: 'plane', id: sketch as FeatureId }, { doc })).toBe(name);
    expect(pickName({ kind: 'body', id: 'b1' as BodyId }, { doc: withBody })).toBe('Bracket');
    expect(pickName({ kind: 'body', id: 'b2' }, { doc: withBody })).toBeUndefined();
    expect(pickName({ kind: 'face', id: 'extrude:e1:end' }, { doc })).toBeUndefined();
  });
});
