import { DocumentSchema, FeatureRegistry, readSketch, sketchFeature } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { circles, outline, TEMPLATES } from './templates';

describe('templates', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s is a valid document', (_, template) => {
    const doc = template.create();
    expect(DocumentSchema.safeParse(doc).error?.issues ?? []).toEqual([]);
    const sketches = new FeatureRegistry().register(sketchFeature);
    const issues = sketches.check({
      ...doc,
      features: doc.features.filter((f) => f.type === 'sketch'),
    });
    expect(issues).toEqual([]);
  });

  it('draws the wall bracket’s profile on XZ and its holes on XY', () => {
    const doc = TEMPLATES[0]?.create();
    const [profile, holes] = (doc?.features ?? []).map(readSketch).filter((s) => s !== undefined);
    expect(profile?.plane).toEqual({ kind: 'plane', id: 'origin:xz' });
    expect(holes?.plane).toEqual({ kind: 'plane', id: 'origin:xy' });
  });
});

describe('outline', () => {
  it('joins one line per side with coincident constraints and squares axis-aligned sides', () => {
    const sketch = outline([
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 8],
    ]);
    const entities = Object.values(sketch.entities);
    expect(entities.filter((e) => e.type === 'line')).toHaveLength(4);
    expect(entities.filter((e) => e.type === 'point')).toHaveLength(8);
    const types = Object.values(sketch.constraints)
      .map((c) => c.type)
      .sort();
    expect(types).toEqual([
      'coincident',
      'coincident',
      'coincident',
      'coincident',
      'horizontal',
      'vertical',
      'vertical',
    ]);
  });

  it('makes circles equal to the first', () => {
    const sketch = circles(3, [
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    expect(Object.values(sketch.constraints).map((c) => c.type)).toEqual(['equal', 'equal']);
  });
});
