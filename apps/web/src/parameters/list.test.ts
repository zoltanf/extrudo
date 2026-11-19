import {
  createDocument,
  type EvaluatedParameter,
  type ExtrudoDocument,
  evaluateParameters,
  type Feature,
  type FeatureId,
  type Parameter,
  type ParameterEvaluation,
  type ParameterId,
  type ParameterUse,
  parameterUsers,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  dropIndex,
  featureName,
  featureNamesById,
  followerNames,
  groupNames,
  labelOfUse,
  listSections,
  stepIndex,
} from './list';

/**
 * ADR-0086: the Parameters dialog's list as data. The dialog draws in a
 * portal (Radix `Dialog`), so its sections and moves are tested here; the
 * e2e spec drags and clicks.
 */
const pid = (id: string) => id as ParameterId;
const param = (id: string, group?: string): Parameter => ({
  id: pid(id),
  name: id,
  expression: '1 mm',
  unit: 'length',
  ...(group ? { group } : {}),
});

describe('listSections', () => {
  it('is one flat list while no parameter has a group', () => {
    expect(listSections([param('a'), param('b')])).toEqual([
      { group: undefined, title: 'User parameters', ids: ['a', 'b'] },
    ]);
  });

  it('puts the ungrouped first under General, then the groups by first appearance', () => {
    const parameters = [param('w', 'Size'), param('x'), param('y', 'Holes'), param('z', 'Size')];
    expect(listSections(parameters)).toEqual([
      { group: undefined, title: 'General', ids: ['x'] },
      { group: 'Size', title: 'Size', ids: ['w', 'z'] },
      { group: 'Holes', title: 'Holes', ids: ['y'] },
    ]);
    expect(groupNames(parameters)).toEqual(['Size', 'Holes']);
  });

  it('leaves out an empty General, unless a drag needs it as a place to drop', () => {
    const parameters = [param('w', 'Size')];
    expect(listSections(parameters).map((s) => s.title)).toEqual(['Size']);
    expect(listSections(parameters, true).map((s) => s.title)).toEqual(['General', 'Size']);
  });
});

describe('dropIndex', () => {
  const parameters = [param('a'), param('b', 'G'), param('c'), param('d', 'G')];

  it('lands before the row it is dropped on', () => {
    expect(dropIndex(parameters, pid('d'), { before: pid('a'), group: undefined })).toBe(0);
    expect(dropIndex(parameters, pid('a'), { before: pid('d'), group: 'G' })).toBe(2);
  });

  it('lands after the last of a section at its end, or at the end of the list', () => {
    expect(dropIndex(parameters, pid('a'), { group: 'G' })).toBe(3);
    expect(dropIndex(parameters, pid('d'), { group: undefined })).toBe(3);
    expect(dropIndex(parameters, pid('a'), { group: 'New' })).toBe(3);
  });
});

describe('stepIndex', () => {
  const parameters = [param('a', 'G'), param('b'), param('c', 'G'), param('d', 'G')];

  it("moves past the neighbour in the parameter's own group", () => {
    expect(stepIndex(parameters, pid('c'), -1)).toBe(0);
    expect(stepIndex(parameters, pid('a'), 1)).toBe(2);
    expect(stepIndex(parameters, pid('c'), 1)).toBe(3);
  });

  it('stops at either end of the group', () => {
    expect(stepIndex(parameters, pid('a'), -1)).toBeUndefined();
    expect(stepIndex(parameters, pid('d'), 1)).toBeUndefined();
    expect(stepIndex(parameters, pid('b'), 1)).toBeUndefined();
    expect(stepIndex(parameters, pid('gone'), 1)).toBeUndefined();
  });
});

