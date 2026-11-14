/**
 * Hostile files and limits for the stored-shape step (P6-25 S8, ADR-0144):
 * long runs, the step cap, stored shapes that are too large, missing or not
 * a shape, a kernel that lies, throws or hangs in a step's conversion and in
 * the rebuild after it, and a reference into a superseded step's import.
 * Built from `mid_draft` (pad, pocket, Draft, pocket, fillet) and
 * `step_then_step`, with copies of their objects chained.
 */

import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_BODY_STEPS } from './bodies';
import { NONSENSE_REPLY } from './budget';
import { documentXml, type FixtureObject, fcstd, guiXml, links } from './fixtures';
import { type FcstdImportOptions, importFcstd } from './import';
import type { ImportKernel } from './import-kernel';
import { MAX_STORED_BREP_BYTES } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import { P, type PartChange, partObjects } from './pattern-parts';
import { STEP_FIXTURES, stepFile } from './step-parts';

let planegcs: PlanegcsModule;
let base: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  base = nodeImportKernel();
});

type Lie = (k: ImportKernel) => Partial<ImportKernel>;
/** The test kernel with some calls replaced; `count` counts the conversions. */
function lying(lie: Lie = () => ({})) {
  const count = { conversions: 0 };
  const honest: ImportKernel = {
    storedShapeToStep: (...a) => {
      count.conversions++;
      return base.storedShapeToStep(...a);
    },
    measureStoredShape: (...a) => base.measureStoredShape(...a),
    rebuild: (...a) => base.rebuild(...a),
    describeStoredShape: (...a) => base.describeStoredShape(...a),
    describeBodies: (b, n) => base.describeBodies(b, n),
    references: (i) => base.references(i),
    restart: () => base.restart(),
  };
  return { kernel: { ...honest, ...lie(honest) }, count };
}

