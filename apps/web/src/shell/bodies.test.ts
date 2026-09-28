import type { BodyId, Feature, FeatureId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { bodyEntries, bodyMetaOf } from './bodies';

const feature = (id: string): Feature => ({
  id: id as FeatureId,
  type: 'extrude',
  name: id,
  suppressed: false,
  inputs: {},
});

describe('bodyEntries', () => {
  const features = [feature('A'), feature('B')];
  const live = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, {}]));

  it('lists the live bodies in timeline order, named Body1, Body2… without metadata', () => {
    const entries = bodyEntries({ features, bodies: {} }, live('B:0', 'A:1', 'A:0'));
    expect(entries.map((e) => [e.id, e.meta.name, e.stored])).toEqual([
      ['A:0', 'Body1', false],
      ['A:1', 'Body2', false],
      ['B:0', 'Body3', false],
    ]);
    expect(bodyMetaOf(entries)['A:1' as BodyId]).toEqual({ name: 'Body2', visible: true });
  });

  it('uses stored metadata, skips names in use, and leaves out bodies that are gone', () => {
    const bodies = {
      ['A:0' as BodyId]: { name: 'Body1', visible: false },
      ['gone:0' as BodyId]: { name: 'Old', visible: true },
    };
    const entries = bodyEntries({ features, bodies }, live('A:0', 'B:0'));
    expect(entries.map((e) => [e.id, e.meta, e.stored])).toEqual([
      ['A:0', { name: 'Body1', visible: false }, true],
      ['B:0', { name: 'Body2', visible: true }, false],
    ]);
  });
});
