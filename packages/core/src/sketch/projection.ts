/**
 * Projected model geometry in a sketch (P2-09, FR-SK-12, ADR-0031).
 *
 * The Project tool adds a projection record (`addProjection`): a persistent
 * reference to a body edge or face. The kernel resolves it on every
 * recompute and reports the curves it makes in the sketch plane
 * (`SketchReport`). The app then brings the sketch in line with the report
 * (`projectionSync` → `syncProjections`): it adds the curves the first
 * time, moves them when the model changes, and removes those whose source
 * edge is gone. Projected curves are ordinary entities, so profiles,
 * inference, constraints, dimensions and export treat them like drawn ones;
 * the solver holds them fixed (`projectedEntities`).
 */
import { CommandError, defineCommand } from '../commands';
import { refuseIfUsed } from '../document-commands';
import type { ConstraintId, DimensionId, FeatureId, ProjectionId, SketchEntityId } from '../ids';
import type { GeomRef } from '../refs';
import { entityPoints, entityRemoval, sketchDraft } from './commands';
import type { SketchFrame, Vec2 } from './planes';
import type { SketchData, SketchEntity, SketchProjection } from './schema';

/** One curve of a projection, in sketch coordinates (mm), as the kernel reports it. */
export type ProjectedCurve =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  /** Counter-clockwise from `start` to `end`, as sketch arcs run. */
  | { type: 'arc'; center: Vec2; start: Vec2; end: Vec2 }
  | { type: 'ellipse'; center: Vec2; major: Vec2; minor: Vec2 }
  /**
   * A fit-point spline through `points` (curves that aren't lines, circles or
   * ellipses), or with `mode: 'control'` a control-point spline whose poles
   * they are (P4-12: silhouettes and sections fitted from the kernel's samples).
   */
  | { type: 'spline'; points: Vec2[]; mode?: 'control' }
  /** A projected vertex (P4-12). */
  | { type: 'point'; at: Vec2 };

/** What the kernel found for one projection. */
export interface ProjectionReport {
  /** The curves by source key (see `SketchProjection.curves`); absent when the source is lost. */
  curves?: Record<string, ProjectedCurve>;
  /** The source couldn't be found: the curves stay where they were. */
  lost?: boolean;
}

/**
 * What the kernel reports about a sketch on each recompute (P2-09), for the
 * UI thread: the plane's frame (a face's moves with the face) and its
 * projections. The model store keeps one per sketch (`ModelState.sketches`).
 */
export interface SketchReport {
  frame: SketchFrame;
  projections?: Record<ProjectionId, ProjectionReport>;
}

const projectedCache = new WeakMap<object, ReadonlySet<SketchEntityId>>();

/**
 * The projected curves of a sketch and their points: fixed geometry that
 * follows the model. The solver treats them as constants and the tools
 * don't edit them.
 */
export function projectedEntities(data: SketchData): ReadonlySet<SketchEntityId> {
  if (!data.projections) return EMPTY;
  const known = projectedCache.get(data);
  if (known) return known;
  const out = new Set<SketchEntityId>();
  for (const projection of Object.values(data.projections)) {
    for (const id of Object.values(projection.curves)) {
      const e = id === null ? undefined : data.entities[id];
      if (!e || id === null) continue;
      out.add(id);
      for (const p of entityPoints(e)) out.add(p);
    }
  }
  projectedCache.set(data, out);
  return out;
}

const EMPTY: ReadonlySet<SketchEntityId> = new Set();

/** The projection a projected entity (a curve or one of its points) belongs to. */
export function projectionOf(
  data: SketchData,
  id: SketchEntityId,
): { id: ProjectionId; projection: SketchProjection } | undefined {
  for (const [pid, projection] of Object.entries(data.projections ?? {})) {
    for (const curve of Object.values(projection.curves)) {
      if (curve === null) continue;
      const e = data.entities[curve];
      if (curve === id || (e && entityPoints(e).includes(id))) {
        return { id: pid as ProjectionId, projection };
      }
    }
  }
  return undefined;
}

/** What the Project tool can project, and what Intersect can cut (P4-12). */
const PROJECTABLE: Record<'project' | 'intersect', readonly GeomRef['kind'][]> = {
  project: ['edge', 'face', 'vertex', 'body'],
  intersect: ['face', 'body'],
};

