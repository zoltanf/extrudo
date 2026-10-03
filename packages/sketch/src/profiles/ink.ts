/**
 * Point-in-region queries for text ink (P4-03, ADR-0058 §5). Pure planar
 * geometry on polylines; no WASM. The winding-number rule decides whether a
 * detected region is ink of a text: overlapping glyph contours (letters
 * touching, fonts with overlaps) split into pieces that are all ink, while
 * counters (inside an `o`) have winding 0 and stay ordinary islands.
 */
import type { Vec2 } from '@extrudo/core';

/** Signed side of `p` relative to the directed line a → b: > 0 left, < 0 right. */
function isLeft(a: Vec2, b: Vec2, p: Vec2): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
}

/** Drops a repeated closing point and consecutive duplicates. */
function openRing(ring: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

function signedArea(ring: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] as Vec2;
    const b = ring[i] as Vec2;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/**
 * The winding number of `p` with respect to closed polylines. Each contour
 * is a list of points; the closing edge from the last point back to the
 * first is implied (a contour may also repeat its first point at the end;
 * treat that the same). Counter-clockwise contours count +1 around a point
 * inside them, clockwise ones −1; the result is the sum over all contours.
 */
export function windingNumber(p: Vec2, contours: readonly (readonly Vec2[])[]): number {
  let wn = 0;
  for (const contour of contours) {
    const ring = openRing(contour);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Vec2;
      const b = ring[(i + 1) % ring.length] as Vec2;
      if (a[1] <= p[1]) {
        if (b[1] > p[1] && isLeft(a, b, p) > 0) wn++;
      } else {
        if (b[1] <= p[1] && isLeft(a, b, p) < 0) wn--;
      }
    }
  }
  return wn;
}

/** Distance from `p` to the segment a → b. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** X where the edge a → b crosses the horizontal line at height y (a[1] ≠ b[1], y strictly between). */
function crossingX(a: Vec2, b: Vec2, y: number): number {
  const t = (y - a[1]) / (b[1] - a[1]);
  return a[0] + t * (b[0] - a[0]);
}

/** Crossings of a horizontal line at `y` with a ring's edges, sorted; y is strictly between vertex heights. */
function crossings(ring: readonly Vec2[], y: number): number[] {
  const out: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] as Vec2;
    const b = ring[i] as Vec2;
    if ((a[1] < y && b[1] > y) || (b[1] < y && a[1] > y)) out.push(crossingX(a, b, y));
  }
  return out.sort((m, n) => m - n);
}

/** Free sub-intervals of [lo, hi] after removing the given blocked spans. */
function freeIntervals(
  lo: number,
  hi: number,
  blocked: readonly [number, number][],
): [number, number][] {
  let free: [number, number][] = [[lo, hi]];
  for (const [b0, b1] of blocked) {
    const next: [number, number][] = [];
    for (const [f0, f1] of free) {
      if (b1 <= f0 || b0 >= f1) {
        next.push([f0, f1]);
        continue;
      }
      if (b0 > f0) next.push([f0, Math.min(b0, f1)]);
      if (b1 < f1) next.push([Math.max(b1, f0), f1]);
    }
    free = next;
  }
  return free.filter(([f0, f1]) => f1 - f0 > 1e-12);
}

function minEdgeDistance(p: Vec2, rings: readonly (readonly Vec2[])[]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const d = distToSegment(p, ring[j] as Vec2, ring[i] as Vec2);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * A point strictly inside the region bounded by `outer` and outside every
 * hole (any direction), at least `margin` from every edge where the region
 * allows it. Use a horizontal scan line through no vertex, intersect it with
 * all edges, return the middle of the widest interval inside `outer` and
 * outside the holes; try several heights and keep the best. `undefined` for
 * a region without area (fewer than three distinct points, or collinear).
 */
export function interiorPoint(
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
  margin = 0,
): Vec2 | undefined {
  const ring = openRing(outer);
  if (ring.length < 3 || Math.abs(signedArea(ring)) < 1e-12) return undefined;
  const holeRings = holes.map(openRing).filter((h) => h.length >= 3);
  const allRings: (readonly Vec2[])[] = [ring, ...holeRings];

  // Scan heights: midpoints between consecutive distinct vertex heights of
  // every ring, so no scan line passes through a vertex. Gaps smaller than
  // this (floating-point noise between duplicate vertices) are skipped: a
  // height that close to a vertex can give a broken crossing count.
  const NOISE = 1e-9;
  const ys = [...new Set(allRings.flatMap((r) => r.map((p) => p[1])))].sort((m, n) => m - n);
  const heights: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    const gap = (ys[i] as number) - (ys[i - 1] as number);
    if (gap > NOISE) heights.push(((ys[i - 1] as number) + (ys[i] as number)) / 2);
  }

  let best: { point: Vec2; width: number; ok: boolean } | undefined;
  for (const y of heights) {
    const outerX = crossings(ring, y);
    // A strict between-test on a line through no vertex gives an even count;
    // an odd count means the line grazed a vertex: skip the height.
    if (outerX.length < 2 || outerX.length % 2 !== 0) continue;
    const blocked: [number, number][] = [];
    let usable = true;
    for (const hole of holeRings) {
      const hx = crossings(hole, y);
      if (hx.length % 2 !== 0) {
        usable = false;
        break;
      }
      for (let i = 0; i + 1 < hx.length; i += 2) {
        blocked.push([hx[i] as number, hx[i + 1] as number]);
      }
    }
    if (!usable) continue;
    for (let i = 0; i + 1 < outerX.length; i += 2) {
      for (const [f0, f1] of freeIntervals(outerX[i] as number, outerX[i + 1] as number, blocked)) {
        const point: Vec2 = [(f0 + f1) / 2, y];
        const width = f1 - f0;
        const ok = minEdgeDistance(point, allRings) >= margin;
        if (!best || (ok && !best.ok) || (ok === best.ok && width > best.width)) {
          best = { point, width, ok };
        }
      }
    }
  }
  return best?.point;
}
