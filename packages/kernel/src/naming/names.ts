/**
 * Naming tables: the persistent name of every face, edge and vertex of a
 * shape, in sub-shape order (ADR-0005). Faces are named by the feature that
 * makes them and carried through later operations by OCCT's history; edges
 * and vertices are named after the faces around them, so they follow their
 * faces through every operation without history of their own.
 */
import type { HistoryRecord, SubShapeKind } from '../history';
import type { Vec3 } from '../kernel';
import type { ShapeDescription } from './description';
import { createdName, edgeName, indexedName, splitName, vertexName } from './topo-id';

export interface TopoNames {
  /** Face names in sub-shape order. */
  faces: string[];
  edges: string[];
  vertices: string[];
}

/** The table's list for one kind. */
export function namesOf(names: TopoNames, kind: SubShapeKind): string[] {
  return kind === 'face' ? names.faces : kind === 'edge' ? names.edges : names.vertices;
}

/** Coordinates closer than this (mm) count as equal when ordering pieces. */
const ORDER_TOLERANCE = 1e-6;

/**
 * The geometric order that numbers pieces sharing a name (`#n` for faces,
 * `@n` for edges and vertices): by position (x, then y, then z, each
 * within 1e-6 mm), then larger first, then sub-shape index. Positions are
 * face centroids, edge midpoints and vertex points.
 */
export function compareGeometry(a: Vec3, b: Vec3, sizeA = 0, sizeB = 0): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (Math.abs(d) > ORDER_TOLERANCE) return d;
  }
  return sizeB - sizeA;
}

/**
 * The full table of a shape from raw face names (duplicates allowed):
 * duplicate face names become `name#1`, `name#2` … in geometric order, then
 * edges and vertices are named after their faces, `@n` where several share
 * the same faces.
 */
export function deriveNames(rawFaces: readonly string[], d: ShapeDescription): TopoNames {
  if (rawFaces.length !== d.faces.length) {
    throw new Error(`${rawFaces.length} face names for ${d.faces.length} faces`);
  }
  const faces = numberDuplicates(
    rawFaces,
    (i, j) => {
      const a = d.faces[i];
      const b = d.faces[j];
      return a && b ? compareGeometry(a.centroid, b.centroid, a.area, b.area) : 0;
    },
    splitName,
  );
  const edges = numberDuplicates(
    d.edges.map((e) => edgeName(e.faces.map((f) => faces[f] as string))),
    (i, j) => {
      const a = d.edges[i];
      const b = d.edges[j];
      return a && b ? compareGeometry(a.midpoint, b.midpoint, a.length, b.length) : 0;
    },
    indexedName,
  );
  const vertices = numberDuplicates(
    d.vertices.map((v) => vertexName(v.faces.map((f) => faces[f] as string))),
    (i, j) => {
      const a = d.vertices[i];
      const b = d.vertices[j];
      return a && b ? compareGeometry(a.point, b.point) : 0;
    },
    indexedName,
  );
  return { faces, edges, vertices };
}

/**
 * Gives every group of equal names numbers in the order `compare` sets
 * (then by index). Repeats until all names differ, in case a numbered name
 * meets one that already existed.
 */
function numberDuplicates(
  raw: readonly string[],
  compare: (i: number, j: number) => number,
  number: (name: string, n: number) => string,
): string[] {
  const names = [...raw];
  for (let round = 0; round < 8; round++) {
    const groups = new Map<string, number[]>();
    names.forEach((name, i) => {
      const group = groups.get(name);
      if (group) group.push(i);
      else groups.set(name, [i]);
    });
    let clean = true;
    for (const [name, group] of groups) {
      if (group.length < 2) continue;
      clean = false;
      group.sort((i, j) => compare(i, j) || i - j);
      group.forEach((i, n) => {
        names[i] = number(name, n + 1);
      });
    }
    if (clean) return names;
  }
  return names;
}

export interface SweepNaming {
  /** Operation name in the IDs: `extrude`, `revolve`. */
  op: string;
  feature: string;
  /** The sweep's history (`Kernel.prism`, `Kernel.revolve`). */
  history: readonly HistoryRecord[];
  /**
   * What each edge of the swept shape comes from, by its sub-shape index:
   * the sketch curve (`SketchOutputData.profiles[].edges`), or for a body
   * face its edge's name (press-pull). Missing entries name the side `_`.
   */
  edgeSources: readonly (string | null | undefined)[];
  /** The result's description (`Kernel.describe`). */
  result: ShapeDescription;
  /**
   * Roles in the names, default `cap:start`, `cap:end` and `side`. The
   * second half of a tapered two-sided extrude sweeps from the sketch plane
   * the other way: its far cap is `cap:start` and its sides `side2`.
   */
  roles?: SweepRoles;
}

export interface SweepRoles {
  start?: string;
  end?: string;
  side?: string;
}

/**
 * Names a sweep's result: the swept face's start and end copies are
 * `op:feature:cap:start` and `…:cap:end`, the face an edge sweeps into is
 * `op:feature:side:<source>`; `#n` numbers faces that would share a name
 * (a curve that bounds a profile twice, several profiles).
 */