/**
 * Projects a body edge, face, vertex or whole body into a sketch (the
 * Project tool), or with `mode: 'intersect'` the curves where a face or body
 * meets the sketch plane (Intersect, P4-12). The record starts without
 * curves: the kernel reports them on the next recompute and the app adds them
 * (`syncProjections`), in the same undo step. With `linked: false` (an
 * include, "Keep linked" off) the app then turns them into plain entities and
 * drops the record (`includeProjection`).
 */
export const addProjection = defineCommand<{
  feature: FeatureId;
  id: ProjectionId;
  ref: GeomRef;
  mode?: 'project' | 'intersect';
  linked?: boolean;
}>('sketch.project', 'Project', (draft, { feature, id, ref, mode = 'project', linked = true }) => {
  const data = sketchDraft(draft, feature);
  if (!PROJECTABLE[mode].includes(ref.kind)) {
    throw new CommandError(
      mode === 'intersect'
        ? 'Only faces and bodies can be intersected with the sketch plane.'
        : 'Only body edges, faces, vertices and bodies can be projected.',
    );
  }
  const already = Object.values(data.projections ?? {}).some(
    (p) => p.ref.kind === ref.kind && p.ref.id === ref.id && (p.mode ?? 'project') === mode,
  );
  if (already) {
    throw new CommandError(
      mode === 'intersect'
        ? "That's already intersected with this sketch."
        : "That's already projected into this sketch.",
    );
  }
  if (
    id in data.entities ||
    id in data.constraints ||
    id in data.dimensions ||
    id in (data.projections ?? {})
  ) {
    throw new CommandError(`The sketch already has "${id}".`);
  }
  data.projections ??= {};
  data.projections[id] = {
    ref,
    curves: {},
    ...(mode === 'intersect' && { mode }),
    ...(!linked && { linked: false as const }),
  };
});

/**
 * The plain entities an include (`linked: false`) becomes once the kernel
 * has reported its curves (P4-12): every reported curve as a new entity, in
 * key order, with no record and nothing holding it. `undefined` while the
 * report hasn't come (or the source is lost: then `lost` is true).
 */
export function includedCurves(
  data: SketchData,
  report: SketchReport,
  newId: () => string,
): Record<
  ProjectionId,
  { entities: Record<SketchEntityId, SketchEntity>; count: number; lost?: true }
> {
  const out: Record<
    ProjectionId,
    { entities: Record<SketchEntityId, SketchEntity>; count: number; lost?: true }
  > = {};
  for (const [pid, projection] of Object.entries(data.projections ?? {})) {
    if (projection.linked !== false) continue;
    const reported = report.projections?.[pid as ProjectionId];
    if (!reported) continue;
    if (!reported.curves) {
      out[pid as ProjectionId] = { entities: {}, count: 0, lost: true };
      continue;
    }
    const sync: ProjectionSync = { entities: {}, points: {}, radii: {}, remove: [], curves: {} };
    const keys = Object.keys(reported.curves).sort();
    for (const key of keys) addCurve(reported.curves[key] as ProjectedCurve, newId, sync, false);
    out[pid as ProjectionId] = { entities: sync.entities, count: keys.length };
  }
  return out;
}

/**
 * Turns an include into plain entities (P4-12, "Keep linked" off): adds the
 * curves `includedCurves` made and drops the record, so nothing holds them
 * and they don't follow the model. The app amends it into the step that
 * added the record and names that step "Include <n> curves".
 */
export const includeProjection = defineCommand<{
  feature: FeatureId;
  id: ProjectionId;
  entities: Record<SketchEntityId, SketchEntity>;
}>('sketch.include', 'Include', (draft, { feature, id, entities }) => {
  const data = sketchDraft(draft, feature);
  const projection = data.projections?.[id];
  if (projection?.linked !== false) {
    throw new CommandError('That include is already done.');
  }
  for (const [eid, e] of Object.entries(entities)) {
    if (eid in data.entities || eid in data.constraints || eid in data.dimensions) {
      throw new CommandError(`The sketch already has "${eid}".`);
    }
    data.entities[eid as SketchEntityId] = e;
  }
  delete data.projections?.[id];
  if (data.projections && Object.keys(data.projections).length === 0) delete data.projections;
});

/** The label of an include's undo step. */
export function includeLabel(count: number): string {
  return `Include ${count} ${count === 1 ? 'curve' : 'curves'}`;
}