describe('labelOfUse', () => {
  it('names each kind of use the way the dialog shows it', () => {
    const uses: ParameterUse[] = [
      { kind: 'parameter', id: pid('p2'), name: 'inner' },
      { kind: 'range', id: pid('p3'), name: 'lip', field: 'max' },
      {
        kind: 'feature',
        featureId: 'f1' as never,
        feature: 'Sketch1',
        paramName: 'd3',
        dimension: true,
      },
      { kind: 'feature', featureId: 'f2' as never, feature: 'Extrude1', dimension: false },
      { kind: 'joint', joint: 'Hinge', end: 'min', quantity: 'angle' },
    ];
    expect(uses.map(labelOfUse)).toEqual([
      'inner',
      'lip · Max',
      'Sketch1 · d3',
      'Extrude1',
      'Hinge · minimum angle',
    ]);
  });
});

describe('followerNames', () => {
  /** Which of the document's parameters the list hides (ADR-0142 §6). */
  const hidden = (doc: ExtrudoDocument) => [...followerNames(doc, evaluateParameters(doc))];
  const doc = (parameters: Parameter[]): ExtrudoDocument => ({
    ...createDocument(),
    parameters,
    features: [
      {
        id: 'f1' as FeatureId,
        type: 'extrude',
        name: 'Extrude1',
        suppressed: false,
        inputs: {
          distance: { kind: 'expr', expr: 'width', paramName: 'd1' },
          taper: { kind: 'expr', expr: 'width * 2', paramName: 'd2' },
          offset: { kind: 'expr', expr: 'd2', paramName: 'd3' },
        },
      },
    ],
    timelineMarker: 1,
  });
  const width: Parameter = { ...param('width'), expression: '10 mm' };

  it('hides a model parameter whose expression is a user parameter alone', () => {
    expect(hidden(doc([width]))).toEqual(['d1']);
  });

  it('keeps it once something refers to it', () => {
    expect(hidden(doc([width, { ...param('half'), expression: 'd1 / 2' }]))).toEqual([]);
  });
});

