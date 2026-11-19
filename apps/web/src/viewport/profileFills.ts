/**
 * Sketch fills (P1-11, ADR-0020's amendment of 2026-11-19): a sketch's regions
 * as triangles in its own coordinates, built once per list of regions. The
 * mesh's matrix places them and each region's range of vertices takes its
 * shade, so a new frame, a hover or a selection builds nothing. A design's
 * fills share `MAX_FILL_VERTICES`, and a fill that would take too long to build
 * (`MAX_FILL_WORK`, `MAX_DESIGN_FILL_WORK`) is not built.
 */
import { type SketchFrame, sketchToWorld } from '@extrudo/core';
import {
  MAX_DESIGN_FILL_WORK,
  MAX_FILL_VERTICES,
  MAX_FILL_WORK,
  type Profile,
  type ProfileLoop,
} from '@extrudo/sketch/profiles';
import { Matrix4, Vector3 } from 'three';
import { Earcut } from 'three/src/extras/Earcut.js';
import { createStore } from 'zustand/vanilla';
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
  /** Each region's place in `ids`. */
  regions: ReadonlyMap<string, number>;
}

/** A stretch of vertices drawn in one shade. */
export interface FillRun {
  start: number;
  count: number;
  shade: ProfileShade;
}

const costs = new WeakMap<readonly Profile[], number>();
const works = new WeakMap<readonly Profile[], number>();

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

/**
 * How thin and winding an outline is: its perimeter squared over 4π times its
 * area, 1 for a circle.
 */
function thinness(polygon: readonly (readonly number[])[]): number {
  let perimeter = 0;
  let area = 0;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length] as readonly number[];
    const [x0 = 0, y0 = 0] = p;
    const [x1 = 0, y1 = 0] = q;
    perimeter += Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
    area += x0 * y1 - x1 * y0;
  });
  return (perimeter * perimeter) / (2 * Math.PI * Math.abs(area));
}

/**
 * What building these regions' triangles takes, known without building them:
 * each corner is looked at again for every hole, for three corners of the
 * average hole (a single hole costs a near constant instead), and for how thin
 * the outline is, up to once per corner.
 * `MAX_FILL_WORK` says how this follows the time.
 */
export function fillWork(profiles: readonly Profile[]): number {
  const known = works.get(profiles);
  if (known !== undefined) return known;
  let work = 0;
  for (const profile of profiles) {
    const holes = profile.holes.length;
    let inHoles = 0;
    for (const hole of profile.holes) inHoles += hole.polygon.length;
    const corners = profile.outer.polygon.length + inHoles;
    const thin = thinness(profile.outer.polygon);
    const winding = Number.isFinite(thin) ? Math.min(corners, thin) : corners;
    const perHole = holes > 0 ? inHoles / holes : 0;
    const bridged = holes > 1 ? 3 * perHole : holes === 1 ? 230 + 0.1 * perHole : 0;
    work += corners * (holes + bridged + winding);
  }
  works.set(profiles, work);
  return work;
}

/** A region's corners as the triangulator reads them, with where each hole starts. */
function regionCorners(profile: Profile): { flat: Float64Array; holes: number[] } {
  const loops = [profile.outer.polygon, ...profile.holes.map((h) => h.polygon)].map((polygon) => {
    const last = polygon[polygon.length - 1];
    const first = polygon[0];
    // A loop that repeats its first corner at the end has that corner once.
    const repeats = polygon.length > 2 && last?.[0] === first?.[0] && last?.[1] === first?.[1];
    return { polygon, length: repeats ? polygon.length - 1 : polygon.length };
  });
  const flat = new Float64Array(2 * loops.reduce((n, loop) => n + loop.length, 0));
  const holes: number[] = [];
  let at = 0;
  loops.forEach(({ polygon, length }, k) => {
    if (k > 0) holes.push(at / 2);
    for (let i = 0; i < length; i++) {
      const p = polygon[i] as readonly number[];
      flat[at++] = p[0] as number;
      flat[at++] = p[1] as number;
    }
  });
  return { flat, holes };
}

