/**
 * One budget per design for the work an import asks of the app at each open
 * (`budget.ts`, ADR-0083's amendment of 2026-11-15), on hand-built decoded
 * designs. Each case counts units, never time: below the budget nothing
 * changes; past it the feature comes in suppressed (a sketch no feature uses,
 * hidden) with a note, and what follows still imports.
 */

import { readFileSync } from 'node:fs';
import { Design } from '@extrudo/api';
import type { Feature } from '@extrudo/core';
import { MAX_TURNS } from '@extrudo/kernel';
import { loadFont } from '@extrudo/sketch/text';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ENTITIES_PER_UNIT,
  FULL_THREAD_TURNS,
  hiddenSketchesNote,
  IMPORT_WORK,
  MAX_IMPORT_ENTITIES,
  offsetDroppedNote,
  overBudgetNote,
  TEXT_UNITS,
  THREAD_UNITS,
  TOO_MANY_ENTITIES,
} from './budget';
import type { ParameterValue } from './decode/parameters';
import type { SketchLine } from './decode/sketch-geometry';
import type { SketchText } from './decode/text';
import { f3dToDesign } from './map';
import {
  type F3dDesign,
  type F3dExtrude,
  type F3dFeature,
  type F3dSketchFeature,
  IDENTITY,
} from './model';

beforeAll(() => {
  loadFont(
    'arimo-regular@1',
    readFileSync(new URL('../../fonts/fonts/arimo-regular.ttf', import.meta.url)),
  );
});

const parameter = (p: Partial<ParameterValue> & Pick<ParameterValue, 'name'>): ParameterValue => ({
  id: 0,
  number: 1,
  expression: '',
  kind: 'User Parameter',
  comment: '',
  user: false,
  unit: 'mm',
  value: 0,
  ...p,
});

/** A circle round (x, y) in a sketch on XY, cm. */
function circle(id: number, tag: bigint, radius: number, x = 0, y = 0) {
  return {
    point: { id: id + 1, at: [x, y, 0] as [number, number, number], incidence: 0 },
    circle: {
      id,
      tag,
      center: [x, y, 0] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
      xAxis: [1, 0, 0] as [number, number, number],
      radius,
      startAngle: 0,
      endAngle: 2 * Math.PI,
      centerPoint: id + 1,
      construction: false,
    },
  };
}

const whole = (tags: bigint[][]) =>
  tags.map((loop) => loop.map((tag) => ({ tag, secondary: 0n, piece: 1, of: 1 })));

/** A sketch on XY of circles, `lines` lines and `points` loose points. */
function sketch(
  id: number,
  record: number,
  name: string,
  circles: ReturnType<typeof circle>[],
  extra: { lines?: number; crossing?: boolean; points?: number; texts?: SketchText[] } = {},
): F3dSketchFeature {
  const points = circles.map((c) => c.point);
  for (let i = 0; i < (extra.points ?? 0); i++)
    points.push({
      id: 500_000 + i,
      at: [3 + (i % 1000) * 0.001, 3 + Math.floor(i / 1000) * 0.001, 0],
      incidence: 0,
    });
  const lines: SketchLine[] = [];
  for (let i = 0; i < (extra.lines ?? 0); i++) {
    // Loose short lines far off the circles, or, `crossing`, a grid: even ones
    // upright, odd ones across, each crossing every one of the other kind.
    const at = (k: number, end: 0 | 1): [number, number, number] =>
      !extra.crossing
        ? [3 + k * 0.02, end ? 3.01 : 3, 0]
        : k % 2 === 0
          ? [3 + k * 0.01, end ? 6 : 3, 0]
          : [end ? 6 : 3, 3 + k * 0.01, 0];
    const a = { id: 10_000 + 3 * i, at: at(i, 0), incidence: 0 };
    const b = { id: 10_001 + 3 * i, at: at(i, 1), incidence: 0 };
    points.push(a, b);
    lines.push({
      id: 10_002 + 3 * i,
      tag: BigInt(50_000 + i),
      start: a.at,
      end: b.at,
      startPoint: a.id,
      endPoint: b.id,
      construction: false,
    });
  }
  return {
    type: 'sketch',
    id,
    kind: 'Sketch',
    name,
    suppressed: false,
    parameters: [],
    sketch: {
      id: record,
      frame: IDENTITY,
      points,
      lines,
      circulars: circles.map((c) => c.circle),
      splines: [],
      texts: extra.texts ?? [],
    },
  };
}

