import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { parameterUsers, usedParameterNames } from './document-commands';
import { mentionedNames, mentions } from './expr/parameters';
import type { ExtrudoDocument, Feature, Parameter } from './schema';
import { fid, pid } from './testing';

/**
 * `usedParameterNames` answers, for every name at once, what `parameterUsers`
 * answers for one: whether anything uses it (the Parameters dialog's
 * followers, ADR-0142 §6).
 */

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
type Random = ReturnType<typeof random>;

/** Names parameters have, with some an object's prototype or the language also knows. */
const NAMES = [
  ...Array.from({ length: 8 }, (_, i) => `p${i}`),
  'd1',
  'd2',
  'd3',
  '_x',
  '__proto__',
  'constructor',
  'pi',
  'mm',
];
/** Names no parameter has: unknown, or deleted. */
const ASKED = [...NAMES, 'ghost', 'd9', 'p'];

function randomExpression(r: Random): string {
  const a = r.pick(ASKED);
  const b = r.pick(ASKED);
  return r.pick([
    `${r.below(9) + 1} mm`,
    a,
    ` ${a} `,
    `${a} + 1 mm`,
    `${a} * 2 - ${b}`,
    `max(${a}, ${b})`,
    `${a}(2)`,
    `${a} (2) + ${b}`,
    `x.${a} + ${b}`,
    `${a}.5`,
    `2${a}`,
    `${a}_ + ${b}`,
    `${a} +`,
    `(${a}`,
    `${a} $ ${b}`,
    `${a}\n+${b}`,
  ]);
}

function randomDocument(r: Random): ExtrudoDocument {
  const parameters: Parameter[] = Array.from({ length: r.below(10) }, (_, i) => {
    const range: Record<string, string> = {};
    for (const field of ['min', 'max', 'step']) {
      if (r.below(4) === 0) range[field] = randomExpression(r);
    }
    return {
      id: pid(`id-${i}`),
      name: r.pick(NAMES),
      expression: randomExpression(r),
      unit: 'length',
      ...(r.below(2) === 0 ? { customizer: range } : {}),
    };
  });
  const features: Feature[] = Array.from({ length: r.below(6) }, (_, i) => {
    const holder = () => ({
      expr: randomExpression(r),
      ...(r.below(2) === 0 ? { paramName: r.pick(NAMES) } : {}),
    });
    if (r.below(3) === 0) {
      const dimension = () => ({
        type: r.pick(['distance', 'angle']),
        ...holder(),
        ...(r.below(4) === 0 ? { driven: true } : {}),
      });
      return {
        id: fid(`f${i}`),
        type: 'sketch',
        name: `Sketch${i}`,
        suppressed: false,
        inputs: {
          sketch: {
            kind: 'sketchData',
            sketch: { dimensions: { k1: dimension(), k2: dimension() } },
          },
        },
      } as unknown as Feature;
    }
    return {
      id: fid(`f${i}`),
      type: 'extrude',
      name: `Extrude${i}`,
      suppressed: false,
      inputs: { distance: { kind: 'expr', ...holder() }, taper: { kind: 'expr', ...holder() } },
    };
  });
  const joints = Array.from({ length: r.below(3) }, (_, i) => ({
    id: `j${i}`,
    name: `Joint${i}`,
    type: r.pick(['slider', 'revolute']),
    ...(r.below(2) === 0 ? { min: { kind: 'expr', expr: randomExpression(r) } } : {}),
    ...(r.below(2) === 0 ? { max: { kind: 'expr', expr: randomExpression(r) } } : {}),
  }));
  // A deleted parameter: what used it now names nothing.
  if (parameters.length > 0 && r.below(3) === 0) parameters.splice(r.below(parameters.length), 1);
  return {
    ...createDocument({ now: '2026-11-19T10:00:00.000Z' }),
    parameters,
    features,
    timelineMarker: features.length,
    joints,
  } as unknown as ExtrudoDocument;
}

describe('usedParameterNames', () => {
  it('agrees with parameterUsers for every name on seeded random documents', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const d = randomDocument(random(seed));
      const used = usedParameterNames(d);
      for (const name of ASKED) {
        expect(used.has(name), `seed ${seed}, ${name}`).toBe(parameterUsers(d, name).length > 0);
      }
    }
  });

  it('leaves out what only uses itself, and driven dimensions', () => {
    const d = randomDocument(random(1));
    const own: ExtrudoDocument = {
      ...d,
      parameters: [{ id: pid('a'), name: 'own', expression: 'own + 1 mm', unit: 'length' }],
      features: [
        {
          id: fid('f1'),
          type: 'extrude',
          name: 'Extrude1',
          suppressed: false,
          inputs: { distance: { kind: 'expr', expr: 'd1 + 1 mm', paramName: 'd1' } },
        },
      ],
      timelineMarker: 1,
      joints: [],
    };
    expect([...usedParameterNames(own)]).not.toContain('own');
    expect([...usedParameterNames(own)]).not.toContain('d1');
    const ranged = {
      ...own,
      parameters: [{ ...(own.parameters[0] as Parameter), customizer: { max: 'own * 2' } }],
    };
    expect(usedParameterNames(ranged).has('own')).toBe(true);
  });

  it('reads each expression of the document once', () => {
    const N = 2000;
    let reads = 0;
    const counted = <T extends object>(holder: T, key: keyof T & string) => {
      const value = holder[key];
      Object.defineProperty(holder, key, {
        get() {
          reads++;
          return value;
        },
      });
      return holder;
    };
    const d = {
      ...createDocument({ now: '2026-11-19T10:00:00.000Z' }),
      parameters: [
        counted({ id: pid('w'), name: 'w', expression: '1 mm', unit: 'length' }, 'expression'),
      ],
      features: Array.from({ length: N }, (_, i) => ({
        id: fid(`f${i}`),
        type: 'extrude',
        name: `Extrude${i}`,
        suppressed: false,
        inputs: { distance: counted({ kind: 'expr', expr: 'w', paramName: `d${i + 1}` }, 'expr') },
      })),
      timelineMarker: N,
    } as unknown as ExtrudoDocument;
    const used = usedParameterNames(d);
    expect(used.has('w')).toBe(true);
    expect(used.has('d1')).toBe(false);
    expect(reads).toBe(N + 1);
  });
});

describe('mentionedNames', () => {
  it('lists a name exactly when mentions finds it', () => {
    const r = random(20261119);
    const pieces = [
      'p1',
      'p1_',
      'x',
      '2',
      '.',
      ' ',
      '(',
      ')',
      '+',
      '\t',
      '\n',
      'e5',
      '_',
      'é',
      ',',
    ];
    for (let i = 0; i < 20000; i++) {
      const text = Array.from({ length: r.below(8) }, () => r.pick(pieces)).join('');
      const names = new Set(mentionedNames(text));
      for (const name of ['p1', 'p1_', 'x', 'e5', '_', 'xp1', 'p1x', '2', 'x2']) {
        expect(names.has(name), JSON.stringify([text, name])).toBe(mentions(text, name));
      }
    }
  });
});
