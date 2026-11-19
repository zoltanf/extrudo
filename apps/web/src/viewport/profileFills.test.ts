import { planeFrame, type SketchData, type SketchFrame, sketchToWorld } from '@extrudo/core';
import {
  detectProfiles,
  MAX_FILL_WORK,
  MAX_REGION_BYTES,
  type Profile,
} from '@extrudo/sketch/profiles';
import { ShapeUtils, Vector2, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flattenRegions } from '../sketch/flatRegions';
import {
  fillCost,
  fillFailed,
  fillGroups,
  fillLayout,
  fillMatrix,
  fillRuns,
  fillWork,
  grantedBytes,
  MAX_FILL_GROUPS,
  MAX_OUTLINE_POINTS,
  noteUnbuiltFill,
  profileFill,
  regionBudget,
  regionOutlines,
  regionVerdicts,
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

describe('regionOutlines', () => {
  const profiles = FIXTURES['a square with a square hole'] as Profile[];
  const [ring] = profiles as [Profile];

  it('draws every boundary of the region, closed', () => {
    const lines = regionOutlines(flattenRegions(profiles), [ring.id], frame('origin:xy'));
    // Four sides outside and four around the hole, two xyz points each.
    expect(lines.length).toBe(8 * 2 * 3);
    expect([...lines.subarray(0, 3)]).toEqual([
      ...lines.subarray(lines.length / 2 - 3, lines.length / 2),
    ]);
  });

  it('draws nothing for no regions', () => {
    expect(regionOutlines(flattenRegions(profiles), [], frame('origin:xy'))).toHaveLength(0);
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
    const lines = regionOutlines(flattenRegions([long]), ['long'], frame('origin:xy'));
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
      flattenRegions(many),
      many.map((p) => p.id),
      frame('origin:xy'),
    );
    expect(lines.length / 6).toBeLessThanOrEqual(MAX_OUTLINE_POINTS);
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('regionVerdicts', () => {
  const claim = (
    id: string,
    regionBytes: number,
    fillBytes: number,
    active = false,
    fillable = true,
  ) => ({
    id,
    active,
    regionBytes,
    fillBytes,
    fillable,
  });
  const of = (m: Map<string, string>) => Object.fromEntries(m);

  it('is the limit of the design unless a test lowers it', () => {
    expect(regionBudget()).toBe(MAX_REGION_BYTES);
    expect(MAX_REGION_BYTES).toBe(256 * 1024 * 1024);
  });

  it('gives a sketch its fill and regions exactly at the budget, its regions alone one byte short', () => {
    expect(of(regionVerdicts([claim('a', 10, 90)], 100))).toEqual({ a: 'shaded' });
    expect(of(regionVerdicts([claim('a', 10, 90)], 99))).toEqual({ a: 'pickable' });
    expect(of(regionVerdicts([claim('a', 10, 90)], 9))).toEqual({ a: 'none' });
  });

  it('serves the open sketch first, then the timeline order, passing over what does not fit', () => {
    const list = [claim('a', 10, 50), claim('b', 10, 50, true), claim('c', 5, 5)];
    expect(of(regionVerdicts(list, 80))).toEqual({ b: 'shaded', a: 'pickable', c: 'shaded' });
  });

  it('counts only the sketches it is given: hiding one gives its share back', () => {
    const list = [claim('a', 10, 40), claim('b', 10, 40)];
    expect(of(regionVerdicts(list, 60))).toEqual({ a: 'shaded', b: 'pickable' });
    expect(of(regionVerdicts(list.slice(1), 60))).toEqual({ b: 'shaded' });
  });

  it('never shades a sketch that may not have a fill', () => {
    expect(of(regionVerdicts([claim('a', 10, 10, false, false)], 100))).toEqual({ a: 'pickable' });
  });

  it('keeps the others as they were when the open sketch grows during a drag', () => {
    const at = (open: number) => [
      claim('a', 10, 30),
      claim('o', 10, open, true),
      claim('b', 10, 30),
    ];
    const first = regionVerdicts(at(20), 100);
    const held = grantedBytes(at(20)[1] as never, first.get('o'));
    expect(of(first)).toEqual({ o: 'shaded', a: 'shaded', b: 'pickable' });
    for (const open of [25, 35, 60, 15]) {
      const next = regionVerdicts(at(open), 100, held);
      expect(next.get('a')).toBe('shaded');
      expect(next.get('b')).toBe('pickable');
    }
    // The open sketch alone loses its fill when it outgrows what it had.
    expect(regionVerdicts(at(60), 100, held).get('o')).toBe('pickable');
  });

  it('notes a fill that could not be built', () => {
    const lost = [
      detectProfiles({
        entities: square('z', 0, 0, 1),
        constraints: {},
        dimensions: {},
      } as SketchData),
    ];
    expect(fillFailed(lost[0] as never)).toBe(false);
    noteUnbuiltFill(lost[0] as never);
    expect(fillFailed(lost[0] as never)).toBe(true);
  });
});

describe('regionBudget', () => {
  afterEach(() => vi.unstubAllGlobals());
  const withHook = (value: unknown) => {
    vi.stubGlobal('window', { __extrudoRegionBudget: value });
    return regionBudget();
  };

  it('lets a test lower the budget', () => {
    expect(withHook(600)).toBe(600);
  });

  it('never lets the hook raise it or switch it off', () => {
    for (const value of [Number.POSITIVE_INFINITY, 1e15, MAX_REGION_BYTES + 1]) {
      expect(withHook(value)).toBe(MAX_REGION_BYTES);
    }
  });

  it('ignores what is not a positive number', () => {
    for (const value of [-1, 0, Number.NaN, '6', null]) {
      expect(withHook(value)).toBe(MAX_REGION_BYTES);
    }
  });
});
