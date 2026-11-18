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
  return looseChains(d, tips.map((t) => tip(d.byName.get(t) as FcObject)), limits);
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
        edit: (name, xml) =>
          name === 'Sketch003' ? xml.replace('obj="Boss"', 'obj="Pad"') : xml,
      }),
    );
    const [c] = looseChains(d, finalShapes(d).filter((s) => s.kind === 'chain-tip'), LIMITS);
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
