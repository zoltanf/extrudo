import { planeFrame, type SketchData, type SketchFrame, sketchToWorld } from '@extrudo/core';
import {
  detectProfiles,
  MAX_DESIGN_FILL_WORK,
  MAX_FILL_VERTICES,
  MAX_FILL_WORK,
  type Profile,
} from '@extrudo/sketch/profiles';
import { ShapeUtils, Vector2, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fillBudget,
  fillCost,
  fillGroups,
  fillLayout,
  fillMatrix,
  fillRuns,
  fillWork,
  MAX_FILL_GROUPS,
  MAX_OUTLINE_POINTS,
  noteUnbuiltFill,
  profileFill,
  regionOutlines,
  sketchesPastFillBudget,
} from './profileFills';

const frame = (id: string) => planeFrame({ kind: 'plane', id }) as SketchFrame;
const tilted: SketchFrame = {
  origin: [12.5, -7, 30],
  x: [Math.SQRT1_2, Math.SQRT1_2, 0],
  y: [0, 0, 1],
  normal: [Math.SQRT1_2, -Math.SQRT1_2, 0],
};

/** A square's four lines. */
function square(id: string, x: number, y: number, s: number): Record<string, unknown> {
  const corners = [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ] as const;
  const out: Record<string, unknown> = {};
  corners.forEach(([px, py], i) => {
    const [qx, qy] = corners[(i + 1) % 4] as readonly [number, number];
    out[`${id}a${i}`] = { type: 'point', x: px, y: py };
    out[`${id}b${i}`] = { type: 'point', x: qx, y: qy };
    out[`${id}l${i}`] = {
      type: 'line',
      start: `${id}a${i}`,
      end: `${id}b${i}`,
      construction: false,
    };
  });
  return out;
}

const circle = (id: string, x: number, y: number, radius: number) => ({
  [`${id}c`]: { type: 'point', x, y },
  [id]: { type: 'circle', center: `${id}c`, radius, construction: false },
});

const spline = (id: string, poles: readonly (readonly [number, number])[]) => ({
  ...Object.fromEntries(poles.map(([x, y], i) => [`${id}p${i}`, { type: 'point', x, y }])),
  [id]: {
    type: 'spline',
    points: poles.map((_, i) => `${id}p${i}`),
    mode: 'control',
    closed: true,
    construction: false,
  },
});

const regions = (entities: Record<string, unknown>): Profile[] =>
  detectProfiles({ entities, constraints: {}, dimensions: {} } as SketchData);

const FIXTURES: Record<string, Profile[]> = {
  'a square': regions(square('o', 0, 0, 10)),
  'a square with a square hole': regions({ ...square('o', 0, 0, 10), ...square('i', 3, 3, 4) }),
  'a plate with holes': regions({
    ...square('o', 0, 0, 100),
    ...circle('h1', 20, 20, 6),
    ...circle('h2', 60, 20, 8),
    ...circle('h3', 40, 70, 12),
  }),
  'crossing squares': regions({ ...square('a', 0, 0, 10), ...square('b', 5, 5, 10) }),
  'nested circles': regions({
    ...circle('c1', 0, 0, 30),
    ...circle('c2', 0, 0, 20),
    ...circle('c3', 0, 0, 10),
  }),
  'a closed spline': regions(
    spline('s', [
      [0, 0],
      [20, -4],
      [40, 10],
      [24, 30],
      [8, 22],
    ]),
  ),
};

/** The triangles as the view built them before fills were kept: world xyz per vertex. */
function worldTriangles(profiles: readonly Profile[], at: SketchFrame): number[][] {
  return profiles.map((profile) => {
    const contour = profile.outer.polygon.map((p) => new Vector2(p[0], p[1]));
    const holes = profile.holes.map((h) => h.polygon.map((p) => new Vector2(p[0], p[1])));
    const all = [...contour, ...holes.flat()];
    const out: number[] = [];
    for (const triangle of ShapeUtils.triangulateShape(contour, holes)) {
      for (const index of triangle) {
        const v = all[index] as Vector2;
        out.push(...sketchToWorld(at, [v.x, v.y]));
      }
    }
    return out;
  });
}