function extrude(
  id: number,
  name: string,
  sketchRecord: number,
  operation: F3dExtrude['operation'],
  outer: bigint,
  inner?: bigint,
): F3dExtrude {
  const o = [[outer]];
  const i = inner ? [[inner]] : [];
  return {
    type: 'extrude',
    id,
    kind: 'Extrude',
    name,
    suppressed: false,
    parameters: [parameter({ name: `d${id}`, kind: 'AlongDistance', value: 0.08 })],
    operation,
    direction: 'one-side',
    reversed: false,
    solid: true,
    start: 'profile-plane',
    profiles: [
      {
        id: 100 + id,
        sketch: sketchRecord,
        regions: [{ outer: o, inner: i, outerPieces: whole(o), innerPieces: whole(i) }],
      },
    ],
    faces: [],
    participants: [],
  };
}

/** A washer (OD 11, ID 4.2, 0.8 mm) with a 1 mm hole cut through it at (3.8, 0) mm. */
function washerWithHole(): F3dDesign {
  return {
    parameters: [],
    userParameters: [],
    features: [
      sketch(1, 5, 'Sketch1', [circle(10, 101n, 0.55), circle(20, 102n, 0.21)]),
      extrude(2, 'Extrude1', 5, 'new-body', 101n, 102n),
      sketch(3, 6, 'Sketch2', [circle(40, 401n, 0.05, 0.38)]),
      extrude(4, 'Extrude2', 6, 'cut', 401n),
    ],
    bodies: [],
    problems: [],
    unreadParameters: 0,
  };
}

/** A circular pattern of `features` (records), `count` instances round Z. */
function pattern(
  id: number,
  name: string,
  count: number,
  features = [4],
  expression = '',
): F3dFeature {
  return {
    type: 'circular-pattern',
    id,
    kind: 'CircularPattern',
    name,
    suppressed: false,
    parameters: [
      parameter({ name: `a${id}`, kind: 'TotalAngle', unit: 'deg', value: 2 * Math.PI }),
    ],
    objects: 'features',
    features,
    axis: { point: [0, 0, 0], direction: [0, 0, 1] },
    count: parameter({ name: `c${id}`, kind: 'countU', unit: '', value: count, expression }),
  } as F3dFeature;
}

/** A hole of `n` centres in the washer's top. */
const hole = (id: number, name: string, n: number): F3dFeature => ({
  type: 'hole',
  id,
  kind: 'Hole',
  name,
  suppressed: false,
  parameters: [
    parameter({ name: `h${id}`, kind: 'HoleDiameter', value: 0.01 }),
    parameter({ name: `k${id}`, kind: 'HoleDepth', value: 0.08 }),
    parameter({ name: `t${id}`, kind: 'TipAngle', unit: 'deg', value: Math.PI }),
  ],
  plane: { origin: [0, 0, 0.08], x: [1, 0, 0], y: [0, 1, 0] },
  centres: Array.from({ length: n }, (_, i): [number, number, number] => [
    0.3 + (i % 40) * 0.001,
    Math.floor(i / 40) * 0.001,
    0.08,
  ]),
  flipped: false,
});

/** A last body after the rest: it imports whatever came before. */
function tail(f3d: F3dDesign): void {
  f3d.features.push(
    sketch(900, 990, 'SketchLast', [circle(900, 9001n, 0.1, 2, 2)]),
    extrude(901, 'ExtrudeLast', 990, 'new-body', 9001n),
  );
}