export function nameSweep(naming: SweepNaming): TopoNames {
  const { op, feature, history, edgeSources, result, roles = {} } = naming;
  const raw: (string | undefined)[] = result.faces.map(() => undefined);
  const put = (to: HistoryRecord['to'], name: string) => {
    for (const t of to) if (t.kind === 'face' && raw[t.index] === undefined) raw[t.index] = name;
  };
  for (const record of history) {
    if (record.input !== 0) continue;
    const { from, relation } = record;
    if (from.kind === 'face' && relation === 'first') {
      put(record.to, createdName(op, feature, roles.start ?? 'cap:start'));
    } else if (from.kind === 'face' && relation === 'last') {
      put(record.to, createdName(op, feature, roles.end ?? 'cap:end'));
    } else if (from.kind === 'edge' && relation === 'generated') {
      put(
        record.to,
        createdName(op, feature, roles.side ?? 'side', edgeSources[from.index] ?? '_'),
      );
    }
  }
  return deriveNames(
    raw.map((name) => name ?? createdName(op, feature, 'new')),
    result,
  );
}

export interface LoftNaming {
  /** Operation name in the IDs: `loft`. */
  op: string;
  feature: string;
  /** The loft's history (`Kernel.loft`): input i is section i. */
  history: readonly HistoryRecord[];
  /** What each edge of each section comes from, by section, then by edge index (a point has none). */
  sources: readonly (readonly (string | null | undefined)[])[];
  result: ShapeDescription;
}

/**
 * Names a loft's result (P4-01): the first section's cap `op:feature:cap:start`,
 * the last's `…:cap:end`, and a side face after the edge of the earliest
 * section that bounds it, `…:side:<source>` (the faces between sections 2
 * and 3 of a ruled loft take section 2's edges); `#n` where names repeat.
 */
export function nameLoft(naming: LoftNaming): TopoNames {
  const { op, feature, history, sources, result } = naming;
  const raw: (string | undefined)[] = result.faces.map(() => undefined);
  const rank: number[] = result.faces.map(() => Number.POSITIVE_INFINITY);
  for (const record of history) {
    const { from, relation, input } = record;
    let name: string;
    if (from.kind === 'face' && relation === 'first') name = createdName(op, feature, 'cap:start');
    else if (from.kind === 'face' && relation === 'last')
      name = createdName(op, feature, 'cap:end');
    else if (from.kind === 'edge' && relation === 'generated') {
      name = createdName(op, feature, 'side', sources[input]?.[from.index] ?? '_');
    } else continue;
    for (const t of record.to) {
      if (t.kind !== 'face' || (rank[t.index] as number) <= input) continue;
      raw[t.index] = name;
      rank[t.index] = input;
    }
  }
  return deriveNames(
    raw.map((name) => name ?? createdName(op, feature, 'new')),
    result,
  );
}

export interface HistoryNaming {
  /** Operation name for faces the operation makes: `fillet`, `boolean`. */
  op: string;
  feature: string;
  /** Naming tables of the operation's inputs, by history input (0 = target, 1 = tool). */
  inputs: readonly (TopoNames | undefined)[];
  history: readonly HistoryRecord[];
  result: ShapeDescription;
}

/**
 * Carries names through an operation by its history. A face kept or
 * modified from an input face keeps that face's name; if several input
 * faces became one (faces merged by a simplifying join), the one from the
 * lowest input, then the smallest name, wins. A face split into pieces
 * gives them `#n`. A face generated from a sub-shape (a fillet face from
 * its edge) is `op:feature:from:(<that sub-shape's name>)`, and a face with
 * no history at all `op:feature:new`.
 */
export function propagateNames(naming: HistoryNaming): TopoNames {
  const { op, feature, inputs, history, result } = naming;
  const kept: { input: number; name: string }[][] = result.faces.map(() => []);
  const generated: string[][] = result.faces.map(() => []);
  for (const record of history) {
    const table = inputs[record.input];
    if (!table) continue;
    const source = namesOf(table, record.from.kind)[record.from.index];
    if (source === undefined) continue;
    for (const to of record.to) {
      if (to.kind !== 'face') continue;
      if (
        record.from.kind === 'face' &&
        (record.relation === 'modified' || record.relation === 'kept')
      ) {
        kept[to.index]?.push({ input: record.input, name: source });
      } else if (record.relation === 'generated') {
        generated[to.index]?.push(createdName(op, feature, 'from', source));
      }
    }
  }
  const raw = result.faces.map((_, i) => {
    const sources = kept[i] as { input: number; name: string }[];
    if (sources.length > 0) {
      sources.sort((a, b) => a.input - b.input || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return (sources[0] as { name: string }).name;
    }
    const from = (generated[i] as string[]).sort()[0];
    return from ?? createdName(op, feature, 'new');
  });
  return deriveNames(raw, result);
}

/**
 * Names for a shape with no naming history (a primitive, or a feature that
 * didn't name its result): every face `op:feature:face`, numbered in
 * geometric order. Stable only as long as the geometry is.
 */
export function positionalNames(op: string, feature: string, d: ShapeDescription): TopoNames {
  return deriveNames(
    d.faces.map(() => createdName(op, feature, 'face')),
    d,
  );
}