describe('profileFill', () => {
  for (const [name, profiles] of Object.entries(FIXTURES)) {
    it(`draws the same triangles as before: ${name}`, () => {
      expect(profiles.length).toBeGreaterThan(0);
      for (const at of [frame('origin:xy'), frame('origin:xz'), frame('origin:yz'), tilted]) {
        const fill = profileFill(profiles);
        const matrix = fillMatrix(at);
        const before = worldTriangles(profiles, at);
        before.forEach((expected, region) => {
          const start = fill.starts[region] as number;
          const end = fill.starts[region + 1] as number;
          expect((end - start) * 3).toBe(expected.length);
          for (let v = start; v < end; v++) {
            const p = new Vector3(
              fill.positions[v * 3],
              fill.positions[v * 3 + 1],
              fill.positions[v * 3 + 2],
            ).applyMatrix4(matrix);
            const k = (v - start) * 3;
            expect(p.x).toBeCloseTo(expected[k] as number, 4);
            expect(p.y).toBeCloseTo(expected[k + 1] as number, 4);
            expect(p.z).toBeCloseTo(expected[k + 2] as number, 4);
          }
        });
      }
    });

    it(`never costs less than it builds: ${name}`, () => {
      expect(fillCost(profiles)).toBeGreaterThanOrEqual(profileFill(profiles).positions.length / 3);
    });
  }

  it('costs exactly what a plain polygon and a polygon with a hole build', () => {
    for (const name of ['a square', 'a square with a square hole']) {
      const profiles = FIXTURES[name] as Profile[];
      expect(fillCost(profiles)).toBe(profileFill(profiles).positions.length / 3);
    }
  });

  it('never costs less than it builds for jagged polygons with holes', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let round = 0; round < 40; round++) {
      const n = 5 + Math.floor(random() * 40);
      const poles = Array.from({ length: n }, (_, i) => {
        const t = (i / n) * 2 * Math.PI;
        const r = 100 + random() * 40;
        return [r * Math.cos(t), r * Math.sin(t)] as const;
      });
      const holes = Math.floor(random() * 4);
      const entities: Record<string, unknown> = spline('s', poles);
      for (let h = 0; h < holes; h++) {
        Object.assign(entities, circle(`h${h}`, -45 + h * 30, 0, 5 + random() * 5));
      }
      const profiles = regions(entities);
      expect(profiles.length).toBeGreaterThan(0);
      expect(fillCost(profiles)).toBeGreaterThanOrEqual(profileFill(profiles).positions.length / 3);
    }
  });
});

describe('fillRuns', () => {
  const profiles = FIXTURES['a square with a square hole'] as Profile[];
  const [ring, inner] = profiles as [Profile, Profile];
  const fill = profileFill(profiles);
  const shadeOf = (runs: ReturnType<typeof fillRuns>, id: string) => {
    const start = fill.starts[fill.ids.indexOf(id)] as number;
    return runs.find((r) => r.start <= start && start < r.start + r.count)?.shade;
  };

  it('shades the hovered and selected regions apart', () => {
    const runs = fillRuns(fill, inner.id, [ring.id]);
    expect(shadeOf(runs, ring.id)).toBe('selected');
    expect(shadeOf(runs, inner.id)).toBe('hover');
  });

  it('keeps a selected region under the pointer selected', () => {
    expect(shadeOf(fillRuns(fill, ring.id, [ring.id]), ring.id)).toBe('selected');
  });

  it('covers every vertex once, neighbours of one shade in one run', () => {
    const runs = fillRuns(fill, undefined, []);
    expect(runs).toEqual([{ start: 0, count: fill.positions.length / 3, shade: 'normal' }]);
  });
});

