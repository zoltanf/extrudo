import type { SketchData, Vec2 } from '@extrudo/core';
import { detectProfiles, profileAt } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import { profileFill } from '../viewport/profileFills';
import {
  flatBytesOf,
  flattenRegions,
  holeCount,
  regionAt,
  regionIndex,
  regionOutline,
  regionsBytes,
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
