/**
 * The loose chains as a pure function of the file (P6-25 S12a, ADR-0144): what a feature's base
 * is, tips, roots, branches, cycles and every limit that needs no kernel.
 */
import { describe, expect, it } from 'vitest';
import { asOldFile, chainFile } from './chain-parts';
import { type FinalShape, finalShapes } from './final-shapes';
import { type LooseChain, looseChains } from './loose-chains';
import { type FcDocument, type FcObject, type FcValue, readFcstd } from './model';

const LIMITS = { maxFeatures: 500, maxFile: 2_000 };

type Props = Readonly<Record<string, FcValue>>;

const object = (name: string, type: string, props: Props = {}): FcObject =>
  ({
    name,
    type,
    label: name,
    extensions: [],
    expressions: [],
    properties: Object.fromEntries(
      Object.entries(props).map(([k, value]) => [k, { name: k, type: '', value }]),
    ),
  }) as unknown as FcObject;

const doc = (objects: readonly FcObject[]): FcDocument =>
  ({
    objects,
    byName: new Map(objects.map((o) => [o.name, o])),
    entries: new Map(),
    problems: [],
  }) as unknown as FcDocument;

const tip = (o: FcObject) => ({ kind: 'chain-tip', object: o }) as unknown as FinalShape;
const link = (name: string): FcValue => ({ kind: 'link', object: name }) as FcValue;
const pad = (name: string, base?: string) =>
  object(name, 'PartDesign::Pad', base ? { BaseFeature: link(base) } : {});

const plan = (
  objects: readonly FcObject[],
  tips: readonly string[],
  limits: { maxFeatures: number; maxFile: number; maxChains?: number } = LIMITS,
) => {
  const d = doc(objects);
  return looseChains(
    d,
    tips.map((t) => tip(d.byName.get(t) as FcObject)),
    limits,
  );
};
const names = (c: LooseChain | undefined) => c?.features.map((f) => f.name);

describe('what a loose feature builds on', () => {
  it('follows BaseFeature, root first', () => {
    const [c] = plan([pad('A'), pad('B', 'A'), pad('C', 'B')], ['C']);
    expect(names(c)).toEqual(['A', 'B', 'C']);
    expect(c?.rules).toEqual(['none', 'base-feature', 'base-feature']);
    expect(c?.foreignBase).toBeUndefined();
  });

  it('reads a dress-up’s Base and a pattern’s first original', () => {
    const fillet = object('F', 'PartDesign::Fillet', {
      Base: { kind: 'linkSub', object: 'A', subs: [{ name: 'Edge1' }] } as FcValue,
    });
    const pattern = object('P', 'PartDesign::LinearPattern', {
      Originals: { kind: 'linkList', objects: ['F', 'A'] } as FcValue,
    });
    const [c] = plan([pad('A'), fillet, pattern], ['P']);
    expect(names(c)).toEqual(['A', 'F', 'P']);
    expect(c?.rules).toEqual(['none', 'dress-up', 'original']);
  });

  it('reads a sketch’s support only when the object there holds a solid', () => {
    const sketch = object('S', 'Sketcher::SketchObject', {
      Support: { kind: 'linkSub', object: 'A', subs: [{ name: 'Face1' }] } as FcValue,
    });
    const pocket = object('K', 'PartDesign::Pocket', { Sketch: link('S') });
    // No stored shape in this document, so the support gives no base: a new solid.
    const [c] = plan([pad('A'), sketch, pocket], ['K']);
    expect(names(c)).toEqual(['K']);
    expect(c?.rules).toEqual(['none']);
    // The fixtures' old form says it through the support alone, and those hold solids.
    const old = readFcstd(asOldFile('pad_pocket', '0.14'));
    const shapes = finalShapes(old).filter((s) => s.kind === 'chain-tip');
    const [fromFile] = looseChains(old, shapes, LIMITS);
    expect(names(fromFile)).toEqual(['Pad', 'Pocket']);
    expect(fromFile?.rules).toEqual(['none', 'support']);
  });

  it('prefers BaseFeature where the sketch’s support says otherwise, and counts it', () => {
    const d = readFcstd(
      chainFile('chain_five', {
        edit: (name, xml) => (name === 'Sketch003' ? xml.replace('obj="Boss"', 'obj="Pad"') : xml),
      }),
    );
    const [c] = looseChains(
      d,
      finalShapes(d).filter((s) => s.kind === 'chain-tip'),
      LIMITS,
    );
    expect(names(c)).toEqual(['Pad', 'Hole', 'Boss', 'Recess', 'Lug']);
    expect(c?.conflicts).toBe(1);
  });

  it('stops at a base that is no loose feature', () => {
    const [c] = plan([object('Box', 'Part::Box'), pad('A', 'Box'), pad('B', 'A')], ['B']);
    expect(names(c)).toEqual(['A', 'B']);
    expect(c?.foreignBase?.name).toBe('Box');
  });

  it('takes a feature of a body, or a body, as a foreign base', () => {
    const body = object('Body', 'PartDesign::Body', {
      Group: { kind: 'linkList', objects: ['In'] } as FcValue,
    });
    const [a, b] = plan([body, pad('In'), pad('X', 'In'), pad('Y', 'Body')], ['X', 'Y']);
    expect(a?.foreignBase?.name).toBe('In');
    expect(b?.foreignBase?.name).toBe('Body');
  });

  it('gives each tip of a branch its own copy of what they share', () => {
    const [a, b] = plan([pad('A'), pad('B', 'A'), pad('C', 'A')], ['B', 'C']);
    expect(names(a)).toEqual(['A', 'B']);
    expect(names(b)).toEqual(['A', 'C']);
  });
});

