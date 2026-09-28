import { DocumentSchema, FeatureRegistry, readSketch, sketchFeature } from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { describe, expect, it } from 'vitest';
import { circles, outline, TEMPLATES, wallBracket } from './templates';

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

  it('computes the wall bracket: one body, the L pulled 80 mm wide with two holes', {
    timeout: 60_000,
  }, async () => {
    const doc = wallBracket();
    const engine = new RecomputeEngine(new Kernel(await loadOcct()), kernelFeatures());
    const result = await engine.recompute({ doc });
    if (result.status !== 'done') throw new Error('cancelled');
    const statuses = Object.fromEntries(
      doc.features.map((f) => [f.name, result.features[f.id]?.status]),
    );
    // Fillet1 has no evaluator yet; Plane1 is rolled back.
    expect(statuses).toEqual({
      Sketch1: 'ok',
      Extrude1: 'ok',
      Sketch2: 'ok',
      Extrude2: 'ok',
      Fillet1: 'error',
      Plane1: undefined,
    });
    const [body] = result.bodies;
    expect(result.bodies).toHaveLength(1);
    // The body keeps Extrude1's ID through the cut, so its metadata names it.
    expect(doc.bodies[body?.id as keyof typeof doc.bodies]?.name).toBe('Bracket');
    const p = body?.mesh?.positions ?? new Float32Array();
    const range = (k: number) => {
      const values = Array.from({ length: p.length / 3 }, (_, i) => p[3 * i + k] ?? 0);
      return [Math.min(...values), Math.max(...values)].map((v) => Math.round(v * 100) / 100);
    };
    expect([range(0), range(1), range(2)]).toEqual([
      [0, 40],
      [-40, 40],
      [0, 60],
    ]);
    // Eight faces of the L, and a tapered wall per hole.
    expect((body?.mesh?.faceRanges.length ?? 0) / 2).toBe(10);
    engine.clear();
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
