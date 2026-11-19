/**
 * Sketch fills (P1-11, ADR-0020's amendment of 2026-11-19): a sketch's regions
 * as triangles in its own coordinates, built once per list of regions. The
 * mesh's matrix places them and each region's range of vertices takes its
 * shade, so a new frame, a hover or a selection builds nothing. A design's
 * fills share `MAX_FILL_VERTICES`.
 */
import { type SketchFrame, sketchToWorld } from '@extrudo/core';
import { MAX_FILL_VERTICES, type Profile, type ProfileLoop } from '@extrudo/sketch/profiles';
import { Matrix4, ShapeUtils, Vector2, Vector3 } from 'three';
import type { ProfileShade } from './sketchGeometry';

declare global {
  interface Window {
    /** A smaller budget for fills, set by e2e tests before the app loads. */
    __extrudoFillBudget?: number;
  }
}

export interface ProfileFill {
  /** xyz per vertex in sketch mm (z is 0), three vertices per triangle, region after region. */
  positions: Float32Array;
  /** The regions' IDs, in the order of their vertices. */
  ids: readonly string[];
  /** The vertex each region starts at, then the number of vertices. */
  starts: Uint32Array;
}

/** A stretch of vertices drawn in one shade. */
export interface FillRun {
  start: number;
  count: number;
  shade: ProfileShade;
}

const costs = new WeakMap<readonly Profile[], number>();

/**
 * The most vertices `profileFill` can make of these regions, known without
 * building them: a polygon of n corners is n − 2 triangles, and each hole
 * adds its corners and two more for the bridge to it.
 */
export function fillCost(profiles: readonly Profile[]): number {
  const known = costs.get(profiles);
  if (known !== undefined) return known;
  let cost = 0;
  for (const profile of profiles) {
    let corners = profile.outer.polygon.length;
    for (const hole of profile.holes) corners += hole.polygon.length + 2;
    cost += 3 * Math.max(0, corners - 2);
  }
  costs.set(profiles, cost);
  return cost;
}

/** The regions as triangles in sketch coordinates. */
export function profileFill(profiles: readonly Profile[]): ProfileFill {
  const positions = new Float32Array(fillCost(profiles) * 3);
  const starts = new Uint32Array(profiles.length + 1);
  let at = 0;
  profiles.forEach((profile, i) => {
    starts[i] = at / 3;
    const contour = profile.outer.polygon.map((p) => new Vector2(p[0], p[1]));
    const holes = profile.holes.map((h) => h.polygon.map((p) => new Vector2(p[0], p[1])));
    const all = [...contour, ...holes.flat()];
    for (const triangle of ShapeUtils.triangulateShape(contour, holes)) {
      for (const index of triangle) {
        const v = all[index] as Vector2;
        positions[at] = v.x;
        positions[at + 1] = v.y;
        at += 3;
      }
    }
  });
  starts[profiles.length] = at / 3;
  return {
    positions: at === positions.length ? positions : positions.slice(0, at),
    ids: profiles.map((p) => p.id),
    starts,
  };
}

/** The fill's vertices by shade, neighbours of one shade together. A selected region under the pointer stays `selected`. */
export function fillRuns(
  fill: ProfileFill,
  hover: string | undefined,
  selected: readonly string[],
): FillRun[] {
  const chosen = new Set(selected);
  const runs: FillRun[] = [];
  fill.ids.forEach((id, i) => {
    const start = fill.starts[i] as number;
    const count = (fill.starts[i + 1] as number) - start;
    if (count === 0) return;
    const shade = chosen.has(id) ? 'selected' : id === hover ? 'hover' : 'normal';
    const last = runs[runs.length - 1];
    if (last?.shade === shade) last.count += count;
    else runs.push({ start, count, shade });
  });
  return runs;
}

/** What puts sketch coordinates in the world. */
export function fillMatrix(frame: SketchFrame): Matrix4 {
  return new Matrix4()
    .makeBasis(new Vector3(...frame.x), new Vector3(...frame.y), new Vector3(...frame.normal))
    .setPosition(...frame.origin);
}

/** The budget for a design's fills. */
export function fillBudget(): number {
  return (typeof window !== 'undefined' && window.__extrudoFillBudget) || MAX_FILL_VERTICES;
}

/**
 * The sketches past the budget. The open sketch is served first, then the
 * others in the order given (the timeline's); a sketch that doesn't fit leaves
 * what it would have taken to those after it. Only the sketches passed in
 * count: a hidden one is not drawn, so it takes nothing.
 */
export function sketchesPastFillBudget(
  sketches: readonly { id: string; active: boolean; profiles?: readonly Profile[] }[],
  budget: number = fillBudget(),
): ReadonlySet<string> {
  const past = new Set<string>();
  let left = budget;
  const take = (sketch: (typeof sketches)[number]) => {
    const cost = sketch.profiles ? fillCost(sketch.profiles) : 0;
    if (cost > left) past.add(sketch.id);
    else left -= cost;
  };
  for (const sketch of sketches) if (sketch.active) take(sketch);
  for (const sketch of sketches) if (!sketch.active) take(sketch);
  return past;
}

/** The most points of a sketch's outlines drawn at once: past it, they are drawn coarser. */
export const MAX_OUTLINE_POINTS = 100_000;

/**
 * The boundaries of the regions `ids` as world-space line segments (xyz
 * pairs): how a sketch without a fill marks a hovered or selected region.
 */
export function regionOutlines(
  profiles: readonly Profile[],
  ids: readonly string[],
  frame: SketchFrame,
): Float32Array {
  const chosen = new Set(ids);
  const loops: ProfileLoop[] = [];
  let points = 0;
  for (const profile of profiles) {
    if (!chosen.has(profile.id)) continue;
    for (const loop of [profile.outer, ...profile.holes]) {
      loops.push(loop);
      points += loop.polygon.length;
    }
  }
  const stride = Math.max(1, Math.ceil(points / MAX_OUTLINE_POINTS));
  const out: number[] = [];
  for (const { polygon } of loops) {
    const corners = polygon.filter((_, i) => i % stride === 0);
    if (corners.length < 2) continue;
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % corners.length] as typeof p;
      out.push(...sketchToWorld(frame, p), ...sketchToWorld(frame, q));
    });
  }
  return new Float32Array(out);
}