/** The first definition: one `parameterUsers` per row. */
function referenceFollows(
  doc: ExtrudoDocument,
  evaluation: ParameterEvaluation,
  p: EvaluatedParameter,
): boolean {
  if (p.owner.type === 'user' || p.refs.length !== 1) return false;
  const [ref] = p.refs;
  if (ref === undefined || p.expression.trim() !== ref) return false;
  if (evaluation.parameters.get(ref)?.owner.type !== 'user') return false;
  return parameterUsers(doc, p.name).length === 0;
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

describe('the followers against the first definition', () => {
  const USER = ['w', 'h', 'own', 'ghost'];
  const MODEL = ['d1', 'd2', 'd3', 'd4', 'd5'];

  function randomDocument(r: ReturnType<typeof random>): ExtrudoDocument {
    const name = () => r.pick([...USER, ...MODEL]);
    const expression = () =>
      r.pick([
        name(),
        ` ${name()} `,
        `${name()} * 2`,
        `${name()} +`,
        `${name()}(1)`,
        `${r.below(9) + 1} mm`,
      ]);
    const parameters: Parameter[] = USER.slice(0, r.below(4)).map((n, i) => ({
      id: pid(`p${i}`),
      name: n,
      expression: r.below(4) === 0 ? expression() : `${i + 1} mm`,
      unit: 'length',
      ...(r.below(4) === 0 ? { customizer: { max: expression() } } : {}),
    }));
    const features: Feature[] = MODEL.slice(0, r.below(6)).map((paramName, i) => {
      if (r.below(3) === 0) {
        return {
          id: `f${i}` as FeatureId,
          type: 'sketch',
          name: `Sketch${i}`,
          suppressed: false,
          inputs: {
            sketch: {
              kind: 'sketchData',
              sketch: {
                dimensions: {
                  k1: {
                    type: 'distance',
                    expr: r.below(2) ? r.pick(USER) : expression(),
                    paramName,
                  },
                  k2: {
                    type: 'distance',
                    expr: expression(),
                    ...(r.below(2) ? { driven: true } : {}),
                  },
                },
              },
            },
          },
        } as unknown as Feature;
      }
      return {
        id: `f${i}` as FeatureId,
        type: 'extrude',
        name: `Extrude${i}`,
        suppressed: false,
        inputs: {
          distance: { kind: 'expr', expr: r.below(2) ? r.pick(USER) : expression(), paramName },
          ...(r.below(2) ? { taper: { kind: 'expr', expr: expression() } } : {}),
        },
      };
    });
    if (parameters.length > 0 && r.below(4) === 0) parameters.splice(r.below(parameters.length), 1);
    return { ...createDocument(), parameters, features, timelineMarker: features.length };
  }

  it('hides the same rows on seeded random documents', () => {
    let hidden = 0;
    let shown = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const d = randomDocument(random(seed));
      const evaluation = evaluateParameters(d);
      const expected = [...evaluation.parameters.values()]
        .filter((p) => referenceFollows(d, evaluation, p))
        .map((p) => p.name);
      const followers = followerNames(d, evaluation);
      expect([...followers], `seed ${seed}`).toEqual(expected);
      hidden += expected.length;
      shown += evaluation.parameters.size - expected.length;
    }
    // Both kinds of row come up often.
    expect(hidden).toBeGreaterThan(1000);
    expect(shown).toBeGreaterThan(1000);
  });

  it('reads each expression of the document once for all rows', () => {
    const N = 2000;
    let reads = 0;
    const counted = <T extends object>(holder: T, key: keyof T & string): T => {
      const value = holder[key];
      Object.defineProperty(holder, key, {
        get() {
          reads++;
          return value;
        },
      });
      return holder;
    };
    const d: ExtrudoDocument = {
      ...createDocument(),
      parameters: [
        counted({ id: pid('w'), name: 'w', expression: '1 mm', unit: 'length' }, 'expression'),
      ],
      features: Array.from({ length: N }, (_, i) => ({
        id: `f${i}` as FeatureId,
        type: 'extrude',
        name: `Extrude${i}`,
        suppressed: false,
        inputs: {
          distance: counted({ kind: 'expr' as const, expr: 'w', paramName: `d${i + 1}` }, 'expr'),
        },
      })),
      timelineMarker: N,
    };
    const evaluation = evaluateParameters(d);
    reads = 0;
    expect(followerNames(d, evaluation).size).toBe(N);
    expect(reads).toBe(N + 1);
  });
});

describe('lookups made once for all rows', () => {
  it('names the same feature as a search through the features', () => {
    const d: ExtrudoDocument = {
      ...createDocument(),
      parameters: [],
      features: ['a', 'b', 'c'].map((id) => ({
        id: id as FeatureId,
        type: 'extrude',
        name: `Extrude-${id}`,
        suppressed: false,
        inputs: { distance: { kind: 'expr', expr: '1 mm', paramName: `d_${id}` } },
      })),
      timelineMarker: 3,
    };
    const evaluation = evaluateParameters(d);
    const names = featureNamesById(d);
    for (const p of evaluation.parameters.values()) {
      const searched =
        p.owner.type === 'user'
          ? ''
          : (d.features.find((f) => f.id === (p.owner as { featureId: FeatureId }).featureId)
              ?.name ?? '');
      expect(featureName(d, p, names)).toBe(searched);
      expect(featureName(d, p)).toBe(searched);
    }
  });

  it('has no step past the ends of a section, as stepIndex says', () => {
    const r = random(20261119);
    for (let round = 0; round < 500; round++) {
      const parameters = Array.from({ length: r.below(9) }, (_, i) =>
        param(`p${i}`, r.pick([undefined, undefined, 'A', 'B'])),
      );
      for (const keepGeneral of [false, true]) {
        for (const section of listSections(parameters, keepGeneral)) {
          section.ids.forEach((id, index) => {
            expect(stepIndex(parameters, id, -1) === undefined).toBe(index === 0);
            expect(stepIndex(parameters, id, 1) === undefined).toBe(
              index === section.ids.length - 1,
            );
          });
        }
      }
    }
  });
});
