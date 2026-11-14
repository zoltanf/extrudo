/**
 * Up to the first or last face (ADR-0144 S9): Extrudo has no extent that is
 * FreeCAD's "up to first" for every profile (its `to-object` on a body stops
 * where the sweep first meets the body, which is FreeCAD's rule for a pad
 * but not for a pocket that starts outside the body) and none that is "up to
 * last" (`through-all` goes past the last face). So the importer picks the
 * face, as FreeCAD does when it computes the feature: the flat faces of the
 * rebuilt body that a line from the profile's centre along the sweep meets,
 * ordered along the sweep (nearest first for "first", farthest first for
 * "last"), each one plane once. Each is tried as `to-object` on that face
 * and kept only when the check holds (`bodies.ts`), at most
 * {@link MAX_UP_TO_TRIES} a feature.
 */
import type { GeomRef } from '@extrudo/core';
import type { CallOutcome, KernelBudget } from './budget';
import type { ShapeElements, SubShapeAt } from './import-kernel';
import { checkReference, saneBodies } from './match';

type Vec3 = readonly [number, number, number];

/**
 * The most targets one up-to feature is tried with: each try is a whole
 * transaction and a rebuild. The fixtures need at most two; measured in
 * ADR-0144's S9 amendment.
 */
export const MAX_UP_TO_TRIES = 4;

/** How far (mm) a face's plane must be ahead of the profile to count as in front of it. */
const AHEAD = 1e-6;
/** How far off square to the sweep a face may be and still be met (a cosine). */
const GRAZING = 1e-9;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** A face of the rebuilt body the sweep meets. */
export interface UpToCandidate {
  readonly at: SubShapeAt;
  /** How far along the sweep its plane is met, mm. */
  readonly t: number;
}

/**
 * The flat faces the line from `origin` along `direction` (unit) meets
 * ahead of the profile, nearest first. A face counts as met when the point
 * lies inside the box its edges can reach (each edge within half its length
 * of its midpoint): a superset of the face, so a face with a hole the line
 * passes through stays a candidate and the check decides. Faces in one
 * plane are one candidate (Extrudo's flat `to-object` goes to the plane).
 */
export function candidatesOf(
  bodies: ReadonlyMap<string, ShapeElements>,
  origin: Vec3,
  direction: Vec3,
): UpToCandidate[] {
  const out: (UpToCandidate & { key: string })[] = [];
  for (const [body, d] of bodies) {
    const edges = new Map(d.edges.map((e) => [e.index, e]));
    for (const f of d.faces) {
      if (f.type !== 'plane' || !f.direction) continue;
      const length = norm(f.direction);
      if (!(length > 1e-9)) continue;
      const n = scale(f.direction, 1 / length);
      const facing = dot(direction, n);
      if (!(Math.abs(facing) > GRAZING)) continue;
      const t = dot(sub(f.centroid, origin), n) / facing;
      if (!(t > AHEAD && Number.isFinite(t))) continue;
      const hit = add(origin, scale(direction, t));
      const lo: [number, number, number] = [Infinity, Infinity, Infinity];
      const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (const i of f.edges) {
        const e = edges.get(i);
        if (!e) continue;
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k] as number, (e.midpoint[k] as number) - e.length / 2);
          hi[k] = Math.max(hi[k] as number, (e.midpoint[k] as number) + e.length / 2);
        }
      }
      const pad = 1e-6 + 1e-9 * norm(hit);
      const inside = [0, 1, 2].every(
        (k) =>
          (hit[k] as number) >= (lo[k] as number) - pad &&
          (hit[k] as number) <= (hi[k] as number) + pad,
      );
      if (!inside) continue;
      // One plane once: its normal (either sense) and its distance from the origin.
      const s = n.find((v) => Math.abs(v) > 1e-9) ?? 1;
      const c = s < 0 ? scale(n, -1) : n;
      const key = [...c, dot(f.centroid, c)].map((v) => Math.round(v * 1e6)).join(',');
      out.push({ at: { body, kind: 'face', index: f.index }, t, key });
    }
  }
  out.sort((a, b) => a.t - b.t);
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.key) && seen.add(c.key)).map(({ at, t }) => ({ at, t }));
}

export type CandidateTargets =
  | { readonly targets: readonly GeomRef[] }
  | {
      readonly stop: 'limit' | 'up-to' | Exclude<CallOutcome<unknown>, { kind: 'done' }>['kind'];
      readonly detail: string;
    };

const detailOf = (o: Exclude<CallOutcome<unknown>, { kind: 'done' }>) =>
  'detail' in o && o.detail ? o.detail : o.kind;

/**
 * The faces to try for "up to first" or "last", as Extrudo references on the
 * last rebuild (which must be the body before the feature), at most `max`.
 * The references are asked for all at once, before any try: a try rebuilds,
 * and the next one's indices would no longer be the body's.
 */
export async function upToTargets(
  budget: KernelBudget,
  mine: readonly string[],
  own: ReadonlySet<string>,
  sent: ReadonlySet<string>,
  origin: Vec3,
  direction: Vec3,
  which: 'first' | 'last',
  max: number,
): Promise<CandidateTargets> {
  if (mine.length === 0) return { stop: 'up-to', detail: 'there is no body for it to go up to' };
  let bodies: Map<string, ShapeElements> | undefined;
  const described = await budget.call(
    () => budget.kernel.describeBodies(mine, { points: [], radius: 0 }),
    (reply: unknown): reply is Record<string, ShapeElements> => {
      bodies = saneBodies(reply, mine);
      return bodies !== undefined;
    },
  );
  if (described.kind !== 'done') return { stop: described.kind, detail: detailOf(described) };
  for (const [, d] of bodies as Map<string, ShapeElements>)
    if (d.over !== undefined)
      return { stop: 'limit', detail: 'its body has more than the importer describes' };
  const all = candidatesOf(bodies as Map<string, ShapeElements>, origin, direction);
  if (which === 'last') all.reverse();
  const picked = all.slice(0, max);
  if (picked.length === 0)
    return { stop: 'up-to', detail: `its sweep meets no flat face of the body to go up to` };
  let refs: GeomRef[] = [];
  let tooLarge: string | undefined;
  const named = await budget.call(
    () => budget.kernel.references(picked.map((c) => c.at)),
    (reply: unknown): reply is (GeomRef | undefined)[] => {
      if (!Array.isArray(reply) || reply.length !== picked.length) return false;
      const out: GeomRef[] = [];
      for (const r of reply) {
        if (r === undefined) return false;
        const checked = checkReference(r, 'face', sent, own);
        if (checked.ok) out.push(checked.ref);
        else if (checked.limit !== undefined) tooLarge = checked.limit;
        else return false;
      }
      refs = out;
      return true;
    },
  );
  if (named.kind !== 'done') return { stop: named.kind, detail: detailOf(named) };
  if (tooLarge !== undefined)
    return { stop: 'up-to', detail: `a reference to a face: ${tooLarge}` };
  return { targets: refs };
}