function mapped(f3d: F3dDesign) {
  const { design, report } = f3dToDesign(f3d, 'Budget');
  const doc = design.toJSON();
  const byName = (name: string): Feature => {
    const f = doc.features.find((x) => x.name === name);
    if (!f) throw new Error(`no ${name}`);
    return f;
  };
  const suppressed = doc.features.filter((f) => f.suppressed).map((f) => f.name);
  const hidden = doc.features.filter((f) => f.visible === false).map((f) => f.name);
  return { design, report, doc, byName, suppressed, hidden };
}

const budgetNotes = (notes: string[]) => notes.filter((n) => n.includes("the import's limit"));

describe('the design-wide import budget', () => {
  it('is what one pattern may make, and a full thread is charged the most turns the kernel allows', () => {
    expect(IMPORT_WORK).toBe(1000);
    expect(FULL_THREAD_TURNS).toBe(MAX_TURNS);
    expect([THREAD_UNITS, TEXT_UNITS]).toEqual([2, 3]);
  });

  it('charges a pattern its copies of what it repeats; past the budget the pattern comes in suppressed', () => {
    // 999 + 1 = the whole budget: nothing changes.
    const below = washerWithHole();
    below.features.push(pattern(10, 'P1', 1000), pattern(11, 'P2', 2));
    tail(below);
    const a = mapped(below);
    expect(a.suppressed).toEqual([]);
    expect(budgetNotes(a.report.notes)).toEqual([]);
    expect(a.report.imported).toEqual(expect.arrayContaining(['P1', 'P2', 'ExtrudeLast']));

    // One copy more: that pattern is suppressed, with a note; the rest imports.
    const past = washerWithHole();
    past.features.push(pattern(10, 'P1', 1000), pattern(11, 'P2', 3));
    tail(past);
    const b = mapped(past);
    expect(b.suppressed).toEqual(['P2']);
    expect(budgetNotes(b.report.notes)).toEqual([overBudgetNote('P2')]);
    expect(b.byName('P2').inputs.count).toMatchObject({ expr: '3' });
    expect(b.byName('ExtrudeLast').suppressed).toBe(false);
    expect(b.report.imported).toEqual(expect.arrayContaining(['P1', 'P2', 'ExtrudeLast']));
  });

  it('charges a pattern the units of what it repeats, and reads a count from the parameter it names', () => {
    // A hole of 10 centres repeated 99 times: 10 + 98 × 10 = 990.
    const holes = (count: number): F3dDesign => {
      const d = washerWithHole();
      d.features.push(hole(10, 'Hole1', 10), pattern(11, 'P1', count, [10]));
      tail(d);
      return d;
    };
    expect(mapped(holes(100)).suppressed).toEqual([]);
    expect(mapped(holes(101)).suppressed).toEqual(['P1']);

    // The file says 2, the parameter its count names says 1000: the kernel makes 1000.
    const named = washerWithHole();
    named.userParameters.push(
      parameter({ name: 'n', expression: '1000', unit: '', user: true, value: 1000 }),
    );
    named.features.push(pattern(10, 'P1', 2, [4], 'n'), pattern(11, 'P2', 3));
    const m = mapped(named);
    expect(m.byName('P1').inputs.count).toMatchObject({ expr: 'n' });
    expect(m.suppressed).toEqual(['P2']);
  });

  it('a pattern of a suppressed feature repeats nothing', () => {
    const f3d = washerWithHole();
    f3d.features.push(pattern(10, 'P1', 1000), pattern(11, 'P2', 3), pattern(12, 'P3', 2, [11]));
    // P3 repeats the suppressed P2: one unit, the pattern's least, and P1 left one.
    expect(mapped(f3d).suppressed).toEqual(['P2']);
  });

  it('charges hole centres', () => {
    const below = washerWithHole();
    below.features.push(hole(10, 'Hole1', 600), hole(11, 'Hole2', 400));
    tail(below);
    expect(mapped(below).suppressed).toEqual([]);
    const past = washerWithHole();
    past.features.push(hole(10, 'Hole1', 600), hole(11, 'Hole2', 401));
    tail(past);
    const m = mapped(past);
    // The hole and the sketch of its centres.
    expect(m.suppressed).toEqual(['Hole2 centres', 'Hole2']);
    expect(budgetNotes(m.report.notes)).toEqual([overBudgetNote('Hole2')]);
    expect(m.byName('ExtrudeLast').suppressed).toBe(false);
  });

  it('charges thread turns: the length over the pitch, a full thread its face’s length (unknown: the most)', () => {
    const thread = (id: number, name: string, full: boolean, lengths?: number[]): F3dFeature => ({
      type: 'thread',
      id,
      kind: 'Thread',
      name,
      suppressed: false,
      spec: {
        angle: 60,
        external: true,
        designation: 'M10x1.5',
        family: 'ISO Metric profile',
        full,
        major: 0.985,
        minor: 0.8141,
        pitch: 0.15,
      },
      parameters: full
        ? []
        : [
            parameter({ name: `l${id}`, kind: 'ThreadLength', value: 0.6 }),
            parameter({ name: `o${id}`, kind: 'ThreadOffset', value: 0 }),
          ],
      faces: [
        {
          tags: [{ token: '3', designs: [301] }],
          feature: 2,
          surface: {
            kind: 'cone',
            center: [0, 0, 0],
            axis: [0, 0, 1],
            radius: 0.4925,
            cylinder: true,
            slope: 0,
          },
        },
      ],
      ...(lengths ? { lengths } : {}),
    });
    const rod = (): F3dDesign => ({
      parameters: [],
      userParameters: [],
      features: [
        sketch(1, 5, 'Sketch1', [circle(10, 101n, 0.5)]),
        {
          ...extrude(2, 'Extrude1', 5, 'new-body', 101n),
          parameters: [parameter({ name: 'd2', kind: 'AlongDistance', value: 1 })],
        },
      ],
      bodies: [],
      problems: [],
      unreadParameters: 0,
    });
    // Two units a turn: 3 full threads of unknown length (3 × 150 turns), 10 of 4 turns (0.6 cm
    // over 0.15) and a full one of 1.5 cm (10 turns): 1000.
    const threads = (extra: number): F3dFeature[] => [
      ...Array.from({ length: 3 }, (_, i) => thread(10 + i, `Full${i}`, true)),
      ...Array.from({ length: 10 }, (_, i) => thread(30 + i, `Short${i}`, false)),
      thread(50, 'Known0', true, [0.15 * 10]),
      ...(extra ? [thread(60, 'OneMore', true, [0.15 * extra])] : []),
    ];
    const below = rod();
    below.features.push(...threads(0));
    tail(below);
    const a = mapped(below);
    expect(a.report.imported).toEqual(expect.arrayContaining(['Full0', 'Short0', 'Known0']));
    expect(a.suppressed).toEqual([]);
    const past = rod();
    past.features.push(...threads(1));
    tail(past);
    const b = mapped(past);
    expect(b.suppressed).toEqual(['OneMore']);
    expect(budgetNotes(b.report.notes)).toEqual([overBudgetNote('OneMore')]);
    expect(b.byName('ExtrudeLast').suppressed).toBe(false);
  });

  it('charges text characters', () => {
    const text = (id: number, n: number): SketchText => ({
      id,
      text: 'ab'.repeat(n).slice(0, n),
      font: 'Arial',
      height: 0.1,
      angle: 0,
      at: [3, 3],
      width: 0.07 * n,
    });
    // Three units a character: 300 characters, then `last` more; no feature uses the two
    // sketches, so each costs a unit more for its points.
    const texts = (last: number): F3dFeature[] => [
      sketch(20, 70, 'Text1', [], { texts: [text(71, 250), text(72, 50)] }),
      sketch(21, 73, 'Text2', [], { texts: [text(74, last)] }),
    ];
    const below = washerWithHole();
    below.features.push(...texts(32));
    tail(below);
    const a = mapped(below);
    expect(a.suppressed).toEqual([]);
    expect(a.hidden).toEqual([]);
    const past = washerWithHole();
    past.features.push(...texts(34));
    tail(past);
    const m = mapped(past);
    expect(m.suppressed).toEqual(['Text2']);
    expect(budgetNotes(m.report.notes)).toEqual([overBudgetNote('Text2')]);
    expect(m.byName('ExtrudeLast').suppressed).toBe(false);
  });

  it('charges the sketch copies extrudes with a start offset begin on, by their size', () => {
    // A sketch of the washer's circles and 330 loose lines: about 40 units a copy.
    const f3d = (copies: number): F3dDesign => {
      const d = washerWithHole();
      d.features[0] = sketch(1, 5, 'Sketch1', [circle(10, 101n, 0.55), circle(20, 102n, 0.21)], {
        lines: 330,
      });
      const ex = d.features[1] as F3dExtrude;
      for (let k = 0; k < copies; k++)
        d.features.push({
          ...ex,
          id: 200 + k,
          name: `E${k}`,
          parameters: [
            ...ex.parameters,
            parameter({ name: `o${k}`, kind: 'ProfileOffset', value: 0.01 * (k + 1) }),
          ],
        });
      tail(d);
      return d;
    };
    const one = mapped(f3d(1)).byName('E0 start');
    const units = Math.ceil(
      Object.keys((one.inputs.sketch as { sketch: { entities: object } }).sketch.entities).length /
        ENTITIES_PER_UNIT,
    );
    const fit = Math.floor(IMPORT_WORK / units);
    const below = mapped(f3d(fit));
    expect(below.suppressed).toEqual([]);
    // Past it the copy is not made: the extrude comes in on its own sketch, suppressed.
    const past = mapped(f3d(fit + 1));
    expect(past.suppressed).toEqual([`E${fit}`]);
    expect(past.doc.features.some((f) => f.name === `E${fit} start`)).toBe(false);
    expect(budgetNotes(past.report.notes)).toEqual([
      overBudgetNote(`E${fit}`),
      offsetDroppedNote(`E${fit}`),
    ]);
    expect(past.byName('ExtrudeLast').suppressed).toBe(false);
  });

  it('counts only the sketch copies it makes toward the design size', () => {
    // A sketch of about 6,000 points and curves (240 units a copy): its copies
    // for 16 extrudes would hold more than MAX_IMPORT_ENTITIES; past the
    // budget they are not made, so the design imports.
    const d = washerWithHole();
    d.features[0] = sketch(1, 5, 'Sketch1', [circle(10, 101n, 0.55), circle(20, 102n, 0.21)], {
      lines: 2000,
    });
    const ex = d.features[1] as F3dExtrude;
    for (let k = 0; k < 16; k++)
      d.features.push({
        ...ex,
        id: 200 + k,
        name: `E${k}`,
        parameters: [
          ...ex.parameters,
          parameter({ name: `o${k}`, kind: 'ProfileOffset', value: 0.01 * (k + 1) }),
        ],
      });
    const m = mapped(d);
    const made = m.doc.features.filter((f) => f.name.endsWith(' start')).length;
    expect(made).toBeGreaterThan(0);
    expect(made).toBeLessThan(16);
    expect(m.suppressed).toEqual(Array.from({ length: 16 - made }, (_, k) => `E${made + k}`));
    let entities = 0;
    for (const f of m.doc.features)
      if (f.inputs.sketch?.kind === 'sketchData')
        entities += Object.keys(f.inputs.sketch.sketch.entities).length;
    expect(entities).toBeLessThanOrEqual(MAX_IMPORT_ENTITIES);
    expect(entities * (17 / (made + 1))).toBeGreaterThan(MAX_IMPORT_ENTITIES);
  });
});

