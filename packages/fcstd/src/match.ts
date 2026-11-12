/**
 * References by replay and match (ADR-0144 decision 4, S6): an edge or face
 * a FreeCAD dress-up names on its base's stored shape, described by the
 * import kernel, is looked up among the edges or faces of the bodies Extrudo
 * rebuilt up to there. **Exactly one** candidate within the tolerance is a
 * match; none or several is not, and nothing is guessed (never the closest
 * of several). The lookup goes through an index over quantised positions,
 * so it costs each stored element a few cells, not every rebuilt element.
 *
 * Also here: the checks every describing reply passes before it is used
 * (`saneElements`), and those of a reference the kernel hands back
 * (`saneReference`).
 */
import type { GeomRef } from '@extrudo/core';
import type { ElementEdge, ElementFace, ShapeElements } from './import-kernel';

type Vec3 = readonly [number, number, number];

/** How far apart (mm) an element's points may be on the two sides, plus `MATCH_RELATIVE` of their size. */
export const MATCH_TOLERANCE = 1e-6;
/** The part of a point's distance from the origin added to `MATCH_TOLERANCE`. */
export const MATCH_RELATIVE = 1e-9;
/** How far a face's area may be, relative. */
export const MATCH_AREA_TOLERANCE = 1e-6;
/** The grid's smallest cell (mm): candidates are looked for in a point's cell and its neighbours. */
const CELL = 0.01;

/** The most edges or faces one shape's description may hold here (the kernel's own cap, kept equal by a test). */
export const MAX_DESCRIBED_EDGES = 20_000;
/** The most faces an edge may bound, or edges a face may have, in a reply. */
const MAX_ADJACENT = 100_000;
/** The most elements a shape may count. */
const MAX_COUNT = 10_000_000;

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const scaleOf = (p: Vec3) => Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
/** The tolerance at a point. */
export const toleranceAt = (p: Vec3) => MATCH_TOLERANCE + MATCH_RELATIVE * scaleOf(p);
/** How far two unit directions are apart, either sign. */
const dirDist = (a: Vec3, b: Vec3) =>
  Math.min(dist(a, b), Math.hypot(a[0] + b[0], a[1] + b[1], a[2] + b[2]));

/**
 * How far a rebuilt edge is from a stored one (mm), or `Infinity` when they
 * are not the same kind of thing: the largest of the midpoints' distance,
 * the lengths' difference, the ends' distance (either way round), the
 * circles' centres and radii, and the directions' difference over the edge's
 * length.
 */
export function edgeDistance(a: ElementEdge, b: ElementEdge): number {
  // An edge not described in detail is no candidate (the kernel details every edge near a stored one).
  if (!a.ends || !b.ends) return Infinity;
  if (a.type !== b.type || a.ends.length !== b.ends.length) return Infinity;
  if ((a.direction === undefined) !== (b.direction === undefined)) return Infinity;
  if ((a.centre === undefined) !== (b.centre === undefined)) return Infinity;
  let d = Math.max(dist(a.midpoint, b.midpoint), Math.abs(a.length - b.length));
  if (a.ends.length === 2 && b.ends.length === 2) {
    const [a0, a1] = a.ends as [Vec3, Vec3];
    const [b0, b1] = b.ends as [Vec3, Vec3];
    d = Math.max(
      d,
      Math.min(Math.max(dist(a0, b0), dist(a1, b1)), Math.max(dist(a0, b1), dist(a1, b0))),
    );
  }
  if (a.centre && b.centre) d = Math.max(d, dist(a.centre, b.centre));
  if (a.radius !== undefined || b.radius !== undefined)
    d = Math.max(d, Math.abs((a.radius ?? Infinity) - (b.radius ?? Infinity)));
  if (a.direction && b.direction)
    d = Math.max(d, dirDist(a.direction, b.direction) * Math.max(1, a.length));
  return Number.isNaN(d) ? Infinity : d;
}

/** How far a rebuilt face is from a stored one (mm), or `Infinity` when its kind, area or facing differ. */
export function faceDistance(a: ElementFace, b: ElementFace): number {
  if (a.type !== b.type) return Infinity;
  if ((a.direction === undefined) !== (b.direction === undefined)) return Infinity;
  const area = Math.max(Math.abs(a.area), Math.abs(b.area));
  if (area > 0 && Math.abs(a.area - b.area) / area > MATCH_AREA_TOLERANCE) return Infinity;
  let d = dist(a.centroid, b.centroid);
  if (a.direction && b.direction)
    d = Math.max(d, dirDist(a.direction, b.direction) * Math.max(1, Math.sqrt(area)));
  return Number.isNaN(d) ? Infinity : d;
}

