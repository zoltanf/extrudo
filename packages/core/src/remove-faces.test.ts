import { describe, expect, it } from 'vitest';
import { FeatureRegistry } from './features';
import { documentFeatures } from './registry';
import {
  REMOVE_FACES_TYPE,
  RemoveFacesInputsSchema,
  removeFacesFeature,
  removeFacesFeatureOf,
  removeFacesInputs,
} from './remove-faces';
import type { GeomRef } from './schema';
import { fid, sampleDocument } from './testing';

const face = (id: string): GeomRef => ({ kind: 'face', id });

describe('the Remove Faces feature', () => {
  it('takes one or more face references', () => {
    const inputs = removeFacesInputs([face('a'), face('b')]);
    expect(RemoveFacesInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs.faces.refs).toEqual([face('a'), face('b')]);
  });

  it('refuses no faces, at the faces input', () => {
    const empty = RemoveFacesInputsSchema.safeParse({ faces: { kind: 'ref', refs: [] } });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.path).toEqual(['faces']);
    expect(RemoveFacesInputsSchema.safeParse({}).success).toBe(false);
    const body = RemoveFacesInputsSchema.safeParse({
      faces: { kind: 'ref', refs: [{ kind: 'body', id: 'E:0' }] },
    });
    expect(body.success).toBe(false);
    expect(body.error?.issues[0]?.path).toEqual(['faces']);
  });

  it('makes a feature that passes the registry check in a document', () => {
    const feature = removeFacesFeatureOf(fid('r'), 'Remove Faces1', [face('x')]);
    expect(feature).toMatchObject({
      id: 'r',
      type: REMOVE_FACES_TYPE,
      name: 'Remove Faces1',
      suppressed: false,
      inputs: { faces: { kind: 'ref', refs: [face('x')] } },
    });
    const doc = sampleDocument();
    const registry = new FeatureRegistry().register(removeFacesFeature);
    expect(registry.check({ ...doc, features: [feature] })).toEqual([]);
  });

  it('is a modify feature of the document registry', () => {
    const definition = documentFeatures().get(REMOVE_FACES_TYPE);
    expect(definition).toMatchObject({
      label: 'Remove Faces',
      category: 'modify',
      icon: 'remove-faces',
    });
  });
});