describe('sketchesPastFillBudget', () => {
  const square10 = FIXTURES['a square'] as Profile[]; // 6 vertices
  const cost = fillCost(square10);
  const sketch = (
    id: string,
    active = false,
    profiles: readonly Profile[] | undefined = square10,
  ) => ({
    id,
    active,
    ...(profiles && { profiles }),
  });
  const past = (list: Parameters<typeof sketchesPastFillBudget>[0], budget: number) => [
    ...sketchesPastFillBudget(list, budget),
  ];

  it('is the limit of the design unless a test sets another', () => {
    expect(fillBudget()).toBe(MAX_FILL_VERTICES);
    expect(MAX_FILL_VERTICES).toBe(16_000_000);
  });

  it('fits sketches exactly at the budget and refuses one vertex past it', () => {
    expect(cost).toBe(6);
    expect(past([sketch('a'), sketch('b')], cost * 2)).toEqual([]);
    expect(past([sketch('a'), sketch('b')], cost * 2 - 1)).toEqual(['b']);
  });

  it('serves sketches in timeline order', () => {
    expect(past([sketch('a'), sketch('b'), sketch('c')], cost)).toEqual(['b', 'c']);
  });

  it('serves the open sketch first', () => {
    expect(past([sketch('a'), sketch('b', true), sketch('c')], cost)).toEqual(['a', 'c']);
  });

  it('leaves what a sketch past the budget would take to the ones after it', () => {
    const big = FIXTURES['a plate with holes'] as Profile[];
    expect(past([sketch('a', false, big), sketch('b')], cost)).toEqual(['a']);
  });

  it('counts only the sketches it is given: hiding one gives its share back', () => {
    const shown = [sketch('a'), sketch('b'), sketch('c')];
    expect(past(shown, cost * 2)).toEqual(['c']);
    expect(
      past(
        shown.filter((s) => s.id !== 'a'),
        cost * 2,
      ),
    ).toEqual([]);
  });

  it('counts nothing for a sketch whose profiles are not shown', () => {
    expect(past([{ id: 'a', active: false }, sketch('b')], cost)).toEqual([]);
  });

  it('holds the open sketch to the budget too', () => {
    expect(past([sketch('a', true)], cost - 1)).toEqual(['a']);
  });
});

describe('regionOutlines', () => {
  const profiles = FIXTURES['a square with a square hole'] as Profile[];
  const [ring] = profiles as [Profile];

  it('draws every boundary of the region, closed', () => {
    const lines = regionOutlines(profiles, [ring.id], frame('origin:xy'));
    // Four sides outside and four around the hole, two xyz points each.
    expect(lines.length).toBe(8 * 2 * 3);
    expect([...lines.subarray(0, 3)]).toEqual([
      ...lines.subarray(lines.length / 2 - 3, lines.length / 2),
    ]);
  });

  it('draws nothing for no regions', () => {
    expect(regionOutlines(profiles, [], frame('origin:xy'))).toHaveLength(0);
  });

  it('draws a very long boundary coarser, inside the bound', () => {
    const n = MAX_OUTLINE_POINTS * 3;
    const polygon = Array.from({ length: n }, (_, i) => {
      const t = (i / n) * 2 * Math.PI;
      return [Math.cos(t), Math.sin(t)] as [number, number];
    });
    const long = {
      id: 'long',
      area: 1,
      holes: [],
      outer: { edges: [], polygon, area: 1 },
    } as Profile;
    const lines = regionOutlines([long], ['long'], frame('origin:xy'));
    expect(lines.length / 6).toBeLessThanOrEqual(MAX_OUTLINE_POINTS);
    expect(lines.length / 6).toBeGreaterThan(MAX_OUTLINE_POINTS / 2);
  });
});

/** A region by hand: an outline and holes, with no curves behind them. */
function handmade(
  id: string,
  outer: [number, number][],
  holes: [number, number][][] = [],
): Profile {
  const loop = (polygon: [number, number][]) => ({ edges: [], polygon, area: 1 });
  return { id, area: 1, outer: loop(outer), holes: holes.map(loop) } as Profile;
}

const ring = (x: number, y: number, r: number, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI;
    return [x + r * Math.cos(t), y + r * Math.sin(t)] as [number, number];
  });

/** A plate with `holes` round holes of `corners` corners each. */
function plate(holes: number, corners: number): Profile[] {
  const side = Math.ceil(Math.sqrt(holes));
  const size = (side + 1) * 100;
  return [
    handmade(
      'plate',
      [
        [0, 0],
        [size, 0],
        [size, size],
        [0, size],
      ],
      Array.from({ length: holes }, (_, i) =>
        ring(100 + (i % side) * 100, 100 + Math.floor(i / side) * 100, 40, corners),
      ),
    ),
  ];
}