/** Where a rebuilt element is: its body and its index there. */
export interface Located {
  readonly body: string;
  readonly index: number;
}

/** What looking one element up came to. */
export type Lookup =
  | {
      readonly kind: 'one';
      readonly at: Located;
      readonly distance: number;
      readonly miss?: number;
    }
  | { readonly kind: 'none'; readonly miss?: number }
  | { readonly kind: 'several'; readonly count: number };

/** An index of rebuilt elements over a grid of their positions. */
class Grid<T> {
  readonly #cells = new Map<string, { at: Located; item: T }[]>();
  readonly #cell: number;
  constructor(cell: number) {
    this.#cell = cell;
  }
  #key(p: Vec3, dx = 0, dy = 0, dz = 0) {
    const c = this.#cell;
    return `${Math.floor(p[0] / c) + dx},${Math.floor(p[1] / c) + dy},${Math.floor(p[2] / c) + dz}`;
  }
  add(p: Vec3, entry: { at: Located; item: T }) {
    const key = this.#key(p);
    const list = this.#cells.get(key);
    if (list) list.push(entry);
    else this.#cells.set(key, [entry]);
  }
  /** Everything in the point's cell and the 26 around it. */
  *near(p: Vec3): Generator<{ at: Located; item: T }> {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) yield* this.#cells.get(this.#key(p, dx, dy, dz)) ?? [];
  }
}

/**
 * The grid's cell for lookups of `points` (the stored elements' positions):
 * four tolerances at the farthest of them, at least `CELL`, so a match is
 * always in the cell of its stored element or a neighbouring one.
 */
export function cellFor(points: Iterable<Vec3>): number {
  let scale = 0;
  for (const p of points) scale = Math.max(scale, scaleOf(p));
  return Math.max(CELL, 4 * (MATCH_TOLERANCE + MATCH_RELATIVE * scale));
}

/**
 * How near a stored edge's midpoint a rebuilt edge must be to be described
 * in detail: beyond the 27 cells a lookup reads (their farthest point is
 * under 3.5 cells away), so every candidate has its ends and circle.
 */
export const detailRadius = (cell: number) => 4 * cell;

/** One lookup: exactly one candidate within the tolerance, the nearest miss for the report. */
function pick<T>(
  near: Iterable<{ at: Located; item: T }>,
  distance: (item: T) => number,
  tolerance: number,
): Lookup {
  let found: { at: Located; distance: number } | undefined;
  let count = 0;
  let miss: number | undefined;
  for (const { at, item } of near) {
    const d = distance(item);
    if (d <= tolerance) {
      count++;
      found = { at, distance: d };
    } else if (Number.isFinite(d) && (miss === undefined || d < miss)) miss = d;
  }
  if (count > 1) return { kind: 'several', count };
  if (!found) return { kind: 'none', ...(miss !== undefined ? { miss } : {}) };
  return {
    kind: 'one',
    at: found.at,
    distance: found.distance,
    ...(miss !== undefined ? { miss } : {}),
  };
}

/** The rebuilt bodies' edges and faces, indexed for lookups. */
export class ElementIndex {
  readonly #edges: Grid<ElementEdge>;
  readonly #faces: Grid<ElementFace>;
  readonly #bodies: ReadonlyMap<string, ShapeElements>;

  constructor(bodies: ReadonlyMap<string, ShapeElements>, cell: number) {
    this.#bodies = bodies;
    this.#edges = new Grid(cell);
    this.#faces = new Grid(cell);
    for (const [body, d] of bodies) {
      for (const e of d.edges)
        this.#edges.add(e.midpoint, { at: { body, index: e.index }, item: e });
      for (const f of d.faces)
        this.#faces.add(f.centroid, { at: { body, index: f.index }, item: f });
    }
  }

  /** A stored edge among the rebuilt ones. */
  edge(stored: ElementEdge): Lookup {
    return pick(
      this.#edges.near(stored.midpoint),
      (e) => edgeDistance(e, stored),
      toleranceAt(stored.midpoint),
    );
  }

