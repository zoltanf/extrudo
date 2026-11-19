/**
 * A sketch's regions as flat typed arrays (ADR-0154): what the profile worker
 * hands back and what the UI thread keeps of a sketch that isn't open. Picking
 * (`regionAt`, `regionOutline`), marked outlines and the regions' memory budget
 * read these, so no `Profile` object of a closed sketch lives on the UI thread.
 * The arrays cross from the worker as transfers.
 */
import type { Vec2 } from '@extrudo/core';
import type { Profile } from '@extrudo/sketch/profiles';

export interface FlatRegions {
  /** Region IDs, in detection order (largest first, as `detectProfiles` gives them). */
  ids: readonly string[];
  /** The text entity a region is ink of (`Profile.text`), '' for none. */
  texts: readonly string[];
  /** Each region's area, mm². */
  areas: Float64Array;
  /** Each region's first loop (the outer loop, then its holes), then the number of loops. */
  loops: Uint32Array;
  /** Each loop's first point, then the number of points. */
  points: Uint32Array;
  /** x and y of every point, loop after loop. */
  xy: Float64Array;
  /** Each region's outer loop box: x0, y0, x1, y1. */
  boxes: Float64Array;
}

/** What a string of the lists keeps, by estimate: the string and its slot. */
const STRING_BYTES = 40;

/** What the flat form of these regions will keep, known before it is made. */
export function flatBytesOf(profiles: readonly Profile[]): number {
  let points = 0;
  let loops = 0;
  for (const p of profiles) {
    loops += 1 + p.holes.length;
    points += p.outer.polygon.length;
    for (const h of p.holes) points += h.polygon.length;
  }
  return flatBytes(profiles.length, loops, points);
}

function flatBytes(regions: number, loops: number, points: number): number {
  return 16 * points + 4 * (loops + 1) + regions * (8 + 4 + 32 + 2 * STRING_BYTES) + 4;
}

/** What these flat regions keep. */
export function regionsBytes(regions: FlatRegions): number {
  return flatBytes(regions.ids.length, regions.points.length - 1, regions.xy.length / 2);
}

/** The regions as flat arrays. */
export function flattenRegions(profiles: readonly Profile[]): FlatRegions {
  let points = 0;
  let loopCount = 0;
  for (const p of profiles) {
    loopCount += 1 + p.holes.length;
    points += p.outer.polygon.length;
    for (const h of p.holes) points += h.polygon.length;
  }
  const xy = new Float64Array(points * 2);
  const loops = new Uint32Array(profiles.length + 1);
  const starts = new Uint32Array(loopCount + 1);
  const areas = new Float64Array(profiles.length);
  const boxes = new Float64Array(profiles.length * 4);
  let loop = 0;
  let at = 0;
  profiles.forEach((profile, i) => {
    loops[i] = loop;
    areas[i] = profile.area;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    [profile.outer, ...profile.holes].forEach((l, k) => {
      starts[loop++] = at / 2;
      for (const p of l.polygon) {
        xy[at++] = p[0];
        xy[at++] = p[1];
        if (k === 0) {
          if (p[0] < x0) x0 = p[0];
          if (p[0] > x1) x1 = p[0];
          if (p[1] < y0) y0 = p[1];
          if (p[1] > y1) y1 = p[1];
        }
      }
    });
    boxes.set([x0, y0, x1, y1], i * 4);
  });
  loops[profiles.length] = loop;
  starts[loopCount] = at / 2;
  return {
    ids: profiles.map((p) => p.id),
    texts: profiles.map((p) => p.text ?? ''),
    areas,
    loops,
    points: starts,
    xy,
    boxes,
  };
}

/** How many loops of the regions are holes. */
export function holeCount(regions: FlatRegions): number {
  return regions.points.length - 1 - regions.ids.length;
}

/** `insidePolygon` on one loop of the flat points: the same crossings, the same answer. */
function insideLoop(regions: FlatRegions, loop: number, p: Vec2): boolean {
  const { xy } = regions;
  const start = regions.points[loop] as number;
  const end = regions.points[loop + 1] as number;
  let inside = false;
  for (let i = start, j = end - 1; i < end; j = i++) {
    const ax = xy[i * 2] as number;
    const ay = xy[i * 2 + 1] as number;
    const bx = xy[j * 2] as number;
    const by = xy[j * 2 + 1] as number;
    if (ay > p[1] !== by > p[1]) {
      const x = ax + ((p[1] - ay) * (bx - ax)) / (by - ay);
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * The region at `p` (sketch mm), as `profileAt` finds it: the first in order
 * inside its outer loop and none of its holes. A region whose box can't hold
 * the point is passed over: rows exactly, sideways by more than rounding.
 */
export function regionAt(regions: FlatRegions, p: Vec2): number | undefined {
  const { boxes } = regions;
  for (let i = 0; i < regions.ids.length; i++) {
    const y0 = boxes[i * 4 + 1] as number;
    const y1 = boxes[i * 4 + 3] as number;
    if (!(p[1] >= y0 && p[1] < y1)) continue;
    const x1 = boxes[i * 4 + 2] as number;
    if (p[0] > x1 + 1e-9 * (Math.abs(x1) + 1)) continue;
    const first = regions.loops[i] as number;
    const last = regions.loops[i + 1] as number;
    if (!insideLoop(regions, first, p)) continue;
    let inHole = false;
    for (let l = first + 1; l < last && !inHole; l++) inHole = insideLoop(regions, l, p);
    if (!inHole) return i;
  }
  return undefined;
}

/** The outer loop of region `i`, as points. */
export function regionOutline(regions: FlatRegions, i: number): Vec2[] {
  const loop = regions.loops[i] as number;
  const out: Vec2[] = [];
  for (let k = regions.points[loop] as number; k < (regions.points[loop + 1] as number); k++) {
    out.push([regions.xy[k * 2] as number, regions.xy[k * 2 + 1] as number]);
  }
  return out;
}

const indexes = new WeakMap<FlatRegions, ReadonlyMap<string, number>>();

/** Each region's place by ID (the first, should two share one). */
export function regionIndex(regions: FlatRegions): ReadonlyMap<string, number> {
  let known = indexes.get(regions);
  if (!known) {
    const map = new Map<string, number>();
    regions.ids.forEach((id, i) => {
      if (!map.has(id)) map.set(id, i);
    });
    known = map;
    indexes.set(regions, known);
  }
  return known;
}

let lastOpen: { profiles: readonly Profile[]; regions: FlatRegions } | undefined;

/**
 * The open sketch's regions, flat: made again only for a new list of regions,
 * and only the last list is kept (the undo history keeps old lists alive).
 */
export function openRegions(profiles: readonly Profile[]): FlatRegions {
  if (lastOpen?.profiles !== profiles) lastOpen = { profiles, regions: flattenRegions(profiles) };
  return lastOpen.regions;
}
