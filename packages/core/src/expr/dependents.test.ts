import { describe, expect, it, vi } from 'vitest';
import { evaluateRange } from '../customizer';
import { createDocument } from '../document';
import type { FeatureId } from '../ids';
import type { ExtrudoDocument, Feature, Parameter } from '../schema';
import { fid, pid } from '../testing';
import { isReservedName } from './evaluate';
import { evaluateParameters, type ParameterEvaluation } from './parameters';
import { parse, references } from './parser';

function param(name: string, expression: string): Parameter {
  return { id: pid(`id-${name}`), name, expression, unit: 'length' };
}

function exprFeature(id: string, expr: string, paramName?: string): Feature {
  return {
    id: fid(id),
    type: 'extrude',
    name: id,
    suppressed: false,
    inputs: { distance: { kind: 'expr', expr, ...(paramName ? { paramName } : {}) } },
  };
}

function sketchFeature(id: string, dimensions: Record<string, object>): Feature {
  return {
    id: fid(id),
    type: 'sketch',
    name: id,
    suppressed: false,
    inputs: { sketch: { kind: 'sketchData', sketch: { dimensions } } },
  } as unknown as Feature;
}

function doc(parameters: Parameter[], features: Feature[] = []): ExtrudoDocument {
  return {
    ...createDocument({ now: '2026-11-18T10:00:00.000Z' }),
    parameters,
    features,
    timelineMarker: features.length,
  };
}

/** The answer as it was first defined: every parameter looked through for each name followed. */
function referenceDependents(e: ParameterEvaluation, names: Iterable<string>): Set<string> {
  const found = new Set<string>();
  const queue = [...names];
  const start = new Set(queue);
  while (queue.length > 0) {
    const name = queue.pop() as string;
    for (const p of e.parameters.values()) {
      if (p.refs.includes(name) && !found.has(p.name) && !start.has(p.name)) {
        found.add(p.name);
        queue.push(p.name);
      }
    }
  }
  return found;
}

function namesIn(expression: string): string[] {
  try {
    return references(parse(expression)).filter((name) => !isReservedName(name));
  } catch {
    return [];
  }
}

/** The names one feature's inputs refer to: an input that owns its parameter refers to that. */
function inputNames(feature: Feature, e: ParameterEvaluation): Set<string> {
  const names = new Set<string>();
  const add = (expr: string, paramName: string | undefined, owns: (o: object) => boolean) => {
    const owner = paramName === undefined ? undefined : e.parameters.get(paramName)?.owner;
    if (paramName !== undefined && owner && owns(owner)) names.add(paramName);
    else for (const name of namesIn(expr)) names.add(name);
  };
  for (const [input, value] of Object.entries(feature.inputs)) {
    if (value.kind === 'expr') {
      add(value.expr, value.paramName, (o) => {
        const m = o as { type: string; featureId?: string; input?: string };
        return m.type === 'model' && m.featureId === feature.id && m.input === input;
      });
    } else if (value.kind === 'sketchData') {
      for (const [id, d] of Object.entries(value.sketch.dimensions)) {
        if (d.driven) continue;
        add(d.expr, d.paramName, (o) => {
          const m = o as { type: string; featureId?: string; dimension?: string };
          return m.type === 'dimension' && m.featureId === feature.id && m.dimension === id;
        });
      }
    }
  }
  return names;
}

function referenceAffected(
  d: ExtrudoDocument,
  e: ParameterEvaluation,
  names: Iterable<string>,
): FeatureId[] {
  const changed = new Set(names);
  for (const name of referenceDependents(e, changed)) changed.add(name);
  const byFeature = new Map(d.features.map((f) => [f.id, inputNames(f, e)]));
  return d.features
    .filter((f) => [...(byFeature.get(f.id) ?? [])].some((ref) => changed.has(ref)))
    .map((f) => f.id);
}

/** A small seeded generator (mulberry32), so a failure can be run again. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n: number) => Math.floor(next() * n);
  return { below, pick: <T>(list: readonly T[]) => list[below(list.length)] as T };
}

/** Parameter names, with some that an object's prototype or the language also knows. */
const NAMES = [
  ...Array.from({ length: 12 }, (_, i) => `p${i}`),
  '__proto__',
  'constructor',
  'pi',
  'mm',
];
/** Names no parameter has, and names that were deleted. */
const QUESTIONS = [...NAMES, 'ghost', 'ghost2', ''];

function randomExpression(r: ReturnType<typeof random>): string {
  const a = r.pick(QUESTIONS.slice(0, -1));
  const b = r.pick(QUESTIONS.slice(0, -1));
  return r.pick([
    `${r.below(9) + 1} mm`,
    a,
    `${a} + 1 mm`,
    `${a} + ${a}`,
    `${a} * 2 - ${b}`,
    `max(${a}, ${b})`,
    `sin(${a}) * 1 mm`,
    `${a} +`,
    `(${a}`,
    `${a} $ ${b}`,
  ]);
}

