/**
 * What an honest kernel says that the importer can't use because of a limit
 * of its own (ADR-0144's S6 amendment, review of 2026-11-12): a clean stop of
 * that body (`edges`, `limit` or `reference`), never a kernel failure and
 * never a restart. And the persistent names of real bodies, of every shape
 * the kernel's builders make, pass the reference check, which reads the same
 * features from them as the kernel's own `featuresOfName`.
 */
import { Design } from '@extrudo/api';
import type { GeomRef } from '@extrudo/core';
import { featuresOfName } from '@extrudo/kernel';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { DRESSUP_CASES, type DressUpFixtureFeature, dressUpSpec } from './dressup-fixtures';
import { type BodySpec, historyFile, rectangle } from './history-fixtures';
import { importFcstd } from './import';
import type { ImportKernel, ShapeElements } from './import-kernel';
import {
  checkName,
  checkReference,
  MAX_FINGERPRINT_ADJ,
  MAX_NAME_DEPTH,
  MAX_REFERENCE_ID_LENGTH,
} from './match';
import { nodeImportKernel } from './node-kernel-test-support';

let planegcs: PlanegcsModule;
let base: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  base = nodeImportKernel();
});

const [PAD, FILLET] = DRESSUP_CASES.fillet_one_edge as [
  DressUpFixtureFeature,
  DressUpFixtureFeature,
];
const filletBody = (): BodySpec => ({
  name: 'Body',
  label: 'Part',
  sketches: [{ name: 'Sketch', geometry: rectangle(0, 0, 10, 20) }],
  features: [{ name: 'Pad', type: 'Pad', length: 30, stored: PAD.stored }, dressUpSpec(FILLET)],
});

/** The node kernel with one call's answer changed. */
function changed(change: Partial<ImportKernel>): ImportKernel {
  return {
    storedShapeToStep: (...a) => base.storedShapeToStep(...a),
    measureStoredShape: (...a) => base.measureStoredShape(...a),
    rebuild: (...a) => base.rebuild(...a),
    describeStoredShape: (...a) => base.describeStoredShape(...a),
    describeBodies: (...a) => base.describeBodies(...a),
    references: (i) => base.references(i),
    restart: () => base.restart(),
    ...change,
  };
}

async function run(kernel: ImportKernel) {
  const before = base.restarts;
  const r = await importFcstd(historyFile([filletBody()]), 'Limits', {
    kernel,
    solver: new SketchSolver(planegcs),
  });
  return { body: r.report.bodies[0], restarts: base.restarts - before, design: r.design };
}

/** An answer at a cap, as the kernel gives it: the counts, how many and which cap. */
const atCap = (
  d: ShapeElements,
  limit: 'edges' | 'faces' | 'detail' | 'adjacent',
  over: number,
) => ({
  edgeCount: d.edgeCount,
  faceCount: d.faceCount,
  edges: [],
  faces: [],
  over,
  limit,
});

