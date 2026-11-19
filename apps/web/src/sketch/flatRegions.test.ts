import type { SketchData, Vec2 } from '@extrudo/core';
import type { Profile } from '@extrudo/sketch/profiles';
import { detectProfiles, profileAt } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import { profileFill } from '../viewport/profileFills';
import {
  flatBytesOf,
  flattenRegions,
  fromWire,
  holeCount,
  regionAt,
  regionIndex,
  regionOutline,
  regionsBytes,
  toWire,
} from './flatRegions';
import { buildFill, findRegions } from './regionsJob';

/** A square's four lines. */
function square(id: string, x: number, y: number, s: number): Record<string, unknown> {
  const c = [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ] as const;
  const out: Record<string, unknown> = {};
  c.forEach(([px, py], i) => {
    const [qx, qy] = c[(i + 1) % 4] as readonly [number, number];
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
const sketch = (entities: Record<string, unknown>) =>
  ({ entities, constraints: {}, dimensions: {} }) as unknown as SketchData;

const FIXTURES: Record<string, SketchData> = {
  'a plate with holes': sketch({
    ...square('o', 0, 0, 100),
    ...circle('h1', 20, 20, 6),
    ...circle('h2', 60, 20, 8),
    ...circle('h3', 40, 70, 12),
  }),
  'crossing squares': sketch({ ...square('a', 0, 0, 10), ...square('b', 5, 5, 10) }),
  'nested circles': sketch({
    ...circle('c1', 0, 0, 30),
    ...circle('c2', 0, 0, 20),
    ...circle('c3', 0, 0, 10),
  }),
  'squares side by side': sketch({ ...square('a', 0, 0, 10), ...square('b', 10, 0, 10) }),
};

describe('flattenRegions', () => {
  for (const [name, data] of Object.entries(FIXTURES)) {
    const profiles = detectProfiles(data);
    const flat = flattenRegions(profiles);

    it(`keeps every region, loop and point: ${name}`, () => {
      expect(flat.ids).toEqual(profiles.map((p) => p.id));
      expect([...flat.areas]).toEqual(profiles.map((p) => p.area));
      expect(holeCount(flat)).toBe(profiles.reduce((n, p) => n + p.holes.length, 0));
      profiles.forEach((p, i) => {
        expect(regionOutline(flat, i)).toEqual(p.outer.polygon);
        expect(regionIndex(flat).get(p.id)).toBe(i);
      });
      expect(regionsBytes(flat)).toBe(flatBytesOf(profiles));
    });

    it(`finds the same region as profileAt everywhere: ${name}`, () => {
      for (let x = -40; x <= 120; x += 0.73) {
        for (let y = -40; y <= 120; y += 0.91) {
          const p: Vec2 = [x, y];
          const at = regionAt(flat, p);
          expect(at === undefined ? undefined : flat.ids[at]).toBe(profileAt(profiles, p)?.id);
        }
      }
    });
  }

  it('finds a point on a shared edge or corner as profileAt does', () => {
    const profiles = detectProfiles(FIXTURES['squares side by side'] as SketchData);
    const flat = flattenRegions(profiles);
    for (const p of [
      [10, 5],
      [10, 0],
      [10, 10],
      [0, 0],
      [20, 10],
      [5, 10],
    ] as Vec2[]) {
      const at = regionAt(flat, p);
      expect(at === undefined ? undefined : flat.ids[at]).toBe(profileAt(profiles, p)?.id);
    }
  });
});

describe('findRegions and buildFill, as the profile worker runs them', () => {
  it('builds the same triangles as profileFill, bit for bit, also after a transfer', () => {
    for (const data of Object.values(FIXTURES)) {
      const found = findRegions(data);
      if ('refused' in found) throw new Error('refused');
      const fill = buildFill(found) as NonNullable<ReturnType<typeof buildFill>>;
      const crossed = structuredClone(fill, {
        transfer: [fill.positions.buffer, fill.starts.buffer],
      });
      const reference = profileFill(detectProfiles(data));
      expect(crossed.positions).toEqual(reference.positions);
      expect(crossed.starts).toEqual(reference.starts);
      expect(found.regionBytes).toBe(regionsBytes(found.regions));
    }
  });

  it('says why detection refused a sketch', () => {
    const far = sketch(square('f', 1e12, 0, 10));
    expect(findRegions(far)).toEqual({ refused: expect.stringMatching(/too large/) });
  });
});

describe('strings in flat regions', () => {
  /** Regions by hand: `n` unit squares with these IDs and texts. */
  const made = (n: number, id: (i: number) => string, text: (i: number) => string | undefined) =>
    Array.from({ length: n }, (_, i) => {
      const polygon: Vec2[] = [
        [i, 0],
        [i + 0.5, 0],
        [i + 0.5, 1],
        [i, 1],
      ];
      const t = text(i);
      return {
        id: id(i),
        area: 0.5,
        holes: [],
        outer: { edges: [], polygon, area: 0.5 },
        ...(t && { text: t }),
      } as unknown as Profile;
    });

  /** What the strings really keep on the receiving side: two bytes a character at most, once each. */
  const realStrings = (regions: ReturnType<typeof flattenRegions>) =>
    [...new Set([...regions.ids, ...regions.texts].filter((t) => t !== ''))].reduce(
      (n, t) => n + 2 * t.length,
      0,
    );

  for (const [name, n, length] of [
    ['100 glyph regions of a text with a 100,000-character ID', 100, 100_000],
    ['400 glyph regions of a text with a 20,000-character ID', 400, 20_000],
  ] as const) {
    it(`sends a shared text ID once and counts it at its size: ${name}`, () => {
      const long = 't'.repeat(length);
      const regions = flattenRegions(
        made(
          n,
          (i) => `r${i}`,
          () => long,
        ),
      );
      const wire = toWire(regions);
      expect(wire.strings.filter((s) => s === long)).toHaveLength(1);
      expect(fromWire(wire).texts).toEqual(regions.texts);
      expect(regionsBytes(regions)).toBeGreaterThanOrEqual(realStrings(regions));
      expect(regionsBytes(regions)).toBe(
        flatBytesOf(
          made(
            n,
            (i) => `r${i}`,
            () => long,
          ),
        ),
      );
    });
  }

  it('counts long region IDs at their size too', () => {
    const regions = flattenRegions(
      made(
        50,
        (i) => `${'r'.repeat(10_000)}${i}`,
        () => undefined,
      ),
    );
    expect(regionsBytes(regions)).toBeGreaterThanOrEqual(realStrings(regions));
    expect(fromWire(toWire(regions)).ids).toEqual(regions.ids);
  });

  it('takes no place outside the strings', () => {
    const wire = toWire(
      flattenRegions(
        made(
          2,
          (i) => `r${i}`,
          () => 'text',
        ),
      ),
    );
    expect(() => fromWire({ ...wire, idOf: Uint32Array.from([0, 9]) })).toThrow(RangeError);
    expect(() => fromWire({ ...wire, textOf: Int32Array.from([0, -2]) })).toThrow(RangeError);
  });

  it('gives region IDs a fixed short length, as detection hashes them', () => {
    const ids = detectProfiles(FIXTURES['a plate with holes'] as SketchData).map((p) => p.id);
    expect(Math.max(...ids.map((id) => id.length))).toBeLessThanOrEqual(11);
  });
});