describe('links a file can get wrong', () => {
  const refused = (c: LooseChain | undefined) => [c?.refused?.reason, c?.features.length];

  it.each([
    ['two features on each other', [pad('A', 'B'), pad('B', 'A')], 'A'],
    ['a feature on itself', [pad('A', 'A')], 'A'],
    [
      'a pattern that is its own original',
      [
        object('A', 'PartDesign::Mirrored', {
          Originals: { kind: 'linkList', objects: ['A'] } as FcValue,
        }),
      ],
      'A',
    ],
  ] as const)('%s comes in as today', (_, objects, name) => {
    expect(refused(plan(objects, [name])[0])).toEqual(['chain', 0]);
  });

  it.each([
    ['not in the file', []],
    ['a sketch', [object('T', 'Sketcher::SketchObject')]],
    ['a sheet', [object('T', 'Spreadsheet::Sheet')]],
    ['a container', [object('T', 'App::Part')]],
  ] as const)('a base that is %s comes in as today', (_, others) => {
    const [c] = plan([pad('A', 'T'), ...others], ['A']);
    expect(c?.refused?.reason).toBe('chain');
    expect(c?.refused?.detail).toMatch(/T/);
  });

  it('a pattern’s first original that is no shape comes in as today', () => {
    const p = object('P', 'PartDesign::LinearPattern', {
      Originals: { kind: 'linkList', objects: ['S'] } as FcValue,
    });
    const [c] = plan([p, object('S', 'Sketcher::SketchObject')], ['P']);
    expect(c?.refused?.reason).toBe('chain');
  });

  it('empty Originals and a feature with no sketch start a new solid, for the walk to refuse', () => {
    const p = object('P', 'PartDesign::LinearPattern', {
      Originals: { kind: 'linkList', objects: [] } as FcValue,
    });
    expect(names(plan([p, pad('Q')], ['P'])[0])).toEqual(['P']);
    expect(names(plan([p, pad('Q')], ['Q'])[0])).toEqual(['Q']);
  });

  it('a support on an object that isn’t in the file gives no base', () => {
    const sketch = object('S', 'Sketcher::SketchObject', {
      Support: { kind: 'linkSub', object: 'Gone', subs: [{ name: 'Face1' }] } as FcValue,
    });
    const k = object('K', 'PartDesign::Pocket', { Sketch: link('S') });
    expect(plan([sketch, k], ['K'])[0]?.rules).toEqual(['none']);
  });
});