describe("a kernel's caps are clean stops, with no restart", () => {
  it.each([
    ['detail', 2_001, /needs 2001 edges looked at closely/],
    ['edges', 20_001, /has 20001 edges/],
    ['faces', 20_001, /has 20001 faces/],
    ['adjacent', 20_001, /with 20001 neighbours/],
  ] as const)('the stored side at its %s cap stops with `edges`', async (limit, n, detail) => {
    const { body, restarts } = await run(
      changed({
        describeStoredShape: async (...a) => atCap(await base.describeStoredShape(...a), limit, n),
      }),
    );
    expect(body?.stop).toMatchObject({ object: 'Fillet', reason: 'edges' });
    expect(body?.stop?.detail).toMatch(detail);
    expect(restarts).toBe(0);
  });

  it.each([
    ['detail', 2_001],
    ['edges', 20_001],
  ] as const)('the rebuilt side at its %s cap stops with `limit`', async (limit, n) => {
    const { body, restarts } = await run(
      changed({
        describeBodies: async (...a) =>
          Object.fromEntries(
            Object.entries(await base.describeBodies(...a)).map(([k, v]) => [
              k,
              atCap(v, limit, n),
            ]),
          ),
      }),
    );
    expect(body?.stop).toMatchObject({ object: 'Fillet', reason: 'limit' });
    expect(body?.stop?.detail).toMatch(String(n));
    expect(restarts).toBe(0);
  });

  const longName = (r: GeomRef) => {
    // Well formed: the real name's faces, the last nested once more until the name is over the cap.
    let id = r.id;
    while (id.length <= MAX_REFERENCE_ID_LENGTH)
      id = id.replace(/\]$/, `|fillet:${'x'.repeat(50)}:from:_]`);
    return id;
  };
  it('a well-formed reference longer than the cap stops with `reference`', async () => {
    const { body, restarts } = await run(
      changed({
        references: async (i) =>
          (await base.references(i)).map((r) => r && { ...r, id: longName(r) }),
      }),
    );
    expect(body?.stop).toMatchObject({ object: 'Fillet', reason: 'reference' });
    expect(body?.stop?.detail).toMatch(/characters, more than 4000/);
    expect(restarts).toBe(0);
  });

  it('a well-formed reference nested past the cap stops with `reference`', async () => {
    const deep = (r: GeomRef) => {
      let face = 'extrude:F:cap:end';
      for (let i = 0; i <= MAX_NAME_DEPTH; i++) face = `fillet:F:from:(e[${face}])`;
      return r.id.replace(/\]$/, `|${face}]`);
    };
    const { body, restarts } = await run(
      changed({
        references: async (i) => (await base.references(i)).map((r) => r && { ...r, id: deep(r) }),
      }),
    );
    expect(body?.stop).toMatchObject({ reason: 'reference' });
    expect(body?.stop?.detail).toMatch(/nests deeper than 32/);
    expect(restarts).toBe(0);
  });

  it('a fingerprint with many neighbours is cut to its cap, the ones that are no names dropped', async () => {
    const { body, restarts, design } = await run(
      changed({
        references: async (i) =>
          (await base.references(i)).map((r) => {
            if (!r) return r;
            const face = r.id.slice(2, r.id.indexOf('|'));
            const adj = ['not a name!', ...Array.from({ length: 100 }, () => face)];
            return {
              ...r,
              fingerprint: { ...(r.fingerprint as NonNullable<GeomRef['fingerprint']>), adj },
            };
          }),
      }),
    );
    expect(body?.outcome).toBe('history');
    expect(restarts).toBe(0);
    const fillet = design.doc.features.find((f) => f.type === 'fillet');
    const edges = fillet?.inputs.edges;
    const adj = edges?.kind === 'ref' ? edges.refs[0]?.fingerprint?.adj : undefined;
    expect(adj).toHaveLength(MAX_FINGERPRINT_ADJ);
    expect(adj).not.toContain('not a name!');
  });
});