/** The regions as triangles in sketch coordinates. */
export function profileFill(profiles: readonly Profile[]): ProfileFill {
  const positions = new Float32Array(fillCost(profiles) * 3);
  const starts = new Uint32Array(profiles.length + 1);
  const regions = new Map<string, number>();
  let at = 0;
  profiles.forEach((profile, i) => {
    starts[i] = at / 3;
    if (!regions.has(profile.id)) regions.set(profile.id, i);
    const { flat, holes } = regionCorners(profile);
    const corners = Earcut.triangulate(flat as unknown as number[], holes);
    for (let k = 0; k < corners.length; k++) {
      const corner = corners[k] as number;
      positions[at] = flat[corner * 2] as number;
      positions[at + 1] = flat[corner * 2 + 1] as number;
      at += 3;
    }
  });
  starts[profiles.length] = at / 3;
  return {
    positions: at === positions.length ? positions : positions.slice(0, at),
    ids: profiles.map((p) => p.id),
    starts,
    regions,
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

/**
 * The most draw groups a fill is drawn with, whatever is selected or hovered.
 * The renderer draws a double-sided transparent group twice, so a fill makes
 * at most 64 draw calls.
 */
export const MAX_FILL_GROUPS = 32;

/** How a selection lays a fill out for drawing. */
export interface FillLayout {
  /** The order to draw the vertices in, when the built order would take too many groups. */
  order?: Uint32Array;
  /** The stretches of the drawing order by shade, the hover left out. */
  runs: readonly FillRun[];
  /** Where each region starts in the drawing order. */
  starts: Uint32Array;
  selected: ReadonlySet<string>;
}

/**
 * Lays a fill out for a selection: in the order it was built while that takes
 * few groups, else through an order with the plain regions first and the
 * selected ones after them. One pass over the fill at most, and only when the
 * selection changes. Once a fill has an order (`kept`) it keeps it.
 */
export function fillLayout(
  fill: ProfileFill,
  selected: readonly string[],
  kept?: Uint32Array,
): FillLayout {
  const chosen = new Set(selected);
  const built = fillRuns(fill, undefined, selected);
  // Two groups are left for a hovered region cut out of a run.
  if (!kept && built.length <= MAX_FILL_GROUPS - 2) {
    return { runs: built, starts: fill.starts, selected: chosen };
  }
  const vertices = fill.positions.length / 3;
  const order = kept ?? new Uint32Array(vertices);
  const starts = new Uint32Array(fill.starts.length);
  let picked = 0;
  for (const run of built) if (run.shade === 'selected') picked += run.count;
  let plainAt = 0;
  let pickedAt = vertices - picked;
  fill.ids.forEach((id, i) => {
    const start = fill.starts[i] as number;
    const end = fill.starts[i + 1] as number;
    const isPicked = chosen.has(id);
    let at = isPicked ? pickedAt : plainAt;
    starts[i] = at;
    for (let v = start; v < end; v++) order[at++] = v;
    if (isPicked) pickedAt = at;
    else plainAt = at;
  });
  starts[fill.ids.length] = vertices;
  const runs: FillRun[] = [
    { start: 0, count: vertices - picked, shade: 'normal' },
    { start: vertices - picked, count: picked, shade: 'selected' },
  ];
  return { order, runs: runs.filter((run) => run.count > 0), starts, selected: chosen };
}

/** The groups to draw a layout with: the hovered region is cut out of the run that holds it. */
export function fillGroups(
  layout: FillLayout,
  fill: ProfileFill,
  hover: string | undefined,
): readonly FillRun[] {
  const region = hover === undefined ? undefined : fill.regions.get(hover);
  if (region === undefined || (hover !== undefined && layout.selected.has(hover))) {
    return layout.runs;
  }
  const count = (fill.starts[region + 1] as number) - (fill.starts[region] as number);
  const start = layout.starts[region] as number;
  if (count === 0) return layout.runs;
  const groups: FillRun[] = [];
  for (const run of layout.runs) {
    if (start < run.start || start >= run.start + run.count) {
      groups.push(run);
      continue;
    }
    if (start > run.start) groups.push({ ...run, count: start - run.start });
    groups.push({ start, count, shade: 'hover' });
    const after = run.start + run.count - (start + count);
    if (after > 0) groups.push({ ...run, start: start + count, count: after });
  }
  return groups;
}

/** What puts sketch coordinates in the world. */
export function fillMatrix(frame: SketchFrame): Matrix4 {
  return new Matrix4()
    .makeBasis(new Vector3(...frame.x), new Vector3(...frame.y), new Vector3(...frame.normal))
    .setPosition(...frame.origin);
}

/** The budget for a design's fills. A test may only lower it. */
export function fillBudget(): number {
  const lower = typeof window !== 'undefined' ? window.__extrudoFillBudget : undefined;
  return typeof lower === 'number' && Number.isFinite(lower) && lower > 0
    ? Math.min(lower, MAX_FILL_VERTICES)
    : MAX_FILL_VERTICES;
}

const unbuilt = new WeakSet<readonly Profile[]>();

/** Bumped when a fill could not be built: the shell asks again which sketches are shaded. */
export const unbuiltFills = createStore<{ version: number }>()(() => ({ version: 0 }));

/** These regions' fill could not be built (no memory for it): their sketch goes without. */
export function noteUnbuiltFill(profiles: readonly Profile[]): void {
  if (unbuilt.has(profiles)) return;
  unbuilt.add(profiles);
  unbuiltFills.setState((s) => ({ version: s.version + 1 }));
}

/**
 * The sketches without a fill: past the design's budget of vertices, or with a
 * fill that would take too long to build, alone or added to the fills before
 * it. The open sketch is served first, then the others in the order given (the
 * timeline's); a sketch that doesn't fit leaves what it would have taken to
 * those after it. Only the sketches passed in count: a hidden one is not drawn,
 * so it takes nothing.
 */
export function sketchesPastFillBudget(
  sketches: readonly { id: string; active: boolean; profiles?: readonly Profile[] }[],
  budget: number = fillBudget(),
  work: { sketch: number; design: number } = {
    sketch: MAX_FILL_WORK,
    design: MAX_DESIGN_FILL_WORK,
  },
): ReadonlySet<string> {
  const past = new Set<string>();
  let left = budget;
  let workLeft = work.design;
  const take = (sketch: (typeof sketches)[number]) => {
    const { profiles } = sketch;
    const cost = profiles ? fillCost(profiles) : 0;
    const effort = profiles ? fillWork(profiles) : 0;
    const fits = cost <= left && effort <= work.sketch && effort <= workLeft;
    if (!fits || (profiles && unbuilt.has(profiles))) {
      past.add(sketch.id);
      return;
    }
    left -= cost;
    workLeft -= effort;
  };
  for (const sketch of sketches) if (sketch.active) take(sketch);
  for (const sketch of sketches) if (!sketch.active) take(sketch);
  return past;
}

/** The most segments of a sketch's outlines drawn at once. */
export const MAX_OUTLINE_POINTS = 100_000;

/**
 * The boundaries of the regions `ids` as world-space line segments (xyz
 * pairs): how a sketch without a fill marks a hovered or selected region.
 * Past `MAX_OUTLINE_POINTS` they are drawn coarser, and loops that no longer
 * fit are left out.
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
  let left = MAX_OUTLINE_POINTS;
  for (const { polygon } of loops) {
    // A loop keeps at least three corners, so that it still reads as a loop.
    const step = Math.max(1, Math.min(stride, Math.floor(polygon.length / 3)));
    const corners = polygon.filter((_, i) => i % step === 0);
    if (corners.length < 2 || corners.length > left) continue;
    left -= corners.length;
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % corners.length] as typeof p;
      out.push(...sketchToWorld(frame, p), ...sketchToWorld(frame, q));
    });
  }
  return new Float32Array(out);
}