  /** A stored face among the rebuilt ones. */
  face(stored: ElementFace): Lookup {
    return pick(
      this.#faces.near(stored.centroid),
      (f) => faceDistance(f, stored),
      toleranceAt(stored.centroid),
    );
  }

  /** The faces a rebuilt edge bounds. */
  facesOf(at: Located): readonly number[] {
    return this.#bodies.get(at.body)?.edges.find((e) => e.index === at.index)?.faces ?? [];
  }
}

// --- Replies ---------------------------------------------------------------

const own = (o: object, key: string): unknown =>
  Object.hasOwn(o, key) ? (o as Record<string, unknown>)[key] : undefined;

const isObject = (v: unknown): v is object =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** Its keys are all among `keys` (a `__proto__` or any other extra key refuses it). */
const only = (v: object, keys: readonly string[]) => Object.keys(v).every((k) => keys.includes(k));
const EDGE_KEYS = [
  'index',
  'type',
  'length',
  'midpoint',
  'ends',
  'direction',
  'centre',
  'radius',
  'faces',
];
const FACE_KEYS = ['index', 'type', 'area', 'centroid', 'direction', 'edges'];
const SHAPE_KEYS = ['edgeCount', 'faceCount', 'edges', 'faces', 'over'];

function vec(v: unknown): Vec3 | undefined {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) return undefined;
  return [v[0] as number, v[1] as number, v[2] as number];
}

const TYPE = /^[a-z]{1,16}$/;

function indexList(v: unknown, count: number): number[] | undefined {
  if (!Array.isArray(v) || v.length > Math.min(count, MAX_ADJACENT)) return undefined;
  const out: number[] = [];
  for (const n of v) {
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) >= count) return undefined;
    out.push(n as number);
  }
  return out;
}

function saneEdge(v: unknown, edgeCount: number, faceCount: number): ElementEdge | undefined {
  if (!isObject(v) || !only(v, EDGE_KEYS)) return undefined;
  const index = own(v, 'index');
  const type = own(v, 'type');
  const length = own(v, 'length');
  const midpoint = vec(own(v, 'midpoint'));
  const endsIn = own(v, 'ends');
  const detailed = endsIn !== undefined;
  const faces = indexList(own(v, 'faces'), faceCount);
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= edgeCount)
    return undefined;
  if (typeof type !== 'string' || !TYPE.test(type)) return undefined;
  if (!Number.isFinite(length) || (length as number) < 0 || !midpoint || !faces) return undefined;
  if (detailed && (!Array.isArray(endsIn) || (endsIn.length !== 0 && endsIn.length !== 2)))
    return undefined;
  const ends = detailed ? (endsIn as unknown[]).map(vec) : [];
  if (ends.some((p) => p === undefined)) return undefined;
  const optional = (key: string) => {
    const x = own(v, key);
    return x === undefined ? { ok: true as const } : { ok: vec(x) !== undefined, value: vec(x) };
  };
  const direction = optional('direction');
  const centre = optional('centre');
  const radius = own(v, 'radius');
  if (!direction.ok || !centre.ok) return undefined;
  if (radius !== undefined && (!Number.isFinite(radius) || (radius as number) < 0))
    return undefined;
  return {
    index: index as number,
    type,
    length: length as number,
    midpoint,
    ...(detailed ? { ends: ends as Vec3[] } : {}),
    faces,
    ...(direction.value ? { direction: direction.value } : {}),
    ...(centre.value ? { centre: centre.value } : {}),
    ...(radius !== undefined ? { radius: radius as number } : {}),
  };
}

function saneFace(v: unknown, edgeCount: number, faceCount: number): ElementFace | undefined {
  if (!isObject(v) || !only(v, FACE_KEYS)) return undefined;
  const index = own(v, 'index');
  const type = own(v, 'type');
  const area = own(v, 'area');
  const centroid = vec(own(v, 'centroid'));
  const edges = indexList(own(v, 'edges'), edgeCount);
  const d = own(v, 'direction');
  const direction = d === undefined ? undefined : vec(d);
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= faceCount)
    return undefined;
  if (typeof type !== 'string' || !TYPE.test(type)) return undefined;
  if (!Number.isFinite(area) || (area as number) < 0 || !centroid || !edges) return undefined;
  if (d !== undefined && !direction) return undefined;
  return {
    index: index as number,
    type,
    area: area as number,
    centroid,
    edges,
    ...(direction ? { direction } : {}),
  };
}