function randomDocument(r: ReturnType<typeof random>): ExtrudoDocument {
  const parameters = Array.from({ length: r.below(15) }, (_, i) => ({
    ...param(r.pick(NAMES), randomExpression(r)),
    id: pid(`id-${i}`),
  }));
  const features = Array.from({ length: r.below(7) }, (_, i) => {
    // Now and then an ID is used twice: the answer lists such a feature twice.
    const id = r.below(8) === 0 ? 'f0' : `f${i}`;
    if (r.below(3) === 0) {
      const dimension = () => ({
        type: r.pick(['distance', 'angle']),
        expr: randomExpression(r),
        ...(r.below(2) === 0 ? { paramName: r.pick(NAMES) } : {}),
        ...(r.below(4) === 0 ? { driven: true } : {}),
      });
      return sketchFeature(id, { k1: dimension(), k2: dimension() });
    }
    const paramName = r.below(2) === 0 ? r.pick(NAMES) : undefined;
    return exprFeature(id, randomExpression(r), paramName);
  });
  // A deleted parameter: what used it now refers to a name nothing has.
  if (parameters.length > 0 && r.below(3) === 0) parameters.splice(r.below(parameters.length), 1);
  return doc(parameters, features);
}

function randomQuestion(r: ReturnType<typeof random>): Iterable<string> {
  const names = Array.from({ length: r.below(6) }, () => r.pick(QUESTIONS));
  if (names.length > 1 && r.below(3) === 0) names.push(names[0] as string);
  const form = r.below(3);
  if (form === 0) return new Set(names);
  if (form === 1) return names.values();
  return names;
}

describe('what depends on a parameter', () => {
  const e = evaluateParameters(
    doc(
      [
        param('base', '10 mm'),
        param('next', 'base + 1 mm'),
        param('last', 'next * 2'),
        param('broken', 'base +'),
        param('stray', 'missing + 1 mm'),
        param('loopA', 'loopB + base'),
        param('loopB', 'loopA'),
        param('own', 'own + 1 mm'),
      ],
      [
        exprFeature('f1', 'last'),
        exprFeature('f2', '5 mm'),
        exprFeature('f3', 'missing'),
        exprFeature('f4', 'base'),
      ],
    ),
  );

  it('follows references through parameters, in the order they are found', () => {
    expect([...e.dependents(['base'])]).toEqual(['next', 'loopA', 'loopB', 'last']);
  });

  it('leaves out the names asked about, also inside a cycle', () => {
    expect(e.dependents(['loopA'])).toEqual(new Set(['loopB']));
    expect(e.dependents(['own'])).toEqual(new Set());
    expect(e.dependents(['base', 'last'])).toEqual(new Set(['next', 'loopA', 'loopB']));
  });

  it('answers for a name no parameter has', () => {
    expect(e.dependents(['missing'])).toEqual(new Set(['stray']));
    expect(e.featuresAffectedBy(['missing'])).toEqual([fid('f3')]);
    expect(e.dependents(['nothing'])).toEqual(new Set());
  });

  it('has no dependents through an expression that does not read', () => {
    expect(e.dependents(['base']).has('broken')).toBe(false);
  });

  it('gives the same answer for a name given twice, and when asked again', () => {
    const once = [...e.dependents(['base'])];
    expect([...e.dependents(['base', 'base'])]).toEqual(once);
    expect([...e.dependents(['base'])]).toEqual(once);
  });

  it('gives each caller a set of its own', () => {
    e.dependents(['base']).add('extra');
    expect(e.dependents(['base']).has('extra')).toBe(false);
  });

  it('lists the affected features in timeline order', () => {
    expect(e.featuresAffectedBy(['base'])).toEqual([fid('f1'), fid('f4')]);
  });

  it('reads names that an object prototype also has as parameters', () => {
    const odd = evaluateParameters(
      doc([param('__proto__', '1 mm'), param('constructor', '__proto__ + 1 mm')]),
    );
    expect(odd.dependents(['__proto__'])).toEqual(new Set(['constructor']));
    expect(odd.dependents(['toString'])).toEqual(new Set());
  });

  it('matches the first definition on seeded random documents', () => {
    const seen = { cycles: 0, errors: 0, answers: 0, affected: 0, questions: 0 };
    for (let seed = 1; seed <= 3000; seed++) {
      const r = random(seed);
      const d = randomDocument(r);
      const evaluated = evaluateParameters(d);
      for (const p of evaluated.parameters.values()) {
        if (p.result.ok) continue;
        seen.errors++;
        if (p.result.error.code === 'cycle') seen.cycles++;
      }
      for (let q = 0; q < 6; q++) {
        const names = [...randomQuestion(r)];
        const dependents = [...evaluated.dependents(names)];
        const affected = evaluated.featuresAffectedBy(names);
        expect(dependents, `seed ${seed}`).toEqual([...referenceDependents(evaluated, names)]);
        expect(affected, `seed ${seed}`).toEqual(referenceAffected(d, evaluated, names));
        seen.questions++;
        if (dependents.length > 0) seen.answers++;
        if (affected.length > 0) seen.affected++;
      }
    }
    // The documents do reach the cases the comparison is for.
    expect(seen.cycles).toBeGreaterThan(500);
    expect(seen.errors).toBeGreaterThan(5000);
    expect(seen.answers).toBeGreaterThan(1000);
    expect(seen.affected).toBeGreaterThan(1000);
    expect(seen.questions).toBe(18_000);
  });

  it('takes any iterable, read once', () => {
    let reads = 0;
    function* names() {
      reads++;
      yield 'base';
    }
    expect(e.dependents(names())).toEqual(e.dependents(['base']));
    expect(reads).toBe(1);
  });
});