describe('the reference check and the kernel read the same names', () => {
  it('takes every face and edge reference of real bodies, with the features the kernel reads', async () => {
    const d = Design.create({ name: 'Names' });
    // A plate with a hole and 65 small holes on one side of the split (its top face has more than 64 neighbours).
    const s = d.sketch(d.origin.xy, (k) => {
      k.rectangle([-40, -20], [40, 20]);
      k.circle([-30, 0], '4 mm');
      for (let i = 0; i < 65; i++)
        k.circle([3 + (i % 13) * 2.5, -9 + Math.floor(i / 13) * 3], '1 mm');
    });
    const plate = d.extrude({ profiles: [s.profileAt([0, 18])], distance: '6 mm' });
    const body = `${plate.id}:0`;
    // A split (cut faces with a side), a pattern of the result (copied names), then rounds (nested names).
    d.splitBody({ bodies: [d.ref('body', body)], plane: d.origin.yz });
    d.rectangularPattern({
      objects: 'bodies',
      bodies: [d.ref('body', body)],
      direction1: d.origin.y,
      count1: 2,
      distance1: '60 mm',
    });
    const kernel = base;
    const forms = new Set<string>();
    let checked = 0;
    let adjCut = 0;
    const doc = d.toJSON();
    const sent = new Set(doc.features.map((f) => f.id as string));
    const rebuilt = await kernel.rebuild(doc, new Map());
    expect(rebuilt.failed).toEqual([]);
    const described = await kernel.describeBodies(rebuilt.ids, { points: [], radius: 1 });
    // A fillet on one edge of each body, then everything again: names nested in sources.
    for (const id of rebuilt.ids) {
      const edges = described[id]?.edges ?? [];
      const longest = [...edges].sort((a, b) => b.length - a.length)[0];
      if (!longest) continue;
      const [ref] = await kernel.references([{ body: id, kind: 'edge', index: longest.index }]);
      if (ref) d.fillet({ edges: [ref], radius: '0.5 mm' });
    }
    const doc2 = d.toJSON();
    for (const f of doc2.features) sent.add(f.id as string);
    const again = await kernel.rebuild(doc2, new Map());
    expect(again.failed).toEqual([]);
    const all = await kernel.describeBodies(again.ids, { points: [], radius: 1 });
    for (const id of again.ids) {
      const dd = all[id] as ShapeElements;
      const items = [
        ...dd.edges.map((e) => ({ body: id, kind: 'edge' as const, index: e.index })),
        ...dd.faces.map((f) => ({ body: id, kind: 'face' as const, index: f.index })),
      ];
      const refs = await kernel.references(items);
      refs.forEach((r, i) => {
        if (!r) throw new Error('no reference');
        const kind = (items[i] as { kind: 'edge' | 'face' }).kind;
        const c = checkReference(r, kind, sent, sent);
        if (!c.ok) throw new Error(`refused ${r.id}`);
        checked++;
        if ((r.fingerprint?.adj?.length ?? 0) > MAX_FINGERPRINT_ADJ) {
          adjCut++;
          expect(c.ref.fingerprint?.adj).toHaveLength(MAX_FINGERPRINT_ADJ);
        }
        const name = checkName(r.id);
        expect(name.ok && [...name.features].sort()).toEqual(
          [...new Set(featuresOfName(r.id))].sort(),
        );
        // The forms seen, for the record.
        if (/:\(/.test(r.id)) forms.add('parenthesised source');
        if (/:\((?![ev]\[)[^()]*\/[^()]*\)/.test(r.id)) forms.add('source that is not a name');
        if (/:cap:(start|end)/.test(r.id)) forms.add('role with a colon');
        if (/:\([ev]\[/.test(r.id)) forms.add('nested name');
        if (/#\d/.test(r.id)) forms.add('split');
        if (/@\d/.test(r.id)) forms.add('@n');
        if (/^split:|[[|]split:/.test(r.id)) forms.add('split cut face');
      });
    }
    console.log('names checked', checked, 'forms', [...forms].join(', '), 'adj cut', adjCut);
    expect(checked).toBeGreaterThan(300);
    expect(adjCut).toBeGreaterThan(0);
    expect(forms).toContain('role with a colon');
    expect(forms).toContain('nested name');
    expect(forms).toContain('split cut face');
  }, 120_000);

  it('reads a split tail from its end in linear time', () => {
    // The worst case of a backtracking `(#\d+)+$`: many splits and then not one.
    const tail = '#1'.repeat((MAX_REFERENCE_ID_LENGTH - 20) / 2);
    const names = [`extrude:F:side${tail}x`, `extrude:F:side${tail}`, `e[extrude:F:side${tail}x]`];
    for (const n of names) {
      const t = performance.now();
      for (let i = 0; i < 100; i++) checkName(n);
      expect((performance.now() - t) / 100).toBeLessThan(1);
    }
    expect(checkName(`extrude:F:side${tail}`).ok).toBe(true);
  });

  it('accepts what the builders make and nothing outside their characters', () => {
    const ok = [
      'extrude:F:cap:start',
      'extrude:F:side:(S/c1)',
      'emboss:F:clip:2',
      'extrude:F:side:(S/c1)#2#1',
      'fillet:G:from:(e[extrude:F:cap:end|extrude:F:side:(S/c1)])',
      'e[extrude:F:cap:end|split:H:cut:above]@2',
      'shell:F:inner:(extrude:G:side:l3)',
    ];
    for (const n of ok) expect(checkName(n).ok, n).toBe(true);
    expect(
      [...(checkName(ok[4] as string) as unknown as { features: Set<string> }).features].sort(),
    ).toEqual(['F', 'G']);
    for (const n of [
      'extrude:F',
      'e[]',
      'e[a:b:c]@x',
      'extrude:F:cap end',
      'extrude:F:(x',
      'extrude:F:cap:<b>',
      'e[extrude:F:a|e[x:y:z]]',
    ])
      expect(checkName(n).ok, n).toBe(false);
  });
});