describe('a pattern of several originals', () => {
  const pattern = (name: string, originals: string[]) =>
    object(name, 'PartDesign::LinearPattern', {
      Originals: { kind: 'linkList', objects: originals } as FcValue,
    });

  it('builds on the original no other original builds on', () => {
    const [c] = plan(
      [pad('A'), pad('B', 'A'), pad('C', 'B'), pattern('P', ['A', 'C', 'B'])],
      ['P'],
    );
    expect(names(c)).toEqual(['A', 'B', 'C', 'P']);
    expect(c?.rules.at(-1)).toBe('original');
  });

  it('takes the first when the originals aren’t in one row', () => {
    const [c] = plan([pad('A'), pad('B'), pattern('P', ['B', 'A'])], ['P']);
    expect(names(c)).toEqual(['B', 'P']);
  });

  it('originals that lead back to each other: the first, without recursion', () => {
    const [c] = plan([pad('A', 'B'), pad('B', 'A'), pattern('P', ['A', 'B'])], ['P']);
    expect(c?.refused?.reason).toBe('chain');
  });

  it('a row of patterns, each of two originals, is read without recursion', () => {
    const n = 20_000;
    const objects = [pad('P0'), pad('Q0', 'P0')];
    for (let i = 1; i < n; i++) objects.push(pattern(`P${i}`, [`P${i - 1}`, `Q${i - 1}`]));
    for (let i = 1; i < n; i++) objects.push(pad(`Q${i}`, `P${i}`));
    expect(() => plan(objects, [`P${n - 1}`], { maxFeatures: 500, maxFile: 2_000 })).not.toThrow();
  });
});