/** A sketch change that brings projections in line with the kernel (`projectionSync`). */
export interface ProjectionSync {
  /** New and replaced entities: curves and their points. */
  entities: Record<SketchEntityId, SketchEntity>;
  /** Points of kept curves that move. */
  points: Record<SketchEntityId, { x: number; y: number }>;
  /** Kept circles' new radii. */
  radii: Record<SketchEntityId, number>;
  /** Curves to remove, with what `entityRemoval` takes along. */
  remove: SketchEntityId[];
  /** Each changed projection's new curve map. */
  curves: Record<ProjectionId, Record<string, SketchEntityId | null>>;
}

/** Closer than this (mm) counts as unchanged. */
const SAME = 1e-9;

/**
 * What the sketch must change to show what the kernel reports, or
 * `undefined` if it already does. Curves are matched by source key: a
 * curve whose source is still there and whose type fits keeps its IDs (so
 * its constraints and dimensions stay) and moves; one whose type changed
 * is replaced; one whose source went is removed. A key the user deleted
 * (`null`) stays deleted. Lost projections are left alone. New IDs come
 * from `newId` (the caller's, so the command stays deterministic).
 */
export function projectionSync(
  data: SketchData,
  report: SketchReport,
  newId: () => string,
): ProjectionSync | undefined {
  const sync: ProjectionSync = { entities: {}, points: {}, radii: {}, remove: [], curves: {} };
  let changed = false;
  for (const [pid, projection] of Object.entries(data.projections ?? {})) {
    // An include becomes plain entities instead (`includedCurves`).
    if (projection.linked === false) continue;
    const reported = report.projections?.[pid as ProjectionId];
    if (!reported?.curves) continue;
    const curves: Record<string, SketchEntityId | null> = {};
    let mapChanged = false;
    for (const [key, id] of Object.entries(projection.curves)) {
      if (id === null) {
        curves[key] = null;
        continue;
      }
      const fresh = reported.curves[key];
      const entity = data.entities[id];
      if (!fresh || !entity) {
        if (entity) sync.remove.push(id);
        mapChanged = true;
        continue;
      }
      if (fits(data, entity, fresh)) {
        curves[key] = id;
        if (movePoints(data, entity, fresh, sync)) changed = true;
        if (entity.type === 'point' && fresh.type === 'point') {
          if (Math.abs(entity.x - fresh.at[0]) > SAME || Math.abs(entity.y - fresh.at[1]) > SAME) {
            sync.points[id] = { x: fresh.at[0], y: fresh.at[1] };
            changed = true;
          }
        }
        if (entity.type === 'circle' && fresh.type === 'circle') {
          if (Math.abs(entity.radius - fresh.radius) > SAME) {
            sync.radii[id] = fresh.radius;
            changed = true;
          }
        }
        continue;
      }
      sync.remove.push(id);
      curves[key] = addCurve(fresh, newId, sync, 'construction' in entity && entity.construction);
      mapChanged = true;
    }
    for (const key of Object.keys(reported.curves).sort()) {
      if (key in projection.curves) continue;
      curves[key] = addCurve(reported.curves[key] as ProjectedCurve, newId, sync, false);
      mapChanged = true;
    }
    if (mapChanged) {
      sync.curves[pid as ProjectionId] = curves;
      changed = true;
    }
  }
  return changed ? sync : undefined;
}

/** Whether a stored curve can take a reported one's geometry in place. */
function fits(data: SketchData, e: SketchEntity, c: ProjectedCurve): boolean {
  if (e.type !== c.type) return false;
  if (e.type === 'spline' && c.type === 'spline') {
    return e.points.length === c.points.length && (e.mode ?? 'fit') === (c.mode ?? 'fit');
  }
  return entityPoints(e).every((p) => data.entities[p]?.type === 'point');
}

/** The reported positions of a curve's points, in `entityPoints` order. */
function pointsOf(c: ProjectedCurve): Vec2[] {
  switch (c.type) {
    case 'line':
      return [c.a, c.b];
    case 'circle':
      return [c.center];
    case 'arc':
      return [c.center, c.start, c.end];
    case 'ellipse':
      return [c.center, c.major, c.minor];
    case 'spline':
      return c.points;
    case 'point':
      return [];
  }
}