/**
 * A describing reply checked and copied, or `undefined` when it makes no
 * sense: whole counts in range, at most `MAX_DESCRIBED_EDGES` edges and as
 * many faces, each once, every index and adjacency in range, every number
 * finite, no key but the known ones. With `all`, every edge and face is there, in order
 * (a rebuilt body); else every edge and face `ask` names that is in range is
 * (a stored shape). Nothing of the kernel's objects is kept.
 */
export function saneElements(
  reply: unknown,
  want:
    | { readonly all: true }
    | { readonly edges: readonly number[]; readonly faces: readonly number[] },
): ShapeElements | undefined {
  if (!isObject(reply) || !only(reply, SHAPE_KEYS)) return undefined;
  const edgeCount = own(reply, 'edgeCount');
  const faceCount = own(reply, 'faceCount');
  const edgesIn = own(reply, 'edges');
  const facesIn = own(reply, 'faces');
  const over = own(reply, 'over');
  const count = (n: unknown): n is number =>
    Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_COUNT;
  if (!count(edgeCount) || !count(faceCount)) return undefined;
  if (!Array.isArray(edgesIn) || !Array.isArray(facesIn)) return undefined;
  if (edgesIn.length > MAX_DESCRIBED_EDGES || facesIn.length > MAX_DESCRIBED_EDGES)
    return undefined;
  if (over !== undefined) {
    // Too much to describe: the counts only, and the kernel says how many it would have been.
    if (!count(over) || over <= MAX_DESCRIBED_EDGES || edgesIn.length > 0 || facesIn.length > 0)
      return undefined;
    return { edgeCount, faceCount, edges: [], faces: [], over };
  }
  const edges: ElementEdge[] = [];
  const faces: ElementFace[] = [];
  const seenEdges = new Set<number>();
  const seenFaces = new Set<number>();
  for (const e of edgesIn) {
    const x = saneEdge(e, edgeCount, faceCount);
    if (!x || seenEdges.has(x.index)) return undefined;
    seenEdges.add(x.index);
    edges.push(x);
  }
  for (const f of facesIn) {
    const x = saneFace(f, edgeCount, faceCount);
    if (!x || seenFaces.has(x.index)) return undefined;
    seenFaces.add(x.index);
    faces.push(x);
  }
  if ('all' in want) {
    if (edges.length !== edgeCount || faces.length !== faceCount) return undefined;
  } else {
    for (const n of want.edges) if (n < edgeCount && !seenEdges.has(n)) return undefined;
    // A stored shape's edges are all described in detail.
    if (edges.some((e) => e.ends === undefined)) return undefined;
    for (const n of want.faces) if (n < faceCount && !seenFaces.has(n)) return undefined;
  }
  return { edgeCount, faceCount, edges, faces };
}

/** The bodies' descriptions checked: exactly the bodies asked for, own keys only, each whole. */
export function saneBodies(
  reply: unknown,
  bodies: readonly string[],
): Map<string, ShapeElements> | undefined {
  if (!isObject(reply)) return undefined;
  const keys = Object.keys(reply);
  const asked = new Set(bodies);
  if (keys.length !== asked.size || !keys.every((k) => asked.has(k))) return undefined;
  const out = new Map<string, ShapeElements>();
  for (const body of bodies) {
    const d = saneElements(own(reply, body), { all: true });
    if (!d) return undefined;
    out.set(body, d);
  }
  return out;
}

// --- References ------------------------------------------------------------

/** The longest reference ID taken from the kernel. */
export const MAX_REFERENCE_ID_LENGTH = 4_000;
/** How deep a reference's names may nest. */
const MAX_NAME_DEPTH = 32;
const TOKEN = /^[A-Za-z0-9_.~-]+$/;

/** `s` split at `sep` where no parenthesis or bracket is open, or `undefined` when they don't balance. */
function splitTop(s: string, sep: string): string[] | undefined {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      depth--;
      if (depth < 0) return undefined;
    } else if (c === sep && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) return undefined;
  parts.push(s.slice(start));
  return parts;
}

