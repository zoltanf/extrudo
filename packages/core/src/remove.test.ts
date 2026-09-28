import { describe, expect, it } from 'vitest';
import { FeatureRegistry } from './features';
import { REMOVE_TYPE, removeBodiesFeature, removeBodiesFeatureOf, removedBodies } from './remove';
import { bid, fid, sampleDocument } from './testing';

describe('the Remove feature', () => {
  it('takes one or more body references', () => {
    const feature = removeBodiesFeatureOf(fid('r'), 'Remove1', [
      bid('E:0'),
      bid('E:1'),
      bid('E:0'),
    ]);
    expect(feature).toMatchObject({ type: REMOVE_TYPE, name: 'Remove1', suppressed: false });
    expect(removedBodies(feature)).toEqual(['E:0', 'E:1']);
    const schema = removeBodiesFeature.inputsSchema;
    expect(schema.safeParse(feature.inputs).success).toBe(true);
    expect(schema.safeParse({ bodies: { kind: 'ref', refs: [] } }).success).toBe(false);
    expect(
      schema.safeParse({ bodies: { kind: 'ref', refs: [{ kind: 'face', id: 'x' }] } }).success,
    ).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('passes the registry check in a document', () => {
    const doc = sampleDocument();
    const registry = new FeatureRegistry().register(removeBodiesFeature);
    const remove = removeBodiesFeatureOf(fid('r'), 'Remove1', [bid('f2:0')]);
    expect(registry.check({ ...doc, features: [remove] })).toEqual([]);
    const extrude = doc.features[1];
    expect(extrude && removedBodies(extrude)).toEqual([]);
  });
});