async function runBytes(bytes: Uint8Array, options: Partial<FcstdImportOptions> = {}) {
  const r = await importFcstd(bytes, 'Hostile', {
    kernel: base,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  return {
    ...r,
    body: r.report.bodies[0],
    features: r.design.doc.features.map((f) => `${f.type} ${f.name}`),
  };
}

/**
 * `mid_draft` with its chain rewritten to `order`: each entry the name of
 * one of its features, copies of the same one named `<name>_<k>` (each with
 * the template's properties, its `BaseFeature` the entry before it, and the
 * template's stored shape). The tip is the last entry.
 */
function chained(order: readonly string[], change: PartChange = {}): Uint8Array {
  const { objects, entries } = partObjects('mid_draft', change, { fixtures: STEP_FIXTURES });
  const byName = new Map(objects.map((o) => [o.name, o]));
  const seen = new Map<string, number>();
  const names: string[] = [];
  const copies: FixtureObject[] = [];
  for (const template of order) {
    const k = (seen.get(template) ?? 0) + 1;
    seen.set(template, k);
    const name = k === 1 ? template : `${template}_${k}`;
    const previous = names.at(-1) ?? '';
    names.push(name);
    const t = byName.get(template) as FixtureObject;
    copies.push({
      ...t,
      name,
      props: t.props.map((p) =>
        p.startsWith('<Property name="BaseFeature"')
          ? p.replace(/<Link value="[^"]*"\/>/, `<Link value="${previous}"/>`)
          : // A dress-up's base is the feature before it, so its edges are that one's.
            p.startsWith('<Property name="Base"')
            ? p.replace(/<LinkSub value="[^"]*"/, `<LinkSub value="${previous}"`)
            : p,
      ),
    });
  }
  const sketches = objects.filter((o) => o.type.startsWith('Sketcher::'));
  const others = objects.filter(
    (o) =>
      o.name !== 'Body' && !o.type.startsWith('Sketcher::') && !o.type.startsWith('PartDesign::'),
  );
  const body = byName.get('Body') as FixtureObject;
  const tip = names.at(-1) as string;
  const final = entries[`${order.at(-1)}.Shape.brp`];
  const bodyObject: FixtureObject = {
    ...body,
    props: body.props.map((p) =>
      p.startsWith('<Property name="Group"')
        ? links('Group', [...sketches.map((s) => s.name), ...names])
        : p.startsWith('<Property name="Tip"')
          ? p.replace(/<Link value="[^"]*"\/>/, `<Link value="${tip}"/>`)
          : p,
    ),
  };
  return fcstd({
    'Document.xml': documentXml([bodyObject, ...others, ...sketches, ...copies], {
      version: '1.1.4R20260101 (Git)',
    }),
    'GuiDocument.xml': guiXml([{ name: 'Body', visible: true, colour: 0x3366ccff }]),
    ...entries,
    ...(final !== undefined ? { 'Body.Shape.brp': final } : {}),
  });
}

const MID = ['Pad', 'Pocket', 'Draft', 'Pocket001', 'Fillet'];

describe('runs', () => {
  it('chained() rebuilds mid_draft itself as the fixture does', async () => {
    const r = await runBytes(chained(MID));
    expect(r.body?.outcome).toBe('history');
    expect(r.body?.steps.map((s) => s.shape)).toEqual(['Draft']);
  }, 60_000);

  it('1,996 unmappable features in a row are one step and one conversion', async () => {
    // 2,000 features, the file cap: pad, pocket, 1,996 drafts (each storing the draft's shape), pocket, fillet.
    const { kernel, count } = lying();
    const order = [
      'Pad',
      'Pocket',
      ...Array.from({ length: 1996 }, () => 'Draft'),
      'Pocket001',
      'Fillet',
    ];
    const t = performance.now();
    // The body cap (500, `MAX_BODY_FEATURES`) raised to the file's: one body holds them all.
    const r = await runBytes(chained(order), { kernel, maxBodyFeatures: 2000 });
    const ms = performance.now() - t;
    expect(r.body?.outcome).toBe('history');
    expect(r.body?.steps).toHaveLength(1);
    expect(r.body?.steps[0]?.features).toHaveLength(1996);
    expect(r.body?.steps[0]?.shape).toBe('Draft_1996');
    expect(r.body?.heldAfterLastStep).toBe(2);
    expect(count.conversions).toBe(1);
    process.stderr.write(`S8TIME 2,000 features, a run of 1,996: ${Math.round(ms)} ms\n`);
  }, 120_000);

  it('1,998 unmappable features up to the tip cost no step conversion, only the final shape', async () => {
    const { kernel, count } = lying();
    const r = await runBytes(
      chained(['Pad', 'Pocket', ...Array.from({ length: 1998 }, () => 'Draft')]),
      { kernel, maxBodyFeatures: 2000 },
    );
    expect(r.body?.outcome).toBe('shape');
    expect(r.body?.stop).toMatchObject({ object: 'Draft', reason: 'type' });
    expect(r.body?.stop?.run).toHaveLength(1997);
    expect(count.conversions).toBe(1);
  }, 120_000);

  it(`every second feature unmappable: ${MAX_BODY_STEPS} steps, then the body ends with limit`, async () => {
    const order = [
      'Pad',
      'Pocket',
      ...Array.from({ length: 10 }, () => ['Draft', 'Pocket001']).flat(),
    ];
    const t = performance.now();
    const r = await runBytes(chained(order));
    const ms = performance.now() - t;
    expect(r.body?.steps).toHaveLength(MAX_BODY_STEPS);
    expect(r.body?.stop).toMatchObject({ object: 'Draft_9', reason: 'limit' });
    expect(r.body?.stop?.detail).toMatch(/more than 8 stored-shape steps/);
    // The body's final shape comes in, its last live bodies taken out.
    expect(r.body?.outcome).toBe('shape');
    expect(r.features.filter((f) => f.startsWith('import '))).toHaveLength(MAX_BODY_STEPS + 1);
    // Each step's file is in the design once (they are the same shape: one attachment).
    expect(Object.keys(r.design.doc.attachments ?? {})).toHaveLength(2);
    process.stderr.write(
      `S8TIME ${MAX_BODY_STEPS} steps and ${MAX_BODY_STEPS} pockets on them: ${Math.round(ms)} ms\n`,
    );
  }, 120_000);

  it('the step text cap ends the body as the step cap does', async () => {
    const r = await runBytes(chained(MID), { maxStepTextBytes: 1000 });
    expect(r.body?.stop).toMatchObject({ object: 'Draft', reason: 'limit' });
    expect(r.body?.stop?.detail).toMatch(/would convert more than/);
    expect(r.body?.outcome).toBe('shape');
    expect(r.body?.steps).toEqual([]);
  }, 60_000);

  it('a run of tried features that each fail converts once per feature tried, then holds', async () => {
    // Draft, then ten pockets 2 mm deep where the file's are 4: each is tried on the step, fails,
    // and moves it forward; the fillet then holds on the last pocket's stored shape.
    const { kernel, count } = lying();
    const order = [
      'Pad',
      'Pocket',
      'Draft',
      ...Array.from({ length: 10 }, () => 'Pocket001'),
      'Fillet',
    ];
    const t = performance.now();
    const r = await runBytes(chained(order, { Pocket001: { props: { Length: P.float(2) } } }), {
      kernel,
    });
    const ms = performance.now() - t;
    expect(r.body?.steps).toHaveLength(1);
    expect(r.body?.steps[0]?.shape).toBe('Pocket001_10');
    // Each was tried: the first differs, the rest cut nothing (their hole is in the stored shape already).
    const tried = r.body?.steps[0]?.features.slice(1).map((f) => f.reason);
    expect(tried).toEqual(['differs', ...Array.from({ length: 9 }, () => 'failed')]);
    expect(count.conversions).toBe(11);
    expect(Object.keys(r.design.doc.attachments ?? {})).toHaveLength(1);
    process.stderr.write(`S8TIME a run of 11, each tried: ${Math.round(ms)} ms\n`);
  }, 120_000);
});

describe('stored shapes that cannot come in', () => {
  it("a stored shape over the kernel's 32 MB in the middle extends the run", async () => {
    // Letters that don't compress, so the archive's ratio limit lets the entry through to the size check.
    let x = 1;
    const noise = Buffer.alloc(MAX_STORED_BREP_BYTES + 1);
    for (let i = 0; i < noise.length; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      noise[i] = 97 + ((x >>> 24) % 26);
    }
    const big = `\nCASCADE Topology V1, (c) Matra-Datavision\n${noise.toString('latin1')}`;
    const { kernel, count } = lying();
    const r = await runBytes(stepFile('mid_draft', { Draft: { stored: big } }), { kernel });
    expect(r.body?.steps[0]?.features.map((f) => f.object)).toEqual(['Draft', 'Pocket001']);
    expect(r.body?.steps[0]?.shape).toBe('Pocket001');
    expect(count.conversions).toBe(1);
    expect(r.report.restarts).toBe(0);
  }, 60_000);

  it.each([
    ['missing', null],
    ['not a shape', 'this is no shape'],
    [
      'a shape with no solid',
      '\nCASCADE Topology V1, (c) Matra-Datavision\nLocations 0\nCurve2ds 0\nCurves 0\nPolygon3D 0\nPolygonOnTriangulations 0\nSurfaces 0\nTriangulations 0\n\nTShapes 1\nVe\n1e-07\n0 0 0\n0 0\n\n0101101\n*\n\n+1 0 ',
    ],
  ])(
    'a stored entry that is %s extends the run, and the fillet still holds',
    async (_, stored) => {
      const r = await runBytes(stepFile('mid_draft', { Draft: { stored } }));
      expect(r.body?.outcome).toBe('history');
      expect(r.body?.steps[0]?.shape).toBe('Pocket001');
      expect(r.body?.mapped.at(-1)?.object).toBe('Fillet');
    },
    60_000,
  );
});

describe('a kernel that lies, throws or hangs', () => {
  /** Replaces the first call of `name` that `when` picks. */
  const once =
    <K extends 'storedShapeToStep' | 'rebuild'>(
      name: K,
      instead: (...a: Parameters<ImportKernel[K]>) => Promise<unknown>,
      when: (...a: Parameters<ImportKernel[K]>) => boolean = () => true,
    ): Lie =>
    (k) => {
      let done = false;
      return {
        [name]: (...a: Parameters<ImportKernel[K]>) => {
          if (!done && when(...a)) {
            done = true;
            return instead(...a);
          }
          return (k[name] as (...x: Parameters<ImportKernel[K]>) => Promise<unknown>)(...a);
        },
      };
    };
  const withImport = (doc: { features: readonly { type: string }[] }) =>
    doc.features.some((f) => f.type === 'import');
  const never = () => new Promise<never>(() => {});

  it.each<[string, Lie, number | undefined]>([
    ['lies in the conversion', once('storedShapeToStep', async () => ({ step: 5 })), undefined],
    [
      'throws in the conversion',
      once('storedShapeToStep', async () => Promise.reject(new Error('trap'))),
      undefined,
    ],
    ['hangs in the conversion', once('storedShapeToStep', never), 2_000],
    [
      'lies in the rebuild after a step',
      once('rebuild', async () => ({ ids: [1] }), withImport),
      undefined,
    ],
    [
      'throws in the rebuild after a step',
      once('rebuild', async () => Promise.reject(new Error('trap')), withImport),
      undefined,
    ],
    ['hangs in the rebuild after a step', once('rebuild', never, withImport), 2_000],
  ])(
    'one that %s: a restart, the run extends, and the body carries on',
    async (_, lie, ms) => {
      const before = base.restarts;
      const { kernel } = lying(lie);
      const r = await runBytes(stepFile('mid_draft'), {
        kernel,
        ...(ms ? { shapeTimeoutMs: ms } : {}),
      });
      expect(r.report.restarts).toBe(1);
      expect(base.restarts).toBe(before + 1);
      expect(r.body?.outcome).toBe('history');
      expect(r.body?.steps[0]?.features.map((f) => f.object)).toEqual(['Draft', 'Pocket001']);
      expect(r.body?.mapped.at(-1)?.object).toBe('Fillet');
      expect(Object.keys(r.design.doc.attachments ?? {})).toHaveLength(1);
    },
    60_000,
  );

  it('a rebuild that measures the import wrongly is a failed check: no restart, the run extends', async () => {
    const lie: Lie = (k) => {
      let done = false;
      return {
        rebuild: async (doc, files, skip) => {
          const r = await k.rebuild(doc, files, skip);
          if (done || !withImport(doc)) return r;
          done = true;
          const bodies = Object.fromEntries(
            Object.entries(r.bodies).map(([id, m]) => [id, { ...m, volume: m.volume * 1.01 }]),
          );
          return { ...r, bodies };
        },
      };
    };
    const { kernel } = lying(lie);
    const r = await runBytes(stepFile('mid_draft'), { kernel });
    expect(r.report.restarts).toBe(0);
    expect(r.body?.steps[0]?.shape).toBe('Pocket001');
  }, 60_000);

  it('a conversion that always fails: the kernel is replaced three times, then the body ends as before S8', async () => {
    const { kernel } = lying(() => ({
      storedShapeToStep: async () => Promise.reject(new Error('trap')),
    }));
    const r = await runBytes(stepFile('mid_draft'), { kernel });
    expect(r.report.restarts).toBe(3);
    expect(r.body?.steps).toEqual([]);
    expect(r.body?.outcome).toBe('left-out');
    expect(Object.keys(r.design.doc.attachments ?? {})).toHaveLength(0);
    expect(r.features.some((f) => f.startsWith('import ') || f.startsWith('remove '))).toBe(false);
  }, 60_000);
});

describe('a reference into a superseded step', () => {
  it("a kernel naming the first step's import for the fillet after the second is refused", async () => {
    // The first import's ID in place of the second's: a name of the document sent, but of no
    // feature that shapes the body now.
    let first: string | undefined;
    let ids: string[] = [];
    const { kernel } = lying((k) => ({
      rebuild: async (doc, files, skip) => {
        first ??= doc.features.find((f) => f.type === 'import')?.id;
        ids = doc.features.map((f) => f.id as string).sort((a, b) => b.length - a.length);
        return k.rebuild(doc, files, skip);
      },
      // Every feature the name has becomes the first import: a name of only a superseded step.
      references: async (items) => {
        const refs = await k.references(items);
        return refs.map((ref) =>
          ref && first
            ? { ...ref, id: ids.reduce((n, id) => n.split(id).join(first as string), ref.id) }
            : ref,
        ) as typeof refs;
      },
    }));
    const before = base.restarts;
    const r = await runBytes(stepFile('step_then_step'), { kernel });
    expect(r.body?.steps).toHaveLength(2);
    expect(r.body?.stop).toMatchObject({
      object: 'Fillet',
      reason: 'kernel',
      detail: NONSENSE_REPLY,
    });
    expect(base.restarts).toBe(before + 1);
    expect(r.body?.outcome).toBe('shape');
  }, 60_000);

  it('a fillet whose base is a feature before the last step is refused (base), never matched on the import', async () => {
    const r = await runBytes(
      stepFile('step_then_step', { Fillet: { props: { Base: P.sub('Draft', ['Edge1']) } } }),
    );
    expect(r.body?.stop).toMatchObject({ object: 'Fillet', reason: 'base' });
    expect(r.body?.steps).toHaveLength(2);
  }, 60_000);
});