/**
 * The feature IDs a persistent name names (ADR-0005's grammar, `topo-id.ts`),
 * or `undefined` when it isn't one: a face `op:feature:role[:source]` with
 * `#n` splits, an edge or vertex `e[face|…]` / `v[face|…]` with `@n`, a
 * source a token or a nested name in parentheses.
 */
export function namedFeatures(
  name: string,
  depth = 0,
  out = new Set<string>(),
): Set<string> | undefined {
  if (depth > MAX_NAME_DEPTH || name === '') return undefined;
  const bracket = /^[ev]\[(.*)\](?:@\d{1,9})?$/s.exec(name);
  if (bracket) {
    const faces = splitTop(bracket[1] as string, '|');
    if (!faces || faces.length === 0) return undefined;
    for (const f of faces) if (!namedFeatures(f, depth + 1, out)) return undefined;
    return out;
  }
  // A face: its stem without the `#n` splits after the last parenthesis.
  const tail = name.slice(name.lastIndexOf(')') + 1);
  const splits = /(?:#\d{1,9})+$/.exec(tail);
  const stem = splits ? name.slice(0, name.length - splits[0].length) : name;
  const parts = splitTop(stem, ':');
  if (!parts || parts.length < 3 || parts.length > 4) return undefined;
  const [op, feature, role, source] = parts as [string, string, string, string | undefined];
  if (!TOKEN.test(op) || !TOKEN.test(feature) || !TOKEN.test(role)) return undefined;
  out.add(feature);
  if (source !== undefined) {
    if (TOKEN.test(source)) return out;
    const nested = /^\((.*)\)$/s.exec(source);
    if (!nested || !namedFeatures(nested[1] as string, depth + 1, out)) return undefined;
  }
  return out;
}

function saneFingerprint(v: unknown): GeomRef['fingerprint'] | false {
  if (v === undefined) return undefined;
  if (!isObject(v)) return false;
  if (!only(v, ['type', 'at', 'dir', 'size', 'adj'])) return false;
  const type = own(v, 'type');
  const at = vec(own(v, 'at'));
  const d = own(v, 'dir');
  const dir = d === undefined ? undefined : vec(d);
  const size = own(v, 'size');
  const adj = own(v, 'adj');
  if (typeof type !== 'string' || !TYPE.test(type) || !at) return false;
  if (d !== undefined && !dir) return false;
  if (size !== undefined && (!Number.isFinite(size) || (size as number) < 0)) return false;
  if (
    adj !== undefined &&
    (!Array.isArray(adj) ||
      adj.length > 64 ||
      !adj.every((a) => typeof a === 'string' && a.length <= MAX_REFERENCE_ID_LENGTH))
  )
    return false;
  return {
    type,
    at: [...at],
    ...(dir ? { dir: [...dir] } : {}),
    ...(size !== undefined ? { size: size as number } : {}),
    ...(adj !== undefined ? { adj: [...(adj as string[])] } : {}),
  };
}

/**
 * A reference from the kernel checked and copied, or `undefined` when it
 * makes no sense: own keys only, the `kind` asked for, an ID in the naming
 * grammar no longer than `MAX_REFERENCE_ID_LENGTH` whose every feature is
 * one of the document sent and at least one of `body`'s own (the features
 * that made the FreeCAD body so far), a fingerprint of finite numbers.
 */
export function saneReference(
  v: unknown,
  kind: 'edge' | 'face',
  sent: ReadonlySet<string>,
  body: ReadonlySet<string>,
): GeomRef | undefined {
  if (!isObject(v)) return undefined;
  if (!only(v, ['kind', 'id', 'fingerprint'])) return undefined;
  const id = own(v, 'id');
  if (own(v, 'kind') !== kind || typeof id !== 'string' || id.length > MAX_REFERENCE_ID_LENGTH)
    return undefined;
  if (kind === 'edge' ? !id.startsWith('e[') : /^[ev]\[/.test(id)) return undefined;
  const features = namedFeatures(id);
  if (!features || features.size === 0) return undefined;
  if (![...features].every((f) => sent.has(f)) || ![...features].some((f) => body.has(f)))
    return undefined;
  const fingerprint = saneFingerprint(own(v, 'fingerprint'));
  if (fingerprint === false) return undefined;
  return { kind, id, ...(fingerprint ? { fingerprint } : {}) };
}
