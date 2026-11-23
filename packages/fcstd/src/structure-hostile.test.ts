/**
 * Hostile files for S12b (P6-25, ADR-0144): links, arrays, scales, compounds and parts that lie
 * or loop. Each ends cleanly with its reason; the import's time and kernel budgets stay the
 * judges of the whole. Measured with `BENCH=1` (the mesh entries' own limits are in
 * `mesh-read.test.ts`).
 */
import { Design } from '@extrudo/api';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeComponents } from './components';
import { planCompounds } from './compounds';
import { finalShapes } from './final-shapes';
import { importFcstd } from './import';
import { planLink, readPlacementList } from './links';
import { bms } from './mesh-parts';
import { readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import {
  type StructureExtraObject,
  type StructureFileOptions,
  structureFile,
  structureObject,
} from './structure-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

const run = (name: string, options: StructureFileOptions = {}, extra = {}) =>
  importFcstd(structureFile(name, options), name, {
    kernel,
    solver: new SketchSolver(planegcs),
    ...extra,
  });
const bench = (what: string, ms: number) => {
  if (process.env.BENCH) process.stderr.write(`S12BTIME ${what}: ${ms.toFixed(0)} ms\n`);
};

/** The packed array of `link_array` as a template: a link named `name` to `target`. */
function linkXml(
  name: string,
  target: string,
  edit: (xml: string) => string = (x) => x,
): StructureExtraObject {
  const xml = structureObject('link_array', 'Link')
    .xml.replace('name="Link"', `name="${name}"`)
    .replace('<String value="Link"/>', `<String value="${name}"/>`)
    .replace('name="Box"/>', `name="${target}"/>`)
    .replace('<Integer value="3"/>', '<Integer value="0"/>')
    .replace('file="PlacementList"', `file="${name}.PlacementList"`)
    .replace('file="ScaleList"', `file="${name}.ScaleList"`);
  return { name, type: 'App::Link', xml: edit(xml) };
}
const count = (n: number) => (xml: string) =>
  xml.replace('<Integer value="0"/>', `<Integer value="${n}"/>`);
/** A placement list entry: a count and seven doubles a placement. */
function placements(list: readonly (readonly number[])[], countAs = list.length): Uint8Array {
  const bytes = new Uint8Array(4 + 56 * list.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, countAs, true);
  list.forEach((p, i) => {
    for (const [k, v] of p.entries()) view.setFloat64(4 + 56 * i + 8 * k, v, true);
  });
  return bytes;
}
const along = (n: number) =>
  Array.from({ length: n }, (_, i) => [20 * i, 0, 0, 0, 0, 0, 1] as const);

/** Plans the links of a file from the file alone. */
function plans(name: string, options: StructureFileOptions = {}) {
  const doc = readFcstd(structureFile(name, options));
  return {
    doc,
    links: finalShapes(doc)
      .filter((s) => s.kind === 'link')
      .map((s) => [s.object.name, planLink(doc, s)] as const),
  };
}

describe('links that lie or loop', () => {
  it('a link to itself, a cycle, 33 hops, a missing object: S3 left them out with a problem, and still does', async () => {
    const chain = Array.from({ length: 33 }, (_, i) =>
      linkXml(`L${i}`, i === 32 ? 'Box' : `L${i + 1}`),
    );
    const r = await run('link_chain', {
      extra: [
        linkXml('Self', 'Self'),
        linkXml('A', 'B'),
        linkXml('B', 'A'),
        linkXml('Nowhere', 'Missing'),
        ...chain,
      ],
    });
    // L1 … L32 are links to links that hold, each a copy; L0 is past the hops.
    expect(r.report.problems).toEqual(
      expect.arrayContaining([
        'Self: links that lead back to themselves, left out.',
        'A: links that lead back to themselves, left out.',
        'B: links that lead back to themselves, left out.',
        'Nowhere: a link to Missing, which isn’t in the file, left out.'.replace('’', "'"),
        'L0: a link through more than 32 links, left out.',
      ]),
    );
    expect(r.report.links.find((l) => l.object === 'L1')).toMatchObject({ outcome: 'copy' });
  });

  it('a link to a sketch or a sheet has nothing to copy and comes in as today (left out, as before)', async () => {
    const sketchXml =
      '<Object name="Sk"><Properties Count="1" TransientCount="0"><Property name="Label" type="App::PropertyString"><String value="Sk"/></Property></Properties></Object>';
    const r = await run('link_chain', {
      extra: [
        { name: 'Sk', type: 'Sketcher::SketchObject', xml: sketchXml },
        { name: 'Sheet', type: 'Spreadsheet::Sheet', xml: sketchXml.replace(/Sk/g, 'Sheet') },
        linkXml('ToSketch', 'Sk'),
        linkXml('ToSheet', 'Sheet'),
      ],
    });
    for (const o of ['ToSketch', 'ToSheet']) {
      expect(r.report.links.find((l) => l.object === o)).toMatchObject({
        outcome: 'today',
        reason: 'target',
      });
      expect(r.report.leftOut.find((l) => l.object === o)?.reason).toBe('empty');
    }
  });

  it('an ElementCount of 2³¹−1 with a short list, a negative one, a truncated list, placements that aren’t finite', () => {
    const files = (bytes: Uint8Array) => ({
      'Big.PlacementList': bytes,
      'Odd.PlacementList': bytes,
    });
    const { links } = plans('link_chain', {
      extra: [
        linkXml('Big', 'Box', count(2 ** 31 - 1)),
        linkXml('Negative', 'Box', count(-3)),
        linkXml('Short', 'Box', count(3)),
        linkXml('NaN', 'Box', count(2)),
      ],
      entries: {
        ...files(placements(along(3))),
        'Short.PlacementList': placements(along(3)).subarray(0, 100),
        'NaN.PlacementList': placements([
          [0, 0, 0, 0, 0, 0, 1],
          [Number.NaN, 0, 0, 0, 0, 0, 1],
        ]),
      },
    });
    const of = (n: string) => links.find(([name]) => name === n)?.[1];
    expect(of('Big')).toMatchObject({ reason: 'limit' });
    // A negative count is no array: one copy, as FreeCAD shows one.
    expect(of('Negative')).toMatchObject({ instances: [expect.anything()] });
    expect(of('Short')).toMatchObject({ reason: 'array' });
    expect(of('NaN')).toMatchObject({ reason: 'array' });
    expect(readPlacementList(placements(along(2), 3), 3)).toBeUndefined();
    expect(readPlacementList(placements([[0, 0, 0, 0, 0, 0, 0]]), 1)).toBeUndefined();
    expect(readPlacementList(placements([[1e9, 0, 0, 0, 0, 0, 1]]), 1)).toBeUndefined();
  });

  it('an array of an array of an array: the copies are counted before anything is expanded', () => {
    const start = performance.now();
    const { links } = plans('link_chain', {
      extra: [
        linkXml('A1', 'Box', count(20)),
        linkXml('A2', 'A1', count(20)),
        linkXml('A3', 'A2', count(20)),
      ],
      entries: {
        'A1.PlacementList': placements(along(20)),
        'A2.PlacementList': placements(along(20)),
        'A3.PlacementList': placements(along(20)),
      },
    });
    bench('three arrays of 20 planned', performance.now() - start);
    const of = (n: string) => links.find(([name]) => name === n)?.[1];
    expect(of('A1')).toMatchObject({ instances: expect.arrayContaining([expect.anything()]) });
    expect((of('A2') as unknown as { instances: unknown[] }).instances).toHaveLength(400);
    expect(of('A3')).toMatchObject({ reason: 'limit', detail: 'more than 2000 copies' });
  });

  it('a scale of 0, a negative one, NaN, or a list of scales: left out as scaled', () => {
    const scale = (v: string) => (xml: string) =>
      xml.replace('<Float value="1"/>', `<Float value="${v}"/>`);
    const scales = new Uint8Array(4 + 24 * 2);
    const view = new DataView(scales.buffer);
    view.setUint32(0, 2, true);
    for (let i = 0; i < 6; i++) view.setFloat64(4 + 8 * i, i === 4 ? 2 : 1, true);
    const { links } = plans('link_chain', {
      extra: [
        linkXml('Zero', 'Box', scale('0')),
        linkXml('Minus', 'Box', scale('-1')),
        linkXml('NotANumber', 'Box', scale('nan')),
        linkXml('Scales', 'Box', count(2)),
      ],
      entries: { 'Scales.PlacementList': placements(along(2)), 'Scales.ScaleList': scales },
    });
    for (const n of ['Zero', 'Minus', 'NotANumber', 'Scales'])
      expect(links.find(([name]) => name === n)?.[1]).toMatchObject({ reason: 'scaled' });
  });

  it('a part that links to itself through a link inside it ends with a problem, not a loop', async () => {
    // The link of link_to_part, put inside the part it links to.
    const r = await run('link_to_part', {
      edit: (o, xml) =>
        o === 'Part'
          ? xml.replace('<LinkList count="2">', '<LinkList count="3"><Link value="Link"/>')
          : xml,
    });
    expect(r.report.links[0]).toMatchObject({ outcome: 'today', reason: 'cycle' });
  });
});

describe('compounds that lie or loop', () => {
  const compoundXml = (name: string, members: readonly string[]) => ({
    name,
    type: 'Part::Compound',
    xml: structureObject('compound_top', 'Compound')
      .xml.replace('name="Compound"', `name="${name}"`)
      .replace(
        /<LinkList count="2">.*?<\/LinkList>/,
        `<LinkList count="${members.length}">${members.map((m) => `<Link value="${m}"/>`).join('')}</LinkList>`,
      )
      .replace(/<Property name="Shape"[\s\S]*?<\/Property>/, ''),
  });

  it('nested 10,000 deep: planned iteratively, refused at the cap', () => {
    const deep = Array.from({ length: 10_000 }, (_, i) =>
      compoundXml(`C${i}`, i === 9_999 ? ['Box'] : [`C${i + 1}`]),
    );
    const doc = readFcstd(structureFile('compound_touching', { extra: deep }));
    const start = performance.now();
    const shapes = finalShapes(doc);
    const plan = planCompounds(doc, shapes, () => false);
    bench('a compound nested 10,000 deep', performance.now() - start);
    // C0 is no final shape (it holds no stored shape), so only the fixture's own compound is planned.
    expect(plan.map((p) => p.compound.object.name)).toEqual(['Compound']);
    const top = shapes.find((s) => s.object.name === 'Compound');
    const deepTop = { ...(top as NonNullable<typeof top>), object: doc.byName.get('C0') as never };
    const [refused] = planCompounds(doc, [deepTop], () => false);
    expect(refused).toMatchObject({ reason: 'limit' });
    expect(performance.now() - start).toBeLessThan(5_000);
  });

  it('a compound that contains itself, and one member twice', () => {
    const doc = readFcstd(
      structureFile('compound_touching', {
        edit: (o, xml) =>
          o === 'Compound'
            ? xml.replace(
                '<Link value="Box001"/>',
                '<Link value="Box001"/><Link value="Compound"/>',
              )
            : xml,
      }),
    );
    expect(planCompounds(doc, finalShapes(doc), () => false)[0]).toMatchObject({
      reason: 'repeated',
      detail: 'it holds itself through Compound',
    });
    const twice = readFcstd(
      structureFile('compound_touching', {
        edit: (o, xml) =>
          o === 'Compound'
            ? xml.replace('<Link value="Box001"/>', '<Link value="Box001"/><Link value="Box"/>')
            : xml,
      }),
    );
    expect(planCompounds(twice, finalShapes(twice), () => false)[0]).toMatchObject({
      reason: 'repeated',
      detail: 'it holds Box twice',
    });
  });

  it('a member another object uses too: the compound comes in as today', async () => {
    const r = await run('compound_touching', {
      extra: [
        {
          name: 'Cut',
          type: 'Part::Cut',
          xml: '<Object name="Cut"><Properties Count="2" TransientCount="0"><Property name="Base" type="App::PropertyLink"><Link value="Box"/></Property><Property name="Tool" type="App::PropertyLink"><Link value="Box001"/></Property></Properties></Object>',
        },
      ],
    });
    expect(r.report.compounds[0]).toMatchObject({ outcome: 'today', reason: 'shared' });
    expect(r.report.shapes.map((s) => s.object)).toEqual(['Compound']);
  });
});

describe('parts past the component cap', () => {
  it('10,000 parts: the first 1,000 are components, the rest stay loose, quickly', () => {
    const groups = Array.from({ length: 10_000 }, (_, i) => ({
      kind: 'part' as const,
      object: {
        name: `P${i}`,
        label: i % 2 ? `PART ${(i - 1) / 2}` : `Part ${i / 2}`,
        type: 'App::Part',
      } as never,
      bodies: [`f${i}:0`],
    }));
    const doc = { objects: groups.map((g) => g.object) } as never;
    const design = Design.create({ name: 'Parts', units: 'mm' });
    const start = performance.now();
    const report = makeComponents(design, doc, groups, []);
    bench('10,000 parts as components', performance.now() - start);
    expect(report.made).toHaveLength(1_000);
    expect(report.overLimit).toBe(9_000);
    // "Part 0" and "PART 0" differ only by case: the second is "PART 0 (2)".
    expect(report.made.slice(0, 3).map((c) => c.name)).toEqual(['Part 0', 'PART 0 (2)', 'Part 1']);
    expect(new Set(report.made.map((c) => c.name.toLowerCase())).size).toBe(1_000);
    expect(performance.now() - start).toBeLessThan(30_000);
  }, 60_000);
});

describe('a large mesh through the kernel (BENCH=1)', () => {
  it.skipIf(!process.env.BENCH)(
    'times a mesh of about 50,000 facets from entry to checked body',
    async () => {
      // A closed tube: 250 points a ring, 101 rings, a fan at each end, facing outwards.
      const m = 250;
      const k = 100;
      const points: number[] = [];
      for (let r = 0; r <= k; r++)
        for (let j = 0; j < m; j++) {
          const a = (2 * Math.PI * j) / m;
          points.push(20 * Math.cos(a), 20 * Math.sin(a), r * 0.5);
        }
      const bottom = points.length / 3;
      points.push(0, 0, 0);
      const top = bottom + 1;
      points.push(0, 0, k * 0.5);
      const p = (r: number, j: number) => r * m + (j % m);
      const facets: number[] = [];
      for (let r = 0; r < k; r++)
        for (let j = 0; j < m; j++)
          facets.push(p(r, j), p(r, j + 1), p(r + 1, j + 1), p(r, j), p(r + 1, j + 1), p(r + 1, j));
      for (let j = 0; j < m; j++)
        facets.push(bottom, p(0, j + 1), p(0, j), top, p(k, j), p(k, j + 1));
      const entry = bms(points, facets);
      const start = performance.now();
      const r = await run('meshes', { files: (o, _f, b) => (o === 'Mesh' ? entry : b) });
      bench(
        `a mesh of ${facets.length / 3} facets (${entry.length} bytes) imported`,
        performance.now() - start,
      );
      expect(r.report.meshes[0]).toMatchObject({ outcome: 'in', pieces: 1 });
    },
    600_000,
  );
});