describe('fillWork', () => {
  it('is known without building, and grows with the holes faster than with the corners', () => {
    expect(fillWork(plate(200, 64))).toBeGreaterThan(2.5 * fillWork(plate(100, 64)));
  });

  it('counts the work of every region', () => {
    const one = plate(10, 16);
    const two = [...one, ...plate(10, 16)];
    expect(fillWork(two)).toBeCloseTo(2 * fillWork(one), 3);
  });

  it('counts a thin winding outline far above a round one of as many corners', () => {
    const n = 8000;
    const round = [handmade('round', ring(0, 0, 1000, n))];
    const side = Array.from({ length: n / 2 }, (_, i) => {
      const t = (i / (n / 2)) * 40 * Math.PI;
      const r = 10 + t * 2;
      return [r * Math.cos(t), r * Math.sin(t)] as [number, number];
    });
    const back = side.map(([x, y]) => [x * 1.02, y * 1.02] as [number, number]).reverse();
    const thin = [handmade('thin', [...side, ...back])];
    expect(fillWork(thin)).toBeGreaterThan(100 * fillWork(round));
  });

  it('keeps an ordinary perforated plate inside the limit', () => {
    expect(fillWork(plate(30, 172))).toBeLessThan(MAX_FILL_WORK / 10);
    expect(fillWork(plate(500, 64))).toBeLessThan(MAX_FILL_WORK);
    expect(fillWork(plate(500, 100))).toBeLessThan(MAX_FILL_WORK);
  });

  it('puts a plate of many large holes past the limit', () => {
    expect(fillWork(plate(100, 2048))).toBeGreaterThan(MAX_FILL_WORK);
  });

  it('survives an outline with no area', () => {
    const flat = [
      handmade('flat', [
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ];
    expect(Number.isFinite(fillWork(flat))).toBe(true);
  });
});

describe('sketchesPastFillBudget and the work limits', () => {
  const light = plate(4, 16);
  const heavy = plate(40, 16);
  const limit = fillWork(heavy);
  const sketch = (id: string, profiles: readonly Profile[], active = false) => ({
    id,
    active,
    profiles,
  });
  const past = (
    list: Parameters<typeof sketchesPastFillBudget>[0],
    work: { sketch: number; design: number },
  ) => [...sketchesPastFillBudget(list, MAX_FILL_VERTICES, work)];

  it('passes a fill exactly at the limit and refuses one past it', () => {
    expect(past([sketch('a', heavy)], { sketch: limit, design: 1e12 })).toEqual([]);
    expect(past([sketch('a', heavy)], { sketch: limit - 1, design: 1e12 })).toEqual(['a']);
  });

  it('shares the design limit in the budget order, the open sketch first', () => {
    const work = { sketch: 1e12, design: limit * 1.5 };
    expect(past([sketch('a', heavy), sketch('b', heavy)], work)).toEqual(['b']);
    expect(past([sketch('a', heavy), sketch('b', heavy, true)], work)).toEqual(['a']);
  });

  it('leaves what a refused sketch would have taken to the ones after it', () => {
    const work = { sketch: limit - 1, design: limit };
    expect(past([sketch('a', heavy), sketch('b', light)], work)).toEqual(['a']);
  });

  it('allows the design many fills at the sketch limit', () => {
    expect(MAX_DESIGN_FILL_WORK).toBeGreaterThan(MAX_FILL_WORK);
  });

  it('takes a sketch whose fill could not be built out of the budget', () => {
    const lost = plate(3, 8);
    noteUnbuiltFill(lost);
    const work = { sketch: 1e12, design: 1e12 };
    expect(past([sketch('a', lost), sketch('b', light)], work)).toEqual(['a']);
  });
});

describe('fillBudget', () => {
  afterEach(() => vi.unstubAllGlobals());
  const withHook = (value: unknown) => {
    vi.stubGlobal('window', { __extrudoFillBudget: value });
    return fillBudget();
  };

  it('lets a test lower the budget', () => {
    expect(withHook(6)).toBe(6);
  });

  it('never lets the hook raise it or switch it off', () => {
    for (const value of [Number.POSITIVE_INFINITY, 1e15, MAX_FILL_VERTICES + 1]) {
      expect(withHook(value)).toBe(MAX_FILL_VERTICES);
    }
  });

  it('ignores what is not a positive number', () => {
    for (const value of [-1, 0, Number.NaN, '6', null]) {
      expect(withHook(value)).toBe(MAX_FILL_VERTICES);
    }
  });
});

describe('fillLayout and fillGroups', () => {
  const squares = Array.from({ length: 10_000 }, (_, i) =>
    handmade(`r${i}`, [
      [i, 0],
      [i + 0.5, 0],
      [i + 0.5, 1],
      [i, 1],
    ]),
  );
  const fill = profileFill(squares);
  const alternate = squares.filter((_, i) => i % 2 === 0).map((p) => p.id);

  /** Each shade's vertices as the groups draw them. */
  function drawn(layout: ReturnType<typeof fillLayout>, hover?: string) {
    const out = { normal: [] as number[], hover: [] as number[], selected: [] as number[] };
    for (const run of fillGroups(layout, fill, hover)) {
      for (let k = run.start; k < run.start + run.count; k++) {
        out[run.shade].push(layout.order ? (layout.order[k] as number) : k);
      }
    }
    return out;
  }

  /** The same from the plain list of runs. */
  function expected(hover?: string) {
    const out = { normal: [] as number[], hover: [] as number[], selected: [] as number[] };
    for (const run of fillRuns(fill, hover, alternate)) {
      for (let k = run.start; k < run.start + run.count; k++) out[run.shade].push(k);
    }
    return out;
  }

  const sorted = (list: number[]) => [...list].sort((a, b) => a - b);

  it('draws an alternating selection of 10,000 regions in a bounded number of groups', () => {
    expect(fillRuns(fill, undefined, alternate).length).toBe(10_000);
    const layout = fillLayout(fill, alternate);
    expect(fillGroups(layout, fill, undefined).length).toBeLessThanOrEqual(MAX_FILL_GROUPS);
    expect(fillGroups(layout, fill, 'r1').length).toBeLessThanOrEqual(MAX_FILL_GROUPS);
    // The renderer draws each double-sided transparent group twice.
    expect(MAX_FILL_GROUPS * 2).toBeLessThanOrEqual(64);
  });

  it('gives each shade the same triangles as the plain runs', () => {
    const layout = fillLayout(fill, alternate);
    for (const hover of [undefined, 'r1', 'r0', 'r9999']) {
      const got = drawn(layout, hover);
      const want = expected(hover);
      expect(sorted(got.normal)).toEqual(want.normal);
      expect(sorted(got.hover)).toEqual(want.hover);
      expect(sorted(got.selected)).toEqual(want.selected);
    }
  });

  it('keeps the built order while few groups do', () => {
    const layout = fillLayout(fill, ['r3', 'r4', 'r5']);
    expect(layout.order).toBeUndefined();
    expect(fillGroups(layout, fill, 'r100').length).toBeLessThanOrEqual(MAX_FILL_GROUPS);
    const got = drawn(layout, 'r100');
    const want = fillRuns(fill, 'r100', ['r3', 'r4', 'r5']);
    expect(got.hover).toHaveLength(want.find((r) => r.shade === 'hover')?.count ?? 0);
  });

  it('stays bounded at the most runs that keep the built order', () => {
    const picks = Array.from({ length: 14 }, (_, i) => `r${i * 4 + 1}`);
    const layout = fillLayout(fill, picks);
    expect(layout.order).toBeUndefined();
    for (const hover of ['r0', 'r2', 'r9000']) {
      expect(fillGroups(layout, fill, hover).length).toBeLessThanOrEqual(MAX_FILL_GROUPS);
    }
  });

  it('keeps an order once it has one, and reuses its memory', () => {
    const first = fillLayout(fill, alternate);
    const next = fillLayout(fill, ['r1'], first.order);
    expect(next.order).toBe(first.order);
    expect(next.runs.map((r) => r.shade)).toEqual(['normal', 'selected']);
    expect(sorted([...(next.order as Uint32Array)])).toEqual(
      Array.from({ length: fill.positions.length / 3 }, (_, i) => i),
    );
  });

  it('finds a hovered region without passing over the others', () => {
    const layout = fillLayout(fill, alternate);
    const watched = new Proxy(fill, {
      get(target, key, receiver) {
        if (key === 'ids') throw new Error('a hover read every region');
        return Reflect.get(target, key, receiver);
      },
    });
    expect(fillGroups(layout, watched, 'r1').some((g) => g.shade === 'hover')).toBe(true);
  });

  it('leaves a selected region under the pointer selected', () => {
    const layout = fillLayout(fill, alternate);
    expect(fillGroups(layout, fill, 'r0')).toBe(layout.runs);
    expect(fillGroups(layout, fill, 'nothing')).toBe(layout.runs);
  });
});

describe('regionOutlines, its bound', () => {
  it('never draws more than the bound, however many small loops there are', () => {
    const many = Array.from({ length: 70_000 }, (_, i) =>
      handmade(`t${i}`, [
        [i, 0],
        [i + 0.5, 0],
        [i, 1],
      ]),
    );
    const lines = regionOutlines(
      many,
      many.map((p) => p.id),
      frame('origin:xy'),
    );
    expect(lines.length / 6).toBeLessThanOrEqual(MAX_OUTLINE_POINTS);
    expect(lines.length).toBeGreaterThan(0);
  });
});
