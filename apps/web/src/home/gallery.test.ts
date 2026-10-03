import {
  applyCommand,
  configurationChanges,
  currentConfigurations,
  customizerRows,
  DocumentSchema,
  type ExtrudoDocument,
  evaluateParameters,
  type ParameterId,
  setParameterExpressions,
} from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b2 from '../../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b4 from '../../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import { TEMPLATES, type Template, templateFromBytes, withTemplateCustomizer } from './gallery';

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

/**
 * P4-07, ADR-0059 §1 and §2: a template opens with its main parameters exposed
 * for changing and a couple of saved configurations, so its Customizer panel
 * does something straight away. The list is in the gallery, not in the fixtures
 * (the benchmark specs rewrite those), so these tests keep it honest.
 */
describe('template customizers (P4-07)', () => {
  /**
   * The design a template opens. A file template can't be fetched in a node test
   * (`?url` is a dev-server path), so its bytes come from the inline import, the
   * same way the test above opens them.
   */
  const opened = async (t: Template): Promise<ExtrudoDocument> => {
    const fixture = FIXTURES[t.id];
    if (!fixture) return t.create();
    return withTemplateCustomizer(templateFromBytes(bytesOf(fixture.data), t.name), t);
  };

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    '%s exposes 2 to 4 of its own parameters, with a range each',
    async (_, t) => {
      const exposed = t.exposed ?? [];
      expect(exposed.length).toBeGreaterThanOrEqual(2);
      expect(exposed.length).toBeLessThanOrEqual(4);
      const names = (await opened(t)).parameters.map((p) => p.name);
      // Every listed name is a parameter the template really has.
      for (const row of exposed) {
        expect(names, `${t.id}: ${row.name}`).toContain(row.name);
        expect(row.max).toBeGreaterThan(row.min);
        expect(row.step ?? (row.max - row.min) / 100).toBeGreaterThan(0);
      }
      // Two saved configurations, neither of them the size the template opens at.
      expect((t.configurations ?? []).length).toBe(2);
    },
  );

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    '%s opens with the exposed parameters and its configurations on it',
    async (_, t) => {
      const doc = await opened(t);
      expect(DocumentSchema.safeParse(doc).error?.issues ?? []).toEqual([]);
      const rows = customizerRows(doc, evaluateParameters(doc).parameters);
      // The panel's order: ungrouped first, then each group by first appearance.
      expect(rows.map((r) => r.name)).toEqual((t.exposed ?? []).map((r) => r.name));
      // Every exposed row has both ends of a slider range and a plain value.
      for (const row of rows) {
        expect(row.min).toBeDefined();
        expect(row.max).toBeDefined();
        expect(row.plain).toBe(true);
        expect(row.outOfRange).toBe(false);
      }
      const configurations = doc.configurations ?? [];
      expect(configurations.map((c) => c.name)).toEqual(
        (t.configurations ?? []).map((c) => c.name),
      );
      // Every configuration value is one of the template's exposed parameters.
      const ids = new Set(rows.map((r) => r.id));
      for (const configuration of configurations) {
        expect(Object.keys(configuration.values).length).toBe(rows.length);
        for (const id of Object.keys(configuration.values))
          expect(ids.has(id as ParameterId)).toBe(true);
      }
      // Nothing is current: the design opens at its own size, which is neither.
      expect(currentConfigurations(doc)).toEqual([]);
    },
  );

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    '%s computes with each of its configurations applied',
    { timeout: 180_000 },
    async (_, t) => {
      const doc = await opened(t);
      const rows = customizerRows(doc, evaluateParameters(doc).parameters);
      for (const configuration of doc.configurations ?? []) {
        const applied = applyCommand(
          doc,
          setParameterExpressions({ changes: configurationChanges(doc, configuration.id) }),
        ).doc;
        for (const row of rows) {
          expect(applied.parameters.find((p) => p.id === row.id)?.expression, row.name).toBe(
            configuration.values[row.id],
          );
        }
        const result = await failures(applied);
        expect(result.failing, `${t.id}: ${configuration.name}`).toEqual([]);
        expect(result.bodies).toBeGreaterThan(0);
        engines[engines.length - 1]?.clear();
      }
    },
  );

  it('skips a parameter the template does not have, rather than refusing to open', async () => {
    const template = TEMPLATES[1];
    if (!template) throw new Error('no template');
    const doc = await opened(template);
    const customizer = withTemplateCustomizer(doc, {
      exposed: [{ name: 'width', min: 40, max: 200, step: 1 }],
      configurations: [{ name: 'Ghost', values: { gone: '1 mm' } }],
    });
    // The exposed parameter is set as asked; the unknown one changes nothing.
    expect(customizer.parameters.find((p) => p.name === 'width')?.customizer).toEqual({
      min: 40,
      max: 200,
      step: 1,
    });
    expect(customizer.configurations).toEqual(doc.configurations);
  });
});