/** Counts each read of a parameter's references from here on. */
function countRefReads(e: ParameterEvaluation): { count: number } {
  const reads = { count: 0 };
  for (const p of e.parameters.values()) {
    const refs = p.refs;
    Object.defineProperty(p, 'refs', {
      get() {
        reads.count++;
        return refs;
      },
    });
  }
  return reads;
}

/** How many set and map lookups `run` makes. */
function countLookups(run: () => void): number {
  const has = Set.prototype.has;
  const get = Map.prototype.get;
  let count = 0;
  Set.prototype.has = function (this: Set<unknown>, value: unknown) {
    count++;
    return has.call(this, value);
  };
  Map.prototype.get = function (this: Map<unknown, unknown>, key: unknown) {
    count++;
    return get.call(this, key);
  };
  try {
    run();
  } finally {
    Set.prototype.has = has;
    Map.prototype.get = get;
  }
  return count;
}

describe('the work of finding what depends on a parameter', () => {
  const N = 2000;
  const line = Array.from({ length: N }, (_, i) =>
    param(`p${i}`, i === N - 1 ? '1 mm' : `p${i + 1} + 1 mm`),
  );
  const fan = [
    param('root', '1 mm'),
    ...Array.from({ length: N }, (_, i) => param(`u${i}`, 'root + 1 mm')),
  ];

  it('reads no references for an evaluation that never asks', () => {
    const e = evaluateParameters(doc(line));
    const reads = countRefReads(e);
    e.evaluate('p0 + 1 mm');
    expect(reads.count).toBe(0);
  });

  it('reads each parameter once, however many questions follow', () => {
    const e = evaluateParameters(doc(line));
    const reads = countRefReads(e);
    e.dependents([`p${N - 1}`]);
    expect(reads.count).toBe(N);
    e.dependents(['p5']);
    e.featuresAffectedBy([`p${N - 1}`]);
    expect(reads.count).toBe(N);
  });

  it('takes work in step with the parameters and references, along a line', () => {
    const e = evaluateParameters(doc(line));
    const lookups = countLookups(() => e.dependents([`p${N - 1}`]));
    expect(lookups).toBeLessThanOrEqual(4 * (N + N));
  });

  it('takes work in step with the parameters and references, across a fan', () => {
    const e = evaluateParameters(doc(fan));
    const reads = countRefReads(e);
    const lookups = countLookups(() => e.dependents(['root']));
    expect(reads.count).toBe(N + 1);
    expect(lookups).toBeLessThanOrEqual(4 * (N + N));
  });

  it('follows a name given many times once', () => {
    const e = evaluateParameters(doc(fan));
    const names = Array.from({ length: N }, () => 'root');
    const lookups = countLookups(() => e.dependents(names));
    expect(lookups).toBeLessThanOrEqual(4 * (N + N + N));
  });

  it('takes work in step with the features too', () => {
    const features = Array.from({ length: N }, (_, i) => exprFeature(`f${i}`, `p${i} * 2`));
    const e = evaluateParameters(doc(line, features));
    const reads = countRefReads(e);
    let affected: FeatureId[] = [];
    const lookups = countLookups(() => {
      affected = e.featuresAffectedBy([`p${N - 1}`]);
    });
    expect(affected).toHaveLength(N);
    expect(reads.count).toBe(N);
    expect(lookups).toBeLessThanOrEqual(4 * (N + N + N));
  });

  it('does not look for dependents for a slider range without a parameter', () => {
    const e = evaluateParameters(doc(line));
    const dependents = vi.fn(e.dependents);
    const evaluation = { ...e, dependents };
    const parameter = { name: 'p0', unit: 'length' as const };
    expect(evaluateRange(evaluation, parameter, 'max', '100 mm + 2 * pi * 1 mm').ok).toBe(true);
    expect(dependents).not.toHaveBeenCalled();
    expect(evaluateRange(evaluation, parameter, 'max', 'p1').ok).toBe(true);
    expect(dependents).toHaveBeenCalledTimes(1);
  });
});