describe('what a hostile file can make the plan read', () => {
  const shapeObject = (name: string, entry: string) =>
    object(name, 'Part::Feature', { Shape: { kind: 'shape', entry } as FcValue });
  const onSupport = (i: number, support: FcValue) => [
    object(`S${i}`, 'Sketcher::SketchObject', { Support: support }),
    object(`K${i}`, 'PartDesign::Pocket', { Sketch: link(`S${i}`) }),
  ];
  const supportOn = (name: string) =>
    ({ kind: 'linkSub', object: name, subs: [{ name: 'Face1' }] }) as FcValue;
  const docWith = (objects: FcObject[], entries: FcDocument['entries']) =>
    ({ ...doc(objects), entries }) as FcDocument;
  const tips = (d: FcDocument, n: number) =>
    Array.from({ length: n }, (_, i) => tip(d.byName.get(`K${i}`) as FcObject));
  const SOLID = new TextEncoder().encode('CASCADE\nTShapes 1\nSo\n');
  const wide = { maxFeatures: 500, maxFile: 100_000, maxChains: 100_000 };

  it('one entry many objects name is read once', () => {
    const n = 2_000;
    const objects = Array.from({ length: n }, (_, i) => [
      shapeObject(`F${i}`, 'big.brp'),
      ...onSupport(i, supportOn(`F${i}`)),
    ]).flat();
    let reads = 0;
    const d = docWith(objects, {
      get: () => {
        reads++;
        return SOLID;
      },
      size: () => SOLID.length,
    } as never);
    const chains = looseChains(d, tips(d, n), wide);
    expect(reads).toBe(1);
    expect(chains[0]?.foreignBase?.name).toBe('F0');
  });

  it('an entry that can’t be read is tried once', () => {
    const objects = [0, 1, 2].flatMap((i) => [
      shapeObject(`F${i}`, 'bad.brp'),
      ...onSupport(i, supportOn(`F${i}`)),
    ]);
    let reads = 0;
    const d = docWith(objects, {
      get: () => {
        reads++;
        throw new Error('bad CRC');
      },
      size: () => 10,
    } as never);
    expect(looseChains(d, tips(d, 3), wide).map((c) => c.foreignBase)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(reads).toBe(1);
  });

  it('an entry past what the kernel reads is never read', () => {
    const objects = [shapeObject('F0', 'huge.brp'), ...onSupport(0, supportOn('F0'))];
    let reads = 0;
    const d = docWith(objects, {
      get: () => {
        reads++;
        return SOLID;
      },
      size: () => 128 * 1024 * 1024,
    } as never);
    expect(looseChains(d, tips(d, 1), wide)[0]?.foreignBase).toBeUndefined();
    expect(reads).toBe(0);
  });

  it('a long support list costs its first item', () => {
    const items = Array.from({ length: 200_000 }, () => ({
      object: 'Gone',
      sub: { name: 'Face1' },
    }));
    const list = { kind: 'linkSubList', items } as unknown as FcValue;
    const sketch = object('S', 'Sketcher::SketchObject', { Support: list });
    const n = 2_000;
    const pockets = Array.from({ length: n }, (_, i) =>
      object(`K${i}`, 'PartDesign::Pocket', { Sketch: link('S') }),
    );
    const d = doc([sketch, ...pockets]);
    const t = performance.now();
    looseChains(d, tips(d, n), wide);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it('a row refused at its cap leaves the plan’s features to the chains after it', () => {
    const rows = [0, 1, 2, 3].flatMap((r) =>
      Array.from({ length: 501 }, (_, i) =>
        pad(`R${r}_${i}`, i > 0 ? `R${r}_${i - 1}` : undefined),
      ),
    );
    const chains = plan(
      [...rows, pad('A'), pad('B', 'A')],
      ['R0_500', 'R1_500', 'R2_500', 'R3_500', 'B'],
    );
    expect(chains.slice(0, 4).map((c) => c.refused?.reason)).toEqual([
      'limit',
      'limit',
      'limit',
      'limit',
    ]);
    expect(names(chains[4])).toEqual(['A', 'B']);
  });
});

describe('what the whole plan may visit', () => {
  /** `rows` rows of `n` patterns, each of two originals: the one before it and a pad on that one. */
  function patternRows(rows: number, n: number) {
    const objects: FcObject[] = [];
    const tips: string[] = [];
    for (let r = 0; r < rows; r++) {
      objects.push(pad(`P${r}_0`), pad(`Q${r}_0`, `P${r}_0`));
      for (let i = 1; i < n; i++) {
        objects.push(
          object(`P${r}_${i}`, 'PartDesign::LinearPattern', {
            Originals: {
              kind: 'linkList',
              objects: [`P${r}_${i - 1}`, `Q${r}_${i - 1}`],
            } as FcValue,
          }),
          pad(`Q${r}_${i}`, `P${r}_${i}`),
        );
      }
      tips.push(`P${r}_${n - 1}`);
    }
    return { objects, tips };
  }

  it('256 rows of 501 patterns of two originals cost the budgets, not their product', () => {
    const { objects, tips } = patternRows(256, 501);
    const t = performance.now();
    const chains = plan(objects, tips);
    const ms = performance.now() - t;
    expect(chains.every((c) => c.refused?.reason === 'limit')).toBe(true);
    expect(ms).toBeLessThan(2_000);
    if (process.env.BENCH) console.log(`256 rows of 501 patterns: ${Math.round(ms)} ms`);
  });

  it('rows refused at their cap use up the visits: the chains after them as today', () => {
    const rows = Array.from({ length: 40 }, (_, r) =>
      Array.from({ length: 501 }, (_, i) =>
        pad(`R${r}_${i}`, i > 0 ? `R${r}_${i - 1}` : undefined),
      ),
    ).flat();
    const tips = Array.from({ length: 40 }, (_, r) => `R${r}_500`);
    const chains = plan([...rows, pad('A')], [...tips, 'A']);
    expect(chains.at(-1)?.refused?.reason).toBe('limit');
    expect(chains.at(-1)?.refused?.detail).toMatch(/follow/);
  });

  it('an honest file never comes near them', () => {
    const { objects, tips } = patternRows(2, 40);
    expect(plan(objects, tips).map((c) => c.refused)).toEqual([undefined, undefined]);
  });
});

describe('the limits', () => {
  /** A row of `n` pads, each on the one before. */
  const row = (n: number) =>
    Array.from({ length: n }, (_, i) => pad(`P${i}`, i > 0 ? `P${i - 1}` : undefined));

  it('refuses a chain of 10,000 at the cap, without recursion', () => {
    const objects = row(10_000);
    const t = performance.now();
    const [c] = plan(objects, ['P9999']);
    expect(c?.refused?.reason).toBe('limit');
    expect(performance.now() - t).toBeLessThan(1_000);
  });

  it('bounds a comb of n tips on one row by the file’s cap, not n²', () => {
    const n = 3_000;
    const objects = row(n);
    const t = performance.now();
    const chains = plan(
      objects,
      objects.map((o) => o.name),
      { maxFeatures: 10_000, maxFile: 2_000, maxChains: 10_000 },
    );
    const walked = chains.reduce((k, c) => k + c.features.length, 0);
    expect(walked).toBeLessThanOrEqual(2_000);
    expect(chains.at(-1)?.refused?.reason).toBe('limit');
    expect(performance.now() - t).toBeLessThan(1_000);
  });

  it('refuses the chains past the import’s cap', () => {
    const objects = Array.from({ length: 5 }, (_, i) => pad(`P${i}`));
    const chains = plan(
      objects,
      objects.map((o) => o.name),
      { ...LIMITS, maxChains: 3 },
    );
    expect(chains.map((c) => c.refused?.reason)).toEqual([
      undefined,
      undefined,
      undefined,
      'limit',
      'limit',
    ]);
  });
});