describe('sketches no feature uses', () => {
  /** `count` sketches no feature uses, each of a grid of `lines` crossing lines. */
  const loose = (count: number, lines: number): F3dFeature[] =>
    Array.from({ length: count }, (_, k) =>
      sketch(300 + k, 600 + k, `Loose${k}`, [], { lines, crossing: true }),
    );

  it('stay visible below the budget; past it they come in hidden, with one note', () => {
    const few = washerWithHole();
    few.features.push(...loose(2, 20));
    tail(few);
    const a = mapped(few);
    expect(a.hidden).toEqual([]);
    expect(budgetNotes(a.report.notes)).toEqual([]);

    // 20 crossing lines make 81 regions, 16 units a sketch: the later ones are hidden.
    const many = washerWithHole();
    many.features.push(...loose(70, 20));
    tail(many);
    const b = mapped(many);
    expect(b.hidden.length).toBeGreaterThan(0);
    expect(b.hidden.length).toBeLessThan(70);
    expect(b.hidden).toEqual(
      Array.from({ length: 70 }, (_, k) => `Loose${k}`).slice(70 - b.hidden.length),
    );
    expect(budgetNotes(b.report.notes)).toEqual([hiddenSketchesNote(b.hidden)]);
    // A sketch a feature uses is never hidden, and its feature imports.
    expect(b.byName('SketchLast').visible).toBeUndefined();
    expect(b.byName('ExtrudeLast').suppressed).toBe(false);
    expect(b.suppressed).toEqual([]);
  });

  it('share the budget with the features: what they spent first leaves less', () => {
    const f3d = washerWithHole();
    f3d.features.push(pattern(10, 'P1', 1000), ...loose(1, 4));
    const m = mapped(f3d);
    expect(m.suppressed).toEqual([]);
    expect(m.hidden).toEqual(['Loose0']);
  });
});