function movePoints(
  data: SketchData,
  e: SketchEntity,
  c: ProjectedCurve,
  sync: ProjectionSync,
): boolean {
  const ids = entityPoints(e);
  const at = pointsOf(c);
  let moved = false;
  ids.forEach((id, i) => {
    const p = data.entities[id];
    const q = at[i];
    if (p?.type !== 'point' || !q) return;
    if (Math.abs(p.x - q[0]) > SAME || Math.abs(p.y - q[1]) > SAME) {
      sync.points[id] = { x: q[0], y: q[1] };
      moved = true;
    }
  });
  return moved;
}

function addCurve(
  c: ProjectedCurve,
  newId: () => string,
  sync: ProjectionSync,
  construction: boolean,
): SketchEntityId {
  const point = ([x, y]: Vec2): SketchEntityId => {
    const id = newId() as SketchEntityId;
    sync.entities[id] = { type: 'point', x, y };
    return id;
  };
  const id = newId() as SketchEntityId;
  switch (c.type) {
    case 'line':
      sync.entities[id] = { type: 'line', start: point(c.a), end: point(c.b), construction };
      break;
    case 'circle':
      sync.entities[id] = {
        type: 'circle',
        center: point(c.center),
        radius: c.radius,
        construction,
      };
      break;
    case 'arc':
      sync.entities[id] = {
        type: 'arc',
        center: point(c.center),
        start: point(c.start),
        end: point(c.end),
        construction,
      };
      break;
    case 'ellipse':
      sync.entities[id] = {
        type: 'ellipse',
        center: point(c.center),
        major: point(c.major),
        minor: point(c.minor),
        construction,
      };
      break;
    case 'spline':
      sync.entities[id] = {
        type: 'spline',
        points: c.points.map(point),
        ...(c.mode === 'control' && { mode: 'control' as const }),
        construction,
      };
      break;
    case 'point':
      sync.entities[id] = { type: 'point', x: c.at[0], y: c.at[1] };
      break;
  }
  return id;
}

/**
 * Brings a sketch's projections in line with the kernel (`projectionSync`).
 * Removed curves take their constraints and dimensions along, except that
 * a curve whose dimension another expression uses stays (frozen where it
 * was, still listed). The caller solves the sketch afterwards so geometry
 * constrained to the projections follows (`ToolHost.syncProjections`).
 */
export const syncProjections = defineCommand<{ feature: FeatureId } & ProjectionSync>(
  'sketch.projections',
  'Update projections',
  (draft, { feature, entities, points, radii, remove, curves }) => {
    const data = sketchDraft(draft, feature);
    const kept = new Set<SketchEntityId>();
    for (const id of remove) {
      const removal = entityRemoval(data, [id]);
      const gone = new Set<object>(removal.dimensions.map((d) => data.dimensions[d] as object));
      try {
        for (const d of removal.dimensions) {
          const dim = data.dimensions[d];
          if (dim && !dim.driven && dim.paramName !== undefined) {
            refuseIfUsed(draft, dim.paramName, gone);
          }
        }
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        kept.add(id);
        continue;
      }
      for (const e of removal.entities) delete data.entities[e];
      for (const c of removal.constraints) delete data.constraints[c as ConstraintId];
      for (const d of removal.dimensions) delete data.dimensions[d as DimensionId];
    }
    for (const [id, e] of Object.entries(entities)) {
      if (id in data.entities || id in data.constraints || id in data.dimensions) {
        throw new CommandError(`The sketch already has "${id}".`);
      }
      data.entities[id as SketchEntityId] = e;
    }
    for (const [id, p] of Object.entries(points)) {
      const e = data.entities[id as SketchEntityId];
      if (e?.type === 'point') {
        e.x = p.x;
        e.y = p.y;
      }
    }
    for (const [id, radius] of Object.entries(radii)) {
      const e = data.entities[id as SketchEntityId];
      if (e?.type === 'circle') e.radius = radius;
    }
    for (const [pid, map] of Object.entries(curves)) {
      const projection = data.projections?.[pid as ProjectionId];
      if (!projection) continue;
      const next: Record<string, SketchEntityId | null> = { ...map };
      // A curve that had to stay keeps its key.
      for (const [key, id] of Object.entries(projection.curves)) {
        if (id !== null && kept.has(id) && !(key in next)) next[key] = id;
      }
      projection.curves = next;
    }
  },
);
