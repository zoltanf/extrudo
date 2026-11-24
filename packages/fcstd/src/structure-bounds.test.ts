/**
 * S12b (P6-25, ADR-0144): links to meshes, links to parts settled in order, what came in before
 * coming in whatever the new attempts cost (and staying within the design's attachments), scales
 * judged first, and the bounds a hostile file could otherwise drive past (copies, part members,
 * meshes, compounds' users, stored shapes).
 */
import { Design } from '@extrudo/api';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { KernelBudget } from './budget';
import { planCompounds } from './compounds';
import { type FinalShape, finalShapes } from './final-shapes';
import { importFcstd } from './import';
import type { ImportKernel } from './import-kernel';
import { planLink } from './links';
import { importMeshes } from './meshes';
import { type FcDocument, type FcObject, readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import { partFile } from './part-parts';
import { attachmentBytes } from './shapes';
import { StructureBuild } from './structure-build';
import {
  linkObject,
  partObject,
  placementListEntry,
  type StructureExtraObject,
  type StructureFileOptions,
  structureEntry,
  structureFile,
  structureObject,
} from './structure-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

const run = (
  name: string,
  options: StructureFileOptions = {},
  more: Partial<Parameters<typeof importFcstd>[2]> = {},
) =>
  importFcstd(structureFile(name, options), name, {
    kernel,
    solver: new SketchSolver(planegcs),
    ...more,
  });
const bench = (what: string, ms: number) => {
  if (process.env.BENCH) process.stderr.write(`S12BTIME ${what}: ${ms.toFixed(0)} ms\n`);
};
const IDENTITY = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const QUARTER_Z = { position: [0, 100, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] };
const measured = async (r: Awaited<ReturnType<typeof run>>) => {
  const m = await nodeImportKernel().rebuild(r.design.toJSON(), r.files);
  expect(m.failed).toEqual([]);
  return m;
};
const boxOf = (m: { box: { min: readonly number[]; max: readonly number[] } } | undefined) => [
  ...(m?.box.min ?? []),
  ...(m?.box.max ?? []),
];
const close = (got: readonly number[], want: readonly number[], tol = 1e-3) => {
  expect(got).toHaveLength(want.length);
  for (const [i, v] of got.entries()) expect(Math.abs(v - (want[i] as number))).toBeLessThan(tol);
};
/** A mesh object naming `entry`, from the `meshes` fixture's cube. */
const meshObject = (name: string, entry = 'MeshKernel.bms'): StructureExtraObject => ({
  name,
  type: 'Mesh::Feature',
  xml: structureObject('meshes', 'Mesh')
    .xml.replace('name="Mesh"', `name="${name}"`)
    .replace('file="MeshKernel.bms"', `file="${entry}"`),
});

describe('a link to a mesh', () => {
  it('is one copy of the mesh body, where FreeCAD shows it, never a mesh of its own', async () => {
    // LinkTransform off: the link shows the turned cylinder's own points at its placement,
    // a quarter turn about Z and 100 along Y: x −5…5, y 100…120, z −5…5.
    const r = await run('meshes', {
      extra: [linkObject('MeshLink', 'Mesh001', { placement: QUARTER_Z })],
    });
    expect(r.report.meshes.map((m) => m.object)).toEqual(['Mesh', 'Mesh001', 'Mesh002']);
    expect(r.report.links).toMatchObject([
      { object: 'MeshLink', outcome: 'copy', target: 'Mesh001' },
    ]);
    expect(r.design.doc.features.map((f) => f.type)).toEqual([
      'import',
      'import',
      'import',
      'move',
    ]);
    const m = await measured(r);
    expect(m.ids).toHaveLength(4);
    const copy = m.bodies[r.report.links[0]?.bodies[0] as string];
    close(boxOf(copy), [-5, 100, -5, 5, 120, 5]);
    expect(
      Math.abs((copy?.volume ?? 0) / (structureObject('meshes', 'Mesh001').mesh?.volume ?? 1) - 1),
    ).toBeLessThan(1e-4);
    // Every final shape once: three meshes and one copy.
    expect(r.report.finalShapes).toBe(4);
    expect(r.report.shapes).toEqual([]);
  });

  it('an array onto a mesh is one copy an element', async () => {
    const r = await run('meshes', {
      extra: [linkObject('MeshArray', 'Mesh', { count: 2, placement: IDENTITY })],
      entries: {
        'MeshArray.PlacementList': placementListEntry([
          [0, 200, 0, 0, 0, 0, 1],
          [50, 200, 0, 0, 0, 0, 1],
        ]),
      },
    });
    expect(r.report.meshes).toHaveLength(3);
    expect(r.report.links[0]).toMatchObject({
      outcome: 'copy',
      array: { elements: 2, expanded: true },
    });
    const m = await measured(r);
    const [a, b] = (r.report.links[0]?.bodies ?? []).map((id) => boxOf(m.bodies[id]));
    // The cube is 10 × 20 × 30 about its centre.
    close(a as number[], [-5, 190, -15, 5, 210, 15]);
    close(b as number[], [45, 190, -15, 55, 210, 15]);
    expect(m.ids).toHaveLength(5);
  });
});

describe('links to parts, in dependency order', () => {
  /** Part i holds link i to part i + 1; the last part holds the box. */
  const chain = (n: number): StructureExtraObject[] => [
    ...Array.from({ length: n }, (_, i) => partObject(`P${i}`, [`L${i}`])),
    partObject(`P${n}`, ['Box']),
    ...Array.from({ length: n }, (_, i) =>
      linkObject(`L${i}`, `P${i + 1}`, { placement: IDENTITY }),
    ),
  ];

  it('three parts each linking the next come in as three copies, the innermost first', async () => {
    const r = await run('link_chain', { extra: chain(3) });
    const of = (o: string) => r.report.links.find((l) => l.object === o);
    for (const o of ['L0', 'L1', 'L2'])
      expect(of(o)).toMatchObject({ outcome: 'copy', part: true });
    // Settled from the innermost out: L2 before L1 before L0.
    const order = r.report.links.map((l) => l.object).filter((o) => /^L\d$/.test(o));
    expect(order).toEqual(['L2', 'L1', 'L0']);
  });

  it('2,000 parts each linking the next are settled in linear time', async () => {
    const start = performance.now();
    // No copy is made (the import's copies are none): the order alone is measured.
    const r = await run('link_chain', { extra: chain(2_000) }, { maxLinkCopies: 0 });
    const ms = performance.now() - start;
    bench('2,000 parts each linking the next, settled', ms);
    expect(r.report.links.filter((l) => l.reason === 'limit')).toHaveLength(2_002);
    expect(ms).toBeLessThan(60_000);
  }, 120_000);
});

describe('what came in before comes in, whatever the new attempts cost', () => {
  /** The node kernel, but any rebuild with a mesh attachment throws. */
  const failingMeshes = (): ImportKernel => {
    const base = nodeImportKernel();
    return {
      ...base,
      rebuild: (doc, files, skip, reports) =>
        Object.values(doc.attachments ?? {}).some((a) => a.mediaType === 'model/stl')
          ? Promise.reject(new Error('the mesh kernel is out'))
          : base.rebuild(doc, files, skip, reports),
    };
  };

  it('a kernel that fails on every mesh and may not restart: the link and the compound still come in', async () => {
    const r = await importFcstd(
      structureFile('compound_touching', {
        extra: [meshObject('Scan'), linkObject('CLink', 'Compound', { placement: QUARTER_Z })],
        entries: { 'MeshKernel.bms': structureEntry('meshes', 'Mesh', 'MeshKernel.bms') },
      }),
      'x',
      { kernel: failingMeshes(), maxRestarts: 0 },
    );
    expect(r.report.compounds[0]).toMatchObject({ outcome: 'members' });
    expect(r.report.meshes[0]).toMatchObject({ outcome: 'left-out', reason: 'kernel' });
    // The kernel is gone after the mesh: the link comes in as S3 brought it, from the STEP made first.
    expect(r.report.links[0]).toMatchObject({ outcome: 'today', reason: 'kernel' });
    expect(r.report.shapes.map((s) => s.object)).toEqual(['CLink']);
    expect(r.report.leftOut.map((l) => l.object)).toEqual(['Scan']);
  });

  it('one mesh the kernel fails on ends the meshes: one restart, not one each', async () => {
    const r = await importFcstd(structureFile('meshes'), 'x', { kernel: failingMeshes() });
    expect(r.report.restarts).toBe(1);
    expect(
      r.report.meshes.map((m) => [m.reason, m.detail?.startsWith('the kernel failed on')]),
    ).toEqual([
      ['kernel', false],
      ['kernel', true],
      ['kernel', true],
    ]);
  });
});

describe('scale is judged first', () => {
  const scaleList = (values: readonly number[][]) => {
    const bytes = new Uint8Array(4 + 24 * values.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, values.length, true);
    for (const [i, v] of values.entries())
      for (const [k, x] of v.entries()) view.setFloat64(4 + 24 * i + 8 * k, x, true);
    return bytes;
  };
  const planOf = (
    extra: StructureExtraObject[],
    entries: Record<string, Uint8Array>,
    name: string,
  ) => {
    const doc = readFcstd(structureFile('link_chain', { extra, entries }));
    const s = finalShapes(doc).find((x) => x.object.name === name) as FinalShape;
    return planLink(doc, s);
  };

  it('a scaled array over the element cap, or with a list that lies, is scaled', () => {
    expect(
      planOf(
        [linkObject('Big', 'Box', { count: 5_000 })],
        { 'Big.ScaleList': scaleList([[2, 2, 2]]) },
        'Big',
      ),
    ).toMatchObject({ reason: 'scaled' });
    expect(
      planOf(
        [linkObject('Bad', 'Box', { count: 3 })],
        {
          'Bad.ScaleList': scaleList([
            [1, 1, 1],
            [1, 3, 1],
          ]),
          'Bad.PlacementList': new Uint8Array(7),
        },
        'Bad',
      ),
    ).toMatchObject({ reason: 'scaled' });
  });

  it('a link onto a scaled link is scaled, past an array on the way', () => {
    const scaled = (xml: string) => xml.replace('<Float value="1"/>', '<Float value="2"/>');
    expect(
      planOf(
        [
          linkObject('Inner', 'Box', { edit: scaled }),
          linkObject('Outer', 'Inner', { count: 5_000 }),
        ],
        {},
        'Outer',
      ),
    ).toMatchObject({ reason: 'scaled' });
  });
});

/** Bytes that don't compress (a zip of zeros would be refused for its ratio). */
const noise = (n: number) => {
  const out = new Uint8Array(n);
  let x = 2463534242;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
};

describe('bounds a hostile file could drive past', () => {
  it('the copies are one count for the import, MAX_LINK_COPIES by default', async () => {
    // 1,001 links onto one array of two that shows a sketch: nothing to copy, so no kernel work,
    // but every plan counts. The fixture's two links, the array and 998 links fill the 2,000.
    const sketch = {
      name: 'Sk',
      type: 'Sketcher::SketchObject',
      xml: '<Object name="Sk"><Properties Count="0" TransientCount="0"></Properties></Object>',
    };
    const links = Array.from({ length: 1_001 }, (_, i) =>
      linkObject(`L${i}`, 'A', { placement: IDENTITY }),
    );
    const r = await run('link_chain', {
      extra: [sketch, linkObject('A', 'Sk', { count: 2, placement: IDENTITY }), ...links],
      entries: {
        'A.PlacementList': placementListEntry([
          [0, 0, 0, 0, 0, 0, 1],
          [20, 0, 0, 0, 0, 0, 1],
        ]),
      },
    });
    const limited = r.report.links.filter((l) => l.reason === 'limit').map((l) => l.object);
    expect(limited).toEqual(['L998', 'L999', 'L1000']);
  }, 120_000);

  it('40,000 compounds on one member: each refused at the first outside user', () => {
    const objects: FcObject[] = [
      {
        name: 'Box',
        type: 'Part::Box',
        label: 'Box',
        extensions: [],
        expressions: [],
        properties: {},
      } as unknown as FcObject,
    ];
    for (let i = 0; i < 40_000; i++)
      objects.push({
        name: `C${i}`,
        type: 'Part::Compound',
        label: `C${i}`,
        extensions: [],
        expressions: [],
        properties: {
          Links: { name: 'Links', type: '', value: { kind: 'linkList', objects: ['Box'] } },
        },
      } as unknown as FcObject);
    const doc = {
      objects,
      byName: new Map(objects.map((o) => [o.name, o])),
      entries: new Map(),
      problems: [],
    } as unknown as FcDocument;
    const shapes = objects
      .slice(1)
      .map(
        (o) => ({ kind: 'shape', object: o, chain: [], visible: true }) as unknown as FinalShape,
      );
    const start = performance.now();
    const plans = planCompounds(doc, shapes, () => false);
    const ms = performance.now() - start;
    bench('40,000 compounds on one member planned', ms);
    expect(plans.every((p) => 'reason' in p && p.reason === 'shared')).toBe(true);
    expect(ms).toBeLessThan(3_000);
  });

  // It writes and reads a 33 MB entry: seconds on a loaded machine.
  it('an entry many objects name is read once, and one past the cap never', {
    timeout: 60_000,
  }, () => {
    const shapeXml = (name: string, file: string) =>
      `<Object name="${name}"><Properties Count="1" TransientCount="0"><Property name="Shape" type="Part::PropertyPartShape"><Part file="${file}"/></Property></Properties></Object>`;
    const extra = [
      ...Array.from({ length: 200 }, (_, i) => ({
        name: `F${i}`,
        type: 'Part::Feature',
        xml: shapeXml(`F${i}`, 'Box.Shape.brp'),
      })),
      { name: 'Huge', type: 'Part::Feature', xml: shapeXml('Huge', 'Huge.brp') },
    ];
    const doc = readFcstd(
      structureFile('compound_touching', {
        extra,
        entries: { 'Huge.brp': noise(33 * 1024 * 1024) },
      }),
    );
    const reads: string[] = [];
    const get = doc.entries.get.bind(doc.entries);
    (doc.entries as { get: typeof get }).get = (name: string) => {
      reads.push(name);
      return get(name);
    };
    const shapes = finalShapes(doc);
    expect(reads.filter((n) => n === 'Box.Shape.brp')).toHaveLength(1);
    expect(reads).not.toContain('Huge.brp');
    // Too large to scan is a shape as before: the shapes import leaves it out with its size.
    expect(shapes.map((s) => s.object.name)).toContain('Huge');
  });

  it('meshes: one read an entry, the import’s facets counted together', async () => {
    const doc = readFcstd(
      structureFile('meshes', {
        extra: Array.from({ length: 20 }, (_, i) => meshObject(`Copy${i}`)),
      }),
    );
    const reads: string[] = [];
    const get = doc.entries.get.bind(doc.entries);
    (doc.entries as { get: typeof get }).get = (name: string) => {
      reads.push(name);
      return get(name);
    };
    const design = Design.create({ name: 'x', units: 'mm' });
    const budget = new KernelBudget(kernel);
    const out = await importMeshes(
      doc,
      finalShapes(doc),
      design,
      new StructureBuild(design, budget, new Map()),
      budget,
      {
        maxImportFacets: 12 * 3,
      },
    );
    expect(reads.filter((n) => n === 'MeshKernel.bms')).toHaveLength(1);
    // The cube is 12 facets: three cubes in, then the import's facets are spent.
    expect(out.filter((m) => m.outcome === 'in').map((m) => m.object)).toEqual([
      'Mesh',
      'Copy0',
      'Copy1',
    ]);
    expect(out.filter((m) => m.reason === 'limit')).toHaveLength(20);
  });

  it('the facet cap a test sets through importFcstd is the one the meshes read', async () => {
    const r = await run('meshes', {}, { maxMeshFacets: 100 });
    expect(r.report.meshes.map((m) => m.reason ?? 'in')).toEqual(['in', 'too-large', 'too-large']);
  });
});

describe('the report', () => {
  it('a link array left out is not one that "came in as one copy"', async () => {
    const scales = new Uint8Array(4 + 24 * 3);
    const view = new DataView(scales.buffer);
    view.setUint32(0, 3, true);
    for (let i = 0; i < 9; i++) view.setFloat64(4 + 8 * i, 2, true);
    const r = await run('link_array', {
      files: (o, f, b) => (o === 'Link' && f === 'ScaleList' ? scales : b),
    });
    expect(r.report.links[0]).toMatchObject({
      object: 'Link',
      outcome: 'left-out',
      reason: 'scaled',
    });
    expect(r.report.linkArrays).toEqual([]);
  });
});

describe('the bytes held for what may still fall back', () => {
  const scan = () => ({
    extra: [meshObject('Scan')],
    entries: { 'MeshKernel.bms': structureEntry('meshes', 'Mesh', 'MeshKernel.bms') },
  });

  it('a mesh that would pass the design’s limit beside the links’ held STEP is left out; the links come in', async () => {
    // No copy is made: both links come in as S3 brought them. Everything together is `all` bytes.
    const free = await run('link_chain', scan(), { maxLinkCopies: 0 });
    const all = attachmentBytes(free.design);
    const cap = all - 1;
    const r = await run('link_chain', scan(), { maxLinkCopies: 0, maxAttachmentsBytes: cap });
    expect(r.report.meshes[0]).toMatchObject({ object: 'Scan', reason: 'design-full' });
    expect(r.report.shapes.map((s) => s.object)).toEqual(['Link', 'Link001']);
    expect(attachmentBytes(r.design)).toBeLessThanOrEqual(cap);
  });

  it('a compound whose members come in no longer holds its own STEP', async () => {
    // The members are trees (no attachment): once the compounds came in so, only the mesh is stored.
    const free = await run('compound_top', scan());
    const cap = attachmentBytes(free.design);
    const r = await run('compound_top', scan(), { maxAttachmentsBytes: cap });
    expect(r.report.compounds.map((c) => c.outcome)).toEqual(['members', 'members', 'members']);
    expect(r.report.meshes[0]).toMatchObject({ outcome: 'in' });
    expect(attachmentBytes(r.design)).toBeLessThanOrEqual(cap);
  });

  it('a compound whose members wouldn’t fit beside what is held comes in as before', async () => {
    // The box is a plain shape here, so it needs a STEP of its own; the cap is the compounds' own STEP.
    const edit: StructureFileOptions = { types: { Box: 'Part::Feature' } };
    const before = await run('compound_top', edit, { maxCompoundObjects: 0 });
    const cap = attachmentBytes(before.design);
    const r = await run('compound_top', edit, { maxAttachmentsBytes: cap });
    expect(r.report.compounds[0]).toMatchObject({ object: 'Compound', outcome: 'today' });
    expect(r.report.shapes.map((s) => s.object)).toContain('Compound');
    expect(attachmentBytes(r.design)).toBeLessThanOrEqual(cap);
  });
});

describe('a part reached twice, and the bounds of a walk through parts', () => {
  const at = (x: number, y = 0) => ({ position: [x, y, 0], rotation: [0, 0, 0, 1] });
  /** Two wheels of one kind on a car, the car linked once more. */
  const car = () => [
    partObject('Car', ['WL', 'WR']),
    linkObject('WL', 'Part', { placement: at(100) }),
    linkObject('WR', 'Part', { placement: at(150) }),
    linkObject('Car2', 'Car', { placement: at(0, 100) }),
  ];
  const boxOfLink = (
    m: Awaited<ReturnType<typeof measured>>,
    r: Awaited<ReturnType<typeof run>>,
    o: string,
  ) => {
    const ids = r.report.links.find((l) => l.object === o)?.bodies ?? [];
    const ms = ids.map((id) => m.bodies[id]);
    const min = [0, 1, 2].map((i) => Math.min(...ms.map((x) => x?.box.min[i] ?? Infinity)));
    const max = [0, 1, 2].map((i) => Math.max(...ms.map((x) => x?.box.max[i] ?? -Infinity)));
    return [...min, ...max];
  };

  it('two links in a car to one wheel part and the car linked once more: every copy where FreeCAD puts it', async () => {
    const r = await run('link_to_part', { extra: car() });
    const of = (o: string) => r.report.links.find((l) => l.object === o);
    for (const o of ['WL', 'WR', 'Car2'])
      expect(of(o)).toMatchObject({ outcome: 'copy', part: true });
    const m = await measured(r);
    // The wheel part (a 20 × 20 × 5 box and a cylinder up to 20) at 100 and 150 along X, the car 100 along Y.
    close(boxOfLink(m, r, 'WL'), [100, 0, 0, 120, 20, 20]);
    close(boxOfLink(m, r, 'WR'), [150, 0, 0, 170, 20, 20]);
    close(boxOfLink(m, r, 'Car2'), [100, 100, 0, 170, 120, 20]);
    expect(of('Car2')?.bodies).toHaveLength(4);
  });

  it('a part that holds a link back to itself is still refused with the cycle’s words', async () => {
    const r = await run('link_to_part', {
      edit: (o, xml) =>
        o === 'Part'
          ? xml.replace('<LinkList count="2">', '<LinkList count="3"><Link value="Link"/>')
          : xml,
    });
    expect(r.report.links[0]).toMatchObject({
      outcome: 'today',
      reason: 'cycle',
      detail: 'a part that holds a link back to itself',
    });
  });

  it('S13: each distinct part and turn counts once toward the import’s shapes, however often it is reached', async () => {
    // The fixture's own link (turned a quarter) walks the wheel part's 2 shapes; WL walks them
    // unturned and WR reuses that; Car2 walks the car's 2 links and reuses the unturned wheel.
    // 6 in all (every way down counted, it would be 2 + 2 + 2 + 2 + 4 = 12).
    const all = await run('link_to_part', { extra: car() }, { maxPartMembers: 6 });
    for (const o of ['WL', 'WR', 'Car2'])
      expect(all.report.links.find((l) => l.object === o)?.outcome).toBe('copy');
    // One fewer and the car, the only part not walked yet, is past it.
    const r = await run('link_to_part', { extra: car() }, { maxPartMembers: 5 });
    for (const o of ['WL', 'WR'])
      expect(r.report.links.find((l) => l.object === o)?.outcome).toBe('copy');
    expect(r.report.links.find((l) => l.object === 'Car2')).toMatchObject({
      outcome: 'today',
      reason: 'limit',
    });
  });

  it('S13: a hundred links to one part measure its shapes once, not once a link', async () => {
    const measuresWith = async (links: number) => {
      let measures = 0;
      const counted = {
        ...kernel,
        measureStoredShape: (...a: Parameters<typeof kernel.measureStoredShape>) => {
          measures++;
          return kernel.measureStoredShape(...a);
        },
      };
      const extra = Array.from({ length: links }, (_, i) =>
        linkObject(`W${i}`, 'Part', { placement: at(100 + 30 * i) }),
      );
      // The fixture's link, turned a quarter, walks the part once; the unturned links once.
      const r = await run('link_to_part', { extra }, { kernel: counted, maxPartMembers: 4 });
      expect(r.report.links.filter((l) => l.outcome === 'copy')).toHaveLength(links + 1);
      return { measures, r };
    };
    const one = await measuresWith(1);
    const { measures, r } = await measuresWith(100);
    expect(measures).toBe(one.measures);
    const m = await measured(r);
    close(boxOfLink(m, r, 'W99'), [100 + 30 * 99, 0, 0, 120 + 30 * 99, 20, 20]);
  }, 120_000);

  it('S13: the bodies all copies make are one count for the import (MAX_COPIED_BODIES)', async () => {
    // Each link to the part copies its two bodies; a count of 7 takes three links, not a fourth.
    const extra = Array.from({ length: 5 }, (_, i) =>
      linkObject(`W${i}`, 'Part', { placement: at(100 + 30 * i) }),
    );
    const r = await run('link_to_part', { extra }, { maxCopiedBodies: 7 });
    const outcomes = r.report.links.map((l) => [l.outcome, l.reason ?? '']);
    expect(outcomes.filter(([o]) => o === 'copy')).toHaveLength(3);
    expect(r.report.links.at(-1)).toMatchObject({ outcome: 'today', reason: 'limit' });
    expect(r.report.links.at(-1)?.detail).toMatch(/at most 7/);
  });

  it('S13: a link to a part that holds a mesh copies the mesh body and the box, checked', async () => {
    const r = await run('mesh_in_part', {
      extra: [linkObject('PartLink', 'Part', { placement: at(0, 200) })],
    });
    expect(r.report.meshes[0]?.outcome).toBe('in');
    const l = r.report.links.find((x) => x.object === 'PartLink');
    expect(l).toMatchObject({ outcome: 'copy', part: true });
    // The mesh body's copy and the box's: the check measured the mesh from its facts.
    expect(l?.bodies).toHaveLength(2);
    expect(r.report.shapes.map((x) => x.object)).not.toContain('PartLink');
  });

  it('S13: a link to a part holding a link to a mesh copies the mesh', async () => {
    const r = await run('mesh_in_part', {
      extra: [
        partObject('Holder', ['MeshLink']),
        linkObject('MeshLink', 'Mesh', { placement: at(0, 300) }),
        linkObject('HolderLink', 'Holder', { placement: at(0, 400) }),
      ],
    });
    expect(r.report.links.find((x) => x.object === 'MeshLink')).toMatchObject({ outcome: 'copy' });
    expect(r.report.links.find((x) => x.object === 'HolderLink')).toMatchObject({
      outcome: 'copy',
      part: true,
    });
  });

  it('a diamond of parts 24 deep (2²⁴ ways down) is refused by the bounds in a bounded time', async () => {
    const n = 24;
    const extra: StructureExtraObject[] = [linkObject('X', 'D0', { placement: IDENTITY })];
    for (let i = 0; i < n; i++)
      extra.push(
        partObject(`D${i}`, [`A${i}`, `B${i}`]),
        linkObject(`A${i}`, `D${i + 1}`, { placement: at(0, 30) }),
        linkObject(`B${i}`, `D${i + 1}`, { placement: at(30, 0) }),
      );
    extra.push(partObject(`D${n}`, ['Box']));
    const start = performance.now();
    const r = await run('link_chain', { extra });
    const ms = performance.now() - start;
    bench('a diamond of parts 24 deep', ms);
    expect(r.report.links.find((l) => l.object === 'X')?.outcome).toBe('today');
    // The deepest copies came in until a copy would take more than 256 bodies.
    expect(r.report.links.some((l) => l.reason === 'limit')).toBe(true);
    expect(ms).toBeLessThan(120_000);
  }, 240_000);

  it('a chain of 30 parts each linking the next: every copy made and checked', async () => {
    const n = 30;
    const extra: StructureExtraObject[] = [
      ...Array.from({ length: n }, (_, i) => partObject(`P${i}`, [`L${i}`])),
      partObject(`P${n}`, ['Box']),
      ...Array.from({ length: n }, (_, i) =>
        linkObject(`L${i}`, `P${i + 1}`, { placement: at(0, 20) }),
      ),
    ];
    const start = performance.now();
    const r = await run('link_chain', { extra });
    bench('a chain of 30 parts with copies', performance.now() - start);
    const chain = r.report.links.filter((l) => /^L\d+$/.test(l.object));
    expect(chain.map((l) => l.outcome)).toEqual(Array(n).fill('copy'));
    // L0 shows the box 20 along Y for every part on the way: 30 × 20.
    const m = await measured(r);
    const l0 = m.bodies[chain.find((l) => l.object === 'L0')?.bodies[0] as string];
    expect(l0?.box.min[1]).toBeCloseTo(600, 6);
  }, 240_000);
});

describe('progress and problems of a compound’s members', () => {
  it('progress never goes back nor past its total', async () => {
    for (const bytes of [structureFile('compound_top'), partFile('compounds')]) {
      const seen: [number, number][] = [];
      await importFcstd(bytes, 'x', {
        kernel,
        solver: new SketchSolver(planegcs),
        onProgress: (done, total) => seen.push([done, total]),
      });
      for (const [i, [done, total]] of seen.entries()) {
        expect(done).toBeLessThanOrEqual(total);
        if (i > 0) expect(done).toBeGreaterThanOrEqual((seen[i - 1] as [number, number])[0]);
      }
    }
  });

  it('a compound that comes in as before names no problem of what it tried', async () => {
    // The cut's stored shape is gone: the compound comes in as its own shape, the cut with it.
    const edit: StructureFileOptions = { brep: (o, t) => (o === 'Cut' ? undefined : t) };
    const r = await run('compound_top', edit);
    expect(r.report.compounds[1]).toMatchObject({ object: 'Compound001', outcome: 'today' });
    const before = await run('compound_top', edit, { maxCompoundObjects: 0 });
    expect(r.report.problems).toEqual(before.report.problems);
  });
});

describe('a mesh past the import’s facets', () => {
  it('is refused from its header’s count, never read whole', async () => {
    const doc = readFcstd(structureFile('meshes'));
    const reads: string[] = [];
    const get = doc.entries.get.bind(doc.entries);
    (doc.entries as { get: typeof get }).get = (name: string) => {
      reads.push(name);
      return get(name);
    };
    const design = Design.create({ name: 'x', units: 'mm' });
    const budget = new KernelBudget(kernel);
    const out = await importMeshes(
      doc,
      finalShapes(doc),
      design,
      new StructureBuild(design, budget, new Map()),
      budget,
      { maxImportFacets: 12 },
    );
    expect(out.map((m) => m.reason ?? 'in')).toEqual(['in', 'limit', 'limit']);
    expect(reads).toEqual(['MeshKernel.bms']);
  });
});
