/**
 * Patterns, mirrors, MultiTransforms and holes against bad files and a lying
 * kernel (P6-25 S7, ADR-0144): every case ends in a stop with a reason from
 * the closed set, the import carries on, and a count past one of our caps
 * is a clean stop (`limit`), never a kernel failure.
 */
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { NONSENSE_REPLY } from './budget';
import { MAX_ORIGINALS, MAX_TRANSFORM_INSTANCES, MAX_TRANSFORM_STEPS } from './features';
import { label, prop } from './fixtures';
import { type FcstdImportOptions, importFcstd } from './import';
import type { ImportKernel } from './import-kernel';
import { nodeImportKernel } from './node-kernel-test-support';
import { P, type PartChange, type PartOptions, partFile } from './pattern-parts';
import { circle } from './sketch-fixtures';

let planegcs: PlanegcsModule;
let base: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  base = nodeImportKernel();
});

async function run(
  name: string,
  change: PartChange = {},
  options: Partial<FcstdImportOptions> = {},
  part: PartOptions = {},
) {
  const r = await importFcstd(partFile(name, change, part), 'Hostile', {
    kernel: base,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  return { ...r, body: r.report.bodies[0] };
}

const integer = (v: string) => P.raw(`<Integer value="${v}"/>`);
const float = (v: string) => P.raw(`<Float value="${v}"/>`);

describe('numbers a file holds', () => {
  it.each([
    ['0', 'value', /Occurrences of 0/],
    ['-1', 'value', /Occurrences of -1/],
    ['1000000000', 'limit', /more than 1000/],
    ['2.5', 'value', /Occurrences can't be read/],
    ['nan', 'value', /Occurrences can't be read/],
  ])('Occurrences %s stops with %s', async (v, reason, detail) => {
    const { body } = await run('linear_h_axis', {
      LinearPattern: { props: { Occurrences: integer(v) } },
    });
    expect(body?.stop).toMatchObject({ object: 'LinearPattern', reason });
    expect(body?.stop?.detail).toMatch(detail);
    expect(body?.outcome).toBe('shape');
  });

  it.each([
    ['linear_h_axis', 'LinearPattern', 'Length', 'nan', /can't be read/],
    ['linear_h_axis', 'LinearPattern', 'Length', '1e999', /can't be read/],
    ['linear_h_axis', 'LinearPattern', 'Length', '0', /every copy on the original/],
    ['linear_h_axis', 'LinearPattern', 'Length', '-5', /out of range/],
    ['linear_h_axis', 'LinearPattern', 'Length', '1e30', /out of range/],
    ['polar_partial', 'PolarPattern', 'Angle', 'nan', /can't be read/],
    ['polar_partial', 'PolarPattern', 'Angle', '1e999', /can't be read/],
    ['polar_partial', 'PolarPattern', 'Angle', '0', /every copy on the original/],
    ['polar_partial', 'PolarPattern', 'Angle', '361', /out of range/],
  ])('%s with %s.%s = %s stops with value', async (name, object, property, v, detail) => {
    const { body } = await run(name, { [object]: { props: { [property]: float(v) } } });
    expect(body?.stop).toMatchObject({ object, reason: 'value' });
    expect(body?.stop?.detail).toMatch(detail);
  });

  it('a pattern of more instances than the cap is a clean stop before the kernel', async () => {
    const before = base.restarts;
    const { body } = await run('linear_two_directions', {
      LinearPattern: { props: { Occurrences: integer('40'), Occurrences2: integer('26') } },
    });
    expect(body?.stop).toMatchObject({ reason: 'limit' });
    expect(body?.stop?.detail).toMatch(`more than ${MAX_TRANSFORM_INSTANCES}`);
    expect(base.restarts).toBe(before);
  });

  it('two originals count twice towards the cap', async () => {
    const { body } = await run('linear_pad_and_pocket', {
      LinearPattern: { props: { Occurrences: integer('501') } },
    });
    expect(body?.stop).toMatchObject({ reason: 'limit' });
    expect(body?.stop?.detail).toMatch(/1002 instances/);
  });

  it('a gap of its own, and positions left out, are refused', async () => {
    const gaps = await run('linear_h_axis', {
      LinearPattern: { props: { Spacings: P.floats([5, -1]) } },
    });
    expect(gaps.body?.stop).toMatchObject({ reason: 'option' });
    expect(gaps.body?.stop?.detail).toMatch(/gaps of their own/);
    const left = await run('linear_h_axis', {
      LinearPattern: {
        props: { SuppressedIndices: P.raw('<IntegerList count="1"><I v="1"/></IntegerList>') },
      },
    });
    expect(left.body?.stop).toMatchObject({ reason: 'option' });
    const whole = await run('linear_h_axis', {
      LinearPattern: { props: { TransformMode: integer('1') } },
    });
    expect(whole.body?.stop).toMatchObject({ reason: 'option' });
    expect(whole.body?.stop?.detail).toMatch(/whole shape/);
  });

  it('a gap list cut short or of a billion numbers is unreadable, never read', async () => {
    const short = await run('linear_h_axis', {
      LinearPattern: { props: { Spacings: P.raw('<FloatList file="Nowhere"/>') } },
    });
    expect(short.body?.stop).toMatchObject({ reason: 'value' });
    expect(short.body?.stop?.detail).toMatch(/Spacings can't be read/);
  });
});

describe('lists a file holds', () => {
  it('100,000 originals are refused before any is looked at', async () => {
    const many = Array.from({ length: 100_000 }, () => 'Pocket');
    const { body } = await run('linear_h_axis', {
      LinearPattern: { props: { Originals: P.list(many) } },
    });
    expect(body?.stop).toMatchObject({ reason: 'limit' });
    expect(body?.stop?.detail).toMatch(`more than ${MAX_ORIGINALS}`);
  });

  it('a MultiTransform that lists itself, 10,000 steps, or one step twice', async () => {
    const self = await run('multi_linear_linear', {
      MultiTransform: { props: { Transformations: P.list(['LinearPattern', 'MultiTransform']) } },
    });
    expect(self.body?.stop).toMatchObject({ reason: 'multi-transform' });
    expect(self.body?.stop?.detail).toMatch(/itself/);
    const many = await run('multi_linear_linear', {
      MultiTransform: {
        props: { Transformations: P.list(Array.from({ length: 10_000 }, () => 'LinearPattern')) },
      },
    });
    expect(many.body?.stop).toMatchObject({ reason: 'multi-transform' });
    expect(many.body?.stop?.detail).toMatch(`more than ${MAX_TRANSFORM_STEPS}`);
    const twice = await run('multi_linear_linear', {
      MultiTransform: { props: { Transformations: P.list(['LinearPattern', 'LinearPattern']) } },
    });
    expect(twice.body?.stop).toMatchObject({ reason: 'multi-transform' });
    expect(twice.body?.stop?.detail).toMatch(/twice/);
  });

  it('a step that is not a transform, or not in the file', async () => {
    const pad = await run('multi_linear_linear', {
      MultiTransform: { props: { Transformations: P.list(['Pad']) } },
    });
    expect(pad.body?.stop).toMatchObject({ reason: 'multi-transform' });
    const missing = await run('multi_linear_linear', {
      MultiTransform: { props: { Transformations: P.list(['Nothing']) } },
    });
    expect(missing.body?.stop).toMatchObject({ reason: 'multi-transform' });
  });

  it('a step shared by two MultiTransforms belongs to the first', async () => {
    // A second MultiTransform after the first, naming the same steps.
    const second = {
      name: 'MultiTransform001',
      type: 'PartDesign::MultiTransform',
      props: [
        label('MultiTransform001'),
        prop('BaseFeature', 'App::PropertyLink', '<Link value="MultiTransform"/>'),
        prop(
          'Originals',
          'App::PropertyLinkList',
          '<LinkList count="1"><Link value="Pocket"/></LinkList>',
        ),
        prop(
          'Transformations',
          'App::PropertyLinkList',
          '<LinkList count="1"><Link value="LinearPattern"/></LinkList>',
        ),
        prop('Shape', 'Part::PropertyPartShape', '<Part file="MultiTransform.Shape.brp"/>'),
      ],
    };
    const { body } = await run(
      'multi_linear_linear',
      {},
      {},
      { extra: [second], members: ['MultiTransform001'], tip: 'MultiTransform001' },
    );
    expect(body?.mapped.map((m) => m.kind)).toEqual(['pad', 'pocket', 'multi']);
    expect(body?.stop).toMatchObject({ object: 'MultiTransform001', reason: 'multi-transform' });
    expect(body?.stop?.detail).toMatch(/belongs to another feature/);
  });
});

describe('holes a file holds', () => {
  it('a sketch with no circle', async () => {
    const { body } = await run('hole_counterbore', {}, {}, {});
    expect(body?.stop).toBeUndefined();
    // The plate's own sketch has lines only: a hole made of it drills nowhere.
    const none = await run('hole_counterbore', {
      Hole: { props: { Profile: P.sub('Sketch', []) } },
    });
    expect(none.body?.stop).toMatchObject({ object: 'Hole' });
    expect(['sketch', 'chain']).toContain(none.body?.stop?.reason);
  });

  it('100,000 circles are refused before the sketch is drawn', async () => {
    const many = Array.from({ length: 100_000 }, (_, i) => circle(i % 40, 0, 0.1));
    const { body } = await run(
      'hole_counterbore',
      {},
      {},
      { sketchGeometry: { HoleSketch: many } },
    );
    expect(body?.stop).toMatchObject({ object: 'Hole', reason: 'sketch' });
  });

  it('201 circles: one past the most centres', async () => {
    const many = Array.from({ length: 201 }, (_, i) =>
      circle(-19 + (i % 20) * 2, -9 + Math.floor(i / 20) * 1.8, 0.3),
    );
    const { body } = await run('hole_through', {}, {}, { sketchGeometry: { HoleSketch: many } });
    expect(body?.stop).toMatchObject({ object: 'Hole', reason: 'limit' });
  });
});

describe('a kernel that lies, throws or hangs in the calls a transform makes', () => {
  type Lie = (k: ImportKernel) => Partial<ImportKernel>;
  const lying = (lie: Lie): ImportKernel => {
    const honest: ImportKernel = {
      storedShapeToStep: (...a) => base.storedShapeToStep(...a),
      measureStoredShape: (...a) => base.measureStoredShape(...a),
      rebuild: (...a) => base.rebuild(...a),
      describeStoredShape: (...a) => base.describeStoredShape(...a),
      describeBodies: (b, n) => base.describeBodies(b, n),
      references: (i) => base.references(i),
      restart: () => base.restart(),
    };
    return { ...honest, ...lie(honest) };
  };

  it.each([['describeStoredShape' as const], ['describeBodies' as const], ['references' as const]])(
    '%s that throws or hangs stops the body; one that lies is nonsense',
    async (call) => {
      const throws = await run(
        'linear_edge',
        {},
        {
          kernel: lying(() => ({ [call]: () => Promise.reject(new Error('boom')) })),
        },
      );
      expect(throws.body?.stop).toMatchObject({
        object: 'LinearPattern',
        reason: 'kernel',
        detail: 'boom',
      });
      expect(throws.body?.outcome).toBe('shape');
      const hangs = await run(
        'linear_edge',
        {},
        { kernel: lying(() => ({ [call]: () => new Promise(() => {}) })), shapeTimeoutMs: 2_000 },
      );
      expect(hangs.body?.stop).toMatchObject({ object: 'LinearPattern', reason: 'time' });
      const lies = await run(
        'linear_edge',
        {},
        {
          kernel: lying(() => ({
            [call]: async () => ({ __proto__: null, nonsense: 1 }) as never,
          })),
        },
      );
      expect(lies.body?.stop).toMatchObject({ reason: 'kernel', detail: NONSENSE_REPLY });
    },
  );

  it('two candidates for the edge: never the nearest, the history stops', async () => {
    const twice: Lie = (k) => ({
      describeBodies: async (b, n) => {
        const reply = (await k.describeBodies(b, n)) as unknown as Record<
          string,
          { edges: { index: number; type: string; ends?: unknown }[] }
        >;
        for (const d of Object.values(reply)) {
          // Copy the detailed edge along x at y = 0, z = 10 onto another edge's slot.
          const target = d.edges.find(
            (e) =>
              e.type === 'line' && e.ends && JSON.stringify(e).includes('"midpoint":[20,0,10]'),
          );
          const other = d.edges.find((e) => e !== target && e.type === 'line');
          if (target && other) Object.assign(other, { ...target, index: other.index });
        }
        return reply as never;
      },
    });
    const { body } = await run('linear_edge', {}, { kernel: lying(twice) });
    expect(body?.stop).toMatchObject({ object: 'LinearPattern', reason: 'reference' });
    expect(body?.stop?.detail).toMatch(/2 counterparts/);
    expect(body?.stop?.references).toMatchObject({ several: 1 });
  });

  it('a rebuild that throws or hangs after a hole stops that body only', async () => {
    let calls = 0;
    const late: Lie = (k) => ({
      rebuild: (...a) => (++calls >= 2 ? Promise.reject(new Error('boom')) : k.rebuild(...a)),
    });
    const { body } = await run('hole_counterbore', {}, { kernel: lying(late) });
    expect(body?.stop).toMatchObject({ object: 'Hole', reason: 'kernel' });
  });
});
