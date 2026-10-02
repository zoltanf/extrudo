import { DocumentSchema, type ExtrudoDocument } from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b2 from '../../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b4 from '../../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import { TEMPLATES, templateFromBytes } from './gallery';

/** The bytes of a `data:` URL (Vite's `?url&inline` import of a binary file). */
const bytesOf = (dataUrl: string) =>
  Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));

/** The fixture each file template comes from. */
const FIXTURES: Record<string, { name: string; data: string }> = {
  'storage-box': { name: 'b2-storage-box.extrudo', data: b2 },
  'box-with-lid': { name: 'b4-box-with-lid.extrudo', data: b4 },
  'pcb-enclosure': { name: 'b5-pcb-enclosure.extrudo', data: b5 },
};

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
const engines: RecomputeEngine[] = [];
afterAll(() => {
  for (const engine of engines) engine.clear();
});

/** What a template's document computes to: the failing features, by name. */
async function failures(doc: ExtrudoDocument) {
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  engines.push(engine);
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
  return {
    bodies: result.bodies.length,
    failing: doc.features
      .filter((f) => result.features[f.id] && result.features[f.id]?.status !== 'ok')
      .map((f) => f.name),
  };
}

describe('template gallery (P3-12)', () => {
  it('offers the wall bracket and the three benchmark designs', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      'wall-bracket',
      'storage-box',
      'box-with-lid',
      'pcb-enclosure',
    ]);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    '%s has a name, a one-line description and a thumbnail',
    (_, t) => {
      expect(t.name.length).toBeGreaterThan(2);
      expect(t.summary).toMatch(/\.$/);
      expect(t.summary.length).toBeLessThan(80);
      expect(t.thumbnail).toMatch(/\.png/);
    },
  );

  it.each(Object.entries(FIXTURES))('%s comes from its fixture file', (id, fixture) => {
    expect(TEMPLATES.find((t) => t.id === id)?.file).toContain(fixture.name);
  });

  it.each(Object.entries(FIXTURES))(
    '%s opens as a copy under a new ID and the template’s name, and recomputes',
    { timeout: 120_000 },
    async (id, fixture) => {
      const template = TEMPLATES.find((t) => t.id === id);
      if (!template) throw new Error(id);
      const doc = templateFromBytes(bytesOf(fixture.data), template.name);
      const again = templateFromBytes(bytesOf(fixture.data), template.name);
      expect(DocumentSchema.safeParse(doc).error?.issues ?? []).toEqual([]);
      expect(doc.name).toBe(template.name);
      expect(doc.id).not.toBe(again.id);
      expect(doc.features.length).toBeGreaterThan(3);
      const result = await failures(doc);
      expect(result.failing).toEqual([]);
      expect(result.bodies).toBeGreaterThan(0);
    },
  );

  it('opens the wall bracket with its own ID each time, and computes a body', {
    timeout: 60_000,
  }, async () => {
    const template = TEMPLATES[0];
    const [one, two] = await Promise.all([template?.create(), template?.create()]);
    if (!one || !two) throw new Error('no template');
    expect(one.id).not.toBe(two.id);
    expect(one.name).toBe('Wall bracket');
    const result = await failures(one);
    // Plane1 is the template's rolled-back placeholder.
    expect(result.failing).not.toContain('Fillet1');
    expect(result.bodies).toBe(1);
  });
});
