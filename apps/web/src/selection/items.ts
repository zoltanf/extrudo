/**
 * Model-mode selection items (P2-03, ADR-0026): what the viewport picks on
 * bodies, and how the rest of the app reads it.
 *
 * The selection itself lives in the session store (`SessionState.selection`,
 * one list for every mode), as `SelectionItem`s. A body's face, edge or
 * vertex is a **topology item**: `{ kind, body, index }`, the index in the
 * kernel's sub-shape order of that body's `BodyMesh`. In the session it is
 * stored as `{ kind, id: "<body>:<index>" }` (a body as `{ kind: 'body',
 * id: <body> }`); `topologyItem` and `readTopology` convert.
 *
 * Indices are only good for the mesh they were picked on. Feature inputs
 * need persistent references: `topologyRef` gives the `GeomRef` from the
 * mesh's `faceIds` / `edgeIds` / `vertexIds` (P2-04), and `pruneSelection`
 * keeps the selection valid when the bodies are recomputed.
 */
import {
  type BodyId,
  type FeatureId,
  type GeomRef,
  originAxis,
  originPlane,
  parseProfileRefId,
  parseSketchEntityRefId,
  type SelectionItem,
  type SessionStore,
  type SketchData,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';

export type TopologyKind = 'body' | 'face' | 'edge' | 'vertex';

/** A body, or a face, edge or vertex of one, by its index in the body's mesh. */
export interface TopologyItem {
  kind: TopologyKind;
  body: BodyId;
  /** Sub-shape index in the mesh (`faceRanges`, `edgeRanges`, `vertices` order); 0 for a body. */
  index: number;
}

const TOPOLOGY_KINDS: ReadonlySet<string> = new Set(['body', 'face', 'edge', 'vertex']);

/** The session's form of a topology item. */
export function topologyItem(item: TopologyItem): SelectionItem {
  return item.kind === 'body'
    ? { kind: 'body', id: item.body }
    : { kind: item.kind, id: `${item.body}:${item.index}` };
}

/** The topology item a session item stands for, or `undefined` for any other kind. */
export function readTopology(item: SelectionItem | undefined): TopologyItem | undefined {
  if (!item || !TOPOLOGY_KINDS.has(item.kind)) return undefined;
  if (item.kind === 'body') return { kind: 'body', body: item.id as BodyId, index: 0 };
  const colon = item.id.lastIndexOf(':');
  const index = Number(item.id.slice(colon + 1));
  if (colon <= 0 || !Number.isInteger(index) || index < 0) return undefined;
  return { kind: item.kind as TopologyKind, body: item.id.slice(0, colon) as BodyId, index };
}

/** How many faces, edges or vertices a mesh has. */
export function topologyCount(mesh: BodyMesh, kind: Exclude<TopologyKind, 'body'>): number {
  if (kind === 'face') return mesh.faceRanges.length >> 1;
  if (kind === 'edge') return mesh.edgeRanges.length >> 1;
  return Math.floor(mesh.vertices.length / 3);
}

function persistentIds(mesh: BodyMesh, kind: TopologyKind): readonly string[] | undefined {
  if (kind === 'face') return mesh.faceIds;
  if (kind === 'edge') return mesh.edgeIds;
  if (kind === 'vertex') return mesh.vertexIds;
  return undefined;
}

/**
 * Marks a `GeomRef` made from a mesh index because the mesh carries no
 * persistent IDs yet: `index:<body>:<index>`. Such a reference is only good
 * until the body is recomputed; never store one in a feature.
 */
export const INDEX_REF_PREFIX = 'index:';

export function isIndexRef(ref: GeomRef): boolean {
  return ref.id.startsWith(INDEX_REF_PREFIX);
}

/**
 * The `GeomRef` of a topology item: a body by its ID, a face, edge or
 * vertex by the persistent ID the kernel gave it (`BodyMesh.faceIds` etc.,
 * P2-04). Without those IDs it is `undefined`, unless `indexFallback` asks
 * for an index reference (`INDEX_REF_PREFIX`). Also `undefined` if the body
 * or the index doesn't exist.
 */
export function topologyRef(
  item: TopologyItem,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  { indexFallback = false }: { indexFallback?: boolean } = {},
): GeomRef | undefined {
  const mesh = bodies[item.body];
  if (!mesh) return undefined;
  if (item.kind === 'body') return { kind: 'body', id: item.body };
  if (item.index >= topologyCount(mesh, item.kind)) return undefined;
  const id = persistentIds(mesh, item.kind)?.[item.index];
  if (id) return { kind: item.kind, id };
  return indexFallback
    ? { kind: item.kind, id: `${INDEX_REF_PREFIX}${item.body}:${item.index}` }
    : undefined;
}

/** Kinds whose session items already are `GeomRef`s (their IDs are references). */
const REF_KINDS: ReadonlySet<string> = new Set(['plane', 'axis', 'point', 'profile']);

/**
 * The selection as `GeomRef`s, for a feature dialog's selection fields
 * (P2-05): topology items through `topologyRef`, profiles, planes, axes and
 * points as they are, sketch curves picked in model mode (`sketchEntity`
 * with a `<sketch>/<entity>` ID). Items that aren't geometry (features,
 * parameters, constraints) and topology without a reference are left out.
 */
export function selectionRefs(
  selection: readonly SelectionItem[],
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  options: { indexFallback?: boolean } = {},
): GeomRef[] {
  const out: GeomRef[] = [];
  for (const item of selection) {
    const topology = readTopology(item);
    if (topology) {
      const ref = topologyRef(topology, bodies, options);
      if (ref) out.push(ref);
    } else if (
      REF_KINDS.has(item.kind) ||
      (item.kind === 'sketchEntity' && item.id.includes('/'))
    ) {
      out.push({ kind: item.kind as GeomRef['kind'], id: item.id });
    }
  }
  return out;
}

/** The topology items in the session's selection. */
export function selectedTopology(session: SessionStore): TopologyItem[] {
  return session
    .getState()
    .selection.map(readTopology)
    .filter((t): t is TopologyItem => t !== undefined);
}

/**
 * Keeps a selection valid after a recompute replaced the meshes (`from` →
 * `to`). A body that is gone takes its items along. An item on a mesh that
 * didn't change stays. On a new mesh, an item is found again by its
 * persistent ID when both meshes have them (P2-04), and dropped otherwise:
 * an index on a new mesh may name another face. Returns `selection` itself
 * when nothing changes.
 */
export function pruneSelection(
  selection: readonly SelectionItem[],
  from: Readonly<Record<BodyId, BodyMesh>>,
  to: Readonly<Record<BodyId, BodyMesh>>,
): readonly SelectionItem[] {
  let changed = false;
  const out: SelectionItem[] = [];
  for (const item of selection) {
    const topology = readTopology(item);
    const next = topology ? follow(item, topology, from, to) : item;
    if (next !== item) changed = true;
    if (next) out.push(next);
  }
  return changed ? out : selection;
}

function follow(
  self: SelectionItem,
  item: TopologyItem,
  from: Readonly<Record<BodyId, BodyMesh>>,
  to: Readonly<Record<BodyId, BodyMesh>>,
): SelectionItem | undefined {
  const mesh = to[item.body];
  if (!mesh) return undefined;
  if (item.kind === 'body') return self;
  const before = from[item.body];
  if (before === mesh) return item.index < topologyCount(mesh, item.kind) ? self : undefined;
  const id = before && persistentIds(before, item.kind)?.[item.index];
  const index = id ? (persistentIds(mesh, item.kind)?.indexOf(id) ?? -1) : -1;
  if (index < 0) return undefined;
  return index === item.index ? self : topologyItem({ ...item, index });
}

const NOUNS: Record<string, [string, string]> = {
  body: ['body', 'bodies'],
  face: ['face', 'faces'],
  edge: ['edge', 'edges'],
  vertex: ['vertex', 'vertices'],
  profile: ['profile', 'profiles'],
  sketchEntity: ['sketch entity', 'sketch entities'],
  sketchCurve: ['sketch curve', 'sketch curves'],
  plane: ['plane', 'planes'],
  axis: ['axis', 'axes'],
  point: ['point', 'points'],
  feature: ['feature', 'features'],
  parameter: ['parameter', 'parameters'],
  constraint: ['constraint', 'constraints'],
  dimension: ['dimension', 'dimensions'],
};

/**
 * The status bar's selection summary (UI spec §2): "2 faces", "1 edge",
 * "2 faces, 1 edge"; empty when nothing is selected. Kinds keep the order
 * in which they were first selected.
 */
export function selectionSummary(selection: readonly SelectionItem[]): string {
  const counts = new Map<string, number>();
  for (const item of selection) {
    // Model mode picks curves only, by `<sketch>/<entity>` (P2-03); sketch mode, points too.
    const kind = item.kind === 'sketchEntity' && item.id.includes('/') ? 'sketchCurve' : item.kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts]
    .map(([kind, n]) => {
      const [one, many] = NOUNS[kind] ?? [kind, `${kind}s`];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(', ');
}

/** "kind:id" per item, space-separated: the viewport's test attributes. */
export function selectionKey(items: readonly (SelectionItem | undefined)[]): string {
  return items
    .filter((i): i is SelectionItem => i !== undefined)
    .map((i) => `${i.kind}:${i.id}`)
    .join(' ');
}

/** The curves of sketch `feature` among model-mode items (`<sketch>/<entity>` IDs). */
export function sketchEntityIdsIn(
  items: readonly (SelectionItem | undefined)[],
  feature: FeatureId,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item?.kind !== 'sketchEntity') continue;
    const ref = parseSketchEntityRefId(item.id);
    if (ref?.feature === feature) out.push(ref.entity);
  }
  return out;
}

export interface LabelContext {
  bodyName(id: BodyId): string | undefined;
  /** The name of a construction feature (a plane, axis or point reference's ID, P3-05). */
  feature?(id: string): string | undefined;
  sketch(id: FeatureId): { name?: string; data: SketchData } | undefined;
}

const ENTITY_NAMES: Record<string, string> = {
  point: 'Point',
  line: 'Line',
  circle: 'Circle',
  arc: 'Arc',
  ellipse: 'Ellipse',
  spline: 'Spline',
};

/**
 * A row of "Select other…": "Face 3 · Body1", "Edge 12 · Body1", "Body1",
 * "Profile · Sketch1", "Line · Sketch1". Faces, edges and vertices count
 * from 1 in the kernel's order.
 */
export function itemLabel(item: SelectionItem, context: LabelContext): string {
  const topology = readTopology(item);
  if (topology) {
    const body = context.bodyName(topology.body) ?? 'Body';
    if (topology.kind === 'body') return body;
    const noun = { face: 'Face', edge: 'Edge', vertex: 'Vertex' }[topology.kind];
    return `${noun} ${topology.index + 1} · ${body}`;
  }
  if (item.kind === 'profile') {
    const ref = parseProfileRefId(item.id);
    const sketch = ref && context.sketch(ref.feature);
    return `Profile · ${sketch?.name ?? 'Sketch'}`;
  }
  if (item.kind === 'sketchEntity') {
    const ref = parseSketchEntityRefId(item.id);
    const sketch = ref && context.sketch(ref.feature);
    const type = ref && sketch?.data.entities[ref.entity]?.type;
    return `${(type && ENTITY_NAMES[type]) ?? 'Sketch curve'} · ${sketch?.name ?? 'Sketch'}`;
  }
  const axis = item.kind === 'axis' ? originAxis(item.id) : undefined;
  if (axis) return axis.label;
  const plane = item.kind === 'plane' ? originPlane(item.id) : undefined;
  if (plane) return plane.label;
  if (item.kind === 'plane' || item.kind === 'axis' || item.kind === 'point') {
    const name = context.feature?.(item.id);
    if (name) return name;
  }
  const [one] = NOUNS[item.kind] ?? [item.kind];
  return one.charAt(0).toUpperCase() + one.slice(1);
}