describe('the sketches of one import', () => {
  // 3.3 s alone, 6.7 s at worst beside four busy cores and the rest of the suite (2026-11-18): the
  // timeout is a watchdog, six times that.
  it(`may have ${MAX_IMPORT_ENTITIES} points and curves; past that the import is refused`, {
    timeout: 40_000,
  }, () => {
    const f3d = (points: number): F3dDesign => {
      const d = washerWithHole();
      d.features.push(
        sketch(20, 70, 'Big1', [], { points: 50_000 }),
        sketch(21, 71, 'Big2', [], { points }),
      );
      return d;
    };
    const count = (doc: { features: Feature[] }) => {
      let n = 0;
      for (const f of doc.features)
        if (f.inputs.sketch?.kind === 'sketchData')
          n += Object.keys(f.inputs.sketch.sketch.entities).length;
      return n;
    };
    const first = count(mapped(f3d(40_000)).doc);
    const fill = 40_000 + MAX_IMPORT_ENTITIES - first;
    expect(count(mapped(f3d(fill)).doc)).toBe(MAX_IMPORT_ENTITIES);
    expect(() => f3dToDesign(f3d(fill + 1), 'Budget')).toThrow(TOO_MANY_ENTITIES);
  });
});

describe("the file's user parameters", () => {
  it('come in all in one step, as one at a time would bring them', () => {
    const f3d = washerWithHole();
    f3d.userParameters = Array.from({ length: 5000 }, (_, i) =>
      parameter({ name: `p${i}`, number: i + 1, expression: `${i} mm`, user: true, value: i / 10 }),
    );
    // A taken name and a unit's name are left out with a note, as before.
    f3d.userParameters.push(
      parameter({ name: 'p7', number: 6000, expression: '1 mm', user: true }),
      parameter({ name: 'mm', number: 6001, expression: '1 mm', user: true }),
      parameter({ name: 'last', number: 6002, expression: '2', unit: '', user: true }),
    );
    const one = vi.spyOn(Design.prototype, 'parameter');
    const { doc, report } = mapped(f3d);
    expect(one).not.toHaveBeenCalled();
    one.mockRestore();
    expect(doc.parameters).toHaveLength(5001);
    expect(doc.parameters[0]).toMatchObject({
      id: 'p1',
      name: 'p0',
      expression: '0 mm',
      unit: 'length',
    });
    // The IDs follow on as one at a time gave them: two for each one left out.
    expect(doc.parameters.at(-1)).toMatchObject({ id: 'p5005', name: 'last', unit: 'unitless' });
    expect(report.notes).toEqual(
      expect.arrayContaining([
        'Parameter p7 skipped: A parameter named "p7" already exists.',
        'Parameter mm skipped: "mm" is a unit, function or constant; pick another name.',
      ]),
    );
  });
});
