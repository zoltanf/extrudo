/**
 * The ghost of lost geometry (P4-12, ADR-0005 and ADR-0033 amendments): where
 * a lost or guessed reference's geometry was, drawn from its fingerprint as a
 * few dashed segments in world mm. Pure, no three.js. The fingerprint has no
 * radius or outline, so a ghost is an "about here" mark of the right size and
 * orientation, not the old shape.
 */
import type { Feature, FeatureId, FeatureStatus, GeomFingerprint } from '@extrudo/core';

type V3 = readonly [number, number, number];

/** Segments as a flat list: x1 y1 z1 x2 y2 z2 per segment. */
export type Segments = number[];

/** Sides of the circle a ghost draws. */
export const GHOST_CIRCLE_SEGMENTS = 48;

const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};

/** Two unit vectors square to `dir` and each other (the same ones for the same `dir`). */
export function planeBasis(dir: V3): [V3, V3] {
  const n = unit(dir);
  const u = unit(cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return [u, unit(cross(n, u))];
}

/** A segment through `at` along `d`, `length` long. */
function segment(at: V3, d: V3, length: number): Segments {
  const u = unit(d);
  const a = add(at, u, -length / 2);
  const b = add(at, u, length / 2);
  return [...a, ...b];
}

function circle(at: V3, dir: V3, radius: number): Segments {
  const [u, v] = planeBasis(dir);
  const out: Segments = [];
  const point = (i: number): V3 => {
    const t = (i / GHOST_CIRCLE_SEGMENTS) * Math.PI * 2;
    return add(add(at, u, Math.cos(t) * radius), v, Math.sin(t) * radius);
  };
  for (let i = 0; i < GHOST_CIRCLE_SEGMENTS; i++) out.push(...point(i), ...point(i + 1));
  return out;
}

function square(at: V3, dir: V3, side: number): Segments {
  const [u, v] = planeBasis(dir);
  const h = side / 2;
  const corner = (a: number, b: number): V3 => add(add(at, u, a * h), v, b * h);
  const c = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] as const;
  return c.flatMap((p, i) => [...p, ...c[(i + 1) % 4]!]);
}

/** Three axis-aligned segments `length` long through `at`. */
export function cross3(at: V3, length: number): Segments {
  return [
    ...segment(at, [1, 0, 0], length),
    ...segment(at, [0, 1, 0], length),
    ...segment(at, [0, 0, 1], length),
  ];
}

/**
 * The marks for a fingerprint. A vertex is a cross `cross` mm long (2 % of the
 * view size, like a construction point); everything else is sized by what the
 * fingerprint says. Without a size (or, for a line, a direction) a cross marks
 * the place.
 */
export function ghostSegments(fp: GeomFingerprint, kind: string, cross = 1): Segments {
  const at = fp.at as V3;
  const dir = (fp.dir ?? [0, 0, 1]) as V3;
  const size = fp.size;
  if (kind === 'vertex' || fp.type === 'point' || size === undefined || size <= 0) {
    return cross3(at, cross);
  }
  if (kind === 'face') {
    return fp.type === 'plane'
      ? square(at, dir, Math.sqrt(size))
      : circle(at, dir, Math.sqrt(size / Math.PI));
  }
  return fp.type === 'circle' ? circle(at, dir, size / (2 * Math.PI)) : segment(at, dir, size);
}

/** One lost or guessed reference to draw. */
export interface Ghost {
  feature: FeatureId;
  /** `face`, `edge` or `vertex`. */
  kind: string;
  /** The fingerprint's type: `plane`, `cylinder`, `line`, `point`… */
  type: string;
  at: V3;
  state: 'lost' | 'guessed';
  /** "Extrude1: lost face". */
  label: string;
  fingerprint: GeomFingerprint;
}

interface RefLike {
  kind: string;
  id: string;
  fingerprint?: GeomFingerprint;
}

const isRef = (v: unknown): v is RefLike =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as RefLike).kind === 'string' &&
  typeof (v as RefLike).id === 'string';

/** The stored reference of a feature's inputs that has this kind and ID (with a fingerprint, first). */
function findRef(value: unknown, kind: string, id: string): RefLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (isRef(value) && value.kind === kind && value.id === id && value.fingerprint) return value;
  for (const child of Object.values(value)) {
    const found = findRef(child, kind, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * The ghosts of the lost and guessed references of `ids`, in that order, each
 * from the fingerprint stored with the reference in the feature's inputs. A
 * reference with no fingerprint (a sketch profile, a plane) has no ghost.
 */
export function ghostsOf(
  features: readonly Pick<Feature, 'id' | 'name' | 'inputs'>[],
  statuses: Readonly<Record<string, FeatureStatus | undefined>>,
  ids: Iterable<string>,
): Ghost[] {
  const out: Ghost[] = [];
  for (const id of new Set(ids)) {
    const feature = features.find((f) => f.id === id);
    const issues = statuses[id]?.refs;
    if (!feature || !issues) continue;
    for (const issue of issues) {
      const stored = findRef(feature.inputs, issue.ref.kind, issue.ref.id);
      const fingerprint = stored?.fingerprint;
      if (!fingerprint) continue;
      out.push({
        feature: feature.id,
        kind: issue.ref.kind,
        type: fingerprint.type,
        at: fingerprint.at as V3,
        state: issue.state,
        label: `${feature.name}: ${issue.state} ${issue.ref.kind}`,
        fingerprint,
      });
    }
  }
  return out;
}

const num = (x: number) => `${Math.round(x * 100) / 100 + 0}`;

/** `data-ghosts`: `<featureId>:<type>:<x,y,z>` per ghost, space separated. */
export function ghostsSummary(ghosts: readonly Ghost[]): string | undefined {
  if (ghosts.length === 0) return undefined;
  return ghosts
    .map((g) => `${g.feature.replace(/\s+/g, '_')}:${g.type}:${g.at.map(num).join(',')}`)
    .join(' ');
}
