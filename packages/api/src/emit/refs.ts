/**
 * References as code (ADR-0073 §2): a stored `GeomRef` becomes the handle
 * expression the API offers, or `design.ref(...)` when there is none. A name
 * that contains a recorded feature's ID is rewritten through the handle's own
 * ID with a template literal, so the code works whatever IDs the run assigns
 * (inside a Script feature they are `<script>.f<n>`).
 */
import {
  type GeomRef,
  isConstructionType,
  parseProfileRefId,
  parseSketchEntityRefId,
  type SketchEntity,
} from '@extrudo/core';
import { detectProfiles, interiorPoint, profileCentroid } from '@extrudo/sketch/profiles';
import type { EmitContext } from './context';
import { arr, call, type Expr, num, raw, str, tmpl } from './print';

/** The origin plane, axis and point, as `design.origin.*`. */
const ORIGIN: Readonly<Record<string, string>> = {
  'origin:xy': 'design.origin.xy',
  'origin:xz': 'design.origin.xz',
  'origin:yz': 'design.origin.yz',
  'origin:x': 'design.origin.x',
  'origin:y': 'design.origin.y',
  'origin:z': 'design.origin.z',
  'origin:point': 'design.origin.point',
};

/** A reference as the argument the API takes for it. */
export function refExpr(ref: GeomRef, ctx: EmitContext): Expr {
  const origin = ORIGIN[ref.id];
  if (origin) return raw(origin);
  switch (ref.kind) {
    case 'plane':
    case 'axis':
    case 'point': {
      const feature = ctx.featureById.get(ref.id);
      if (feature && ctx.selected.has(ref.id) && isConstructionType(feature.type)) {
        return call(`${ctx.varOf.get(ref.id)}.constructionRef`, []);
      }
      return call('design.ref', [str(ref.kind), idExpr(ref.id, ctx)]);
    }
    case 'face': {
      const resolved = resolveFace(ref.id, ctx);
      if (resolved.owner) {
        const args: Expr[] = [resolved.role];
        if (resolved.split !== undefined) args.push(num(resolved.split));
        return call(`${resolved.owner}.face`, args);
      }
      return call('design.ref', [str('face'), idExpr(ref.id, ctx)]);
    }
    case 'edge':
      return edgeOrVertex('edge', ref.id, ctx);
    case 'vertex':
      return edgeOrVertex('vertex', ref.id, ctx);
    case 'body':
    case 'feature':
    case 'profile':
    case 'sketchEntity':
      return structuredRef(ref, ctx);
  }
}

/** The reference kinds whose name embeds the feature or sketch it comes from. */
function structuredRef(ref: GeomRef, ctx: EmitContext): Expr {
  switch (ref.kind) {
    case 'profile': {
      const parsed = parseProfileRefId(ref.id);
      const sketch = parsed && ctx.sketchOf.get(parsed.feature);
      if (parsed && sketch && ctx.selected.has(parsed.feature)) {
        const point = regionInterior(sketch.data, parsed.profile);
        if (point) {
          return call(`${ctx.varOf.get(parsed.feature)}.profileAt`, [
            arr([num(point[0]), num(point[1])]),
          ]);
        }
      }
      return call('design.ref', [str('profile'), idExpr(ref.id, ctx)]);
    }
    case 'sketchEntity': {
      const parsed = parseSketchEntityRefId(ref.id);
      const sketch = parsed && ctx.sketchOf.get(parsed.feature);
      if (parsed && sketch && ctx.selected.has(parsed.feature)) {
        const accessor = entityAccessor(sketch.data, parsed.entity);
        if (accessor) {
          return call(`${ctx.varOf.get(parsed.feature)}.${accessor}.ref`, []);
        }
      }
      return call('design.ref', [str('sketchEntity'), idExpr(ref.id, ctx)]);
    }
    case 'feature': {
      if (ctx.selected.has(ref.id)) return call(`${ctx.varOf.get(ref.id)}.ref`, []);
      return call('design.ref', [str('feature'), idExpr(ref.id, ctx)]);
    }
    case 'body':
      return call('design.ref', [str('body'), idExpr(ref.id, ctx)]);
    default:
      return call('design.ref', [str(ref.kind), idExpr(ref.id, ctx)]);
  }
}

interface ResolvedFace {
  /** The variable of the selected feature that owns the face, if any. */
  owner?: string;
  /** The role part of the name (`cap:end`, `side:l3`), with any embedded ID as code. */
  role: Expr;
  /** The `#n` piece, when the name had one. */
  split?: number;
}

/** A face name as the role its own feature knows, when a selected feature made it. */
function resolveFace(name: string, ctx: EmitContext): ResolvedFace {
  const match = /#(\d+)$/.exec(name);
  const base = match ? name.slice(0, match.index) : name;
  const split = match ? Number(match[1]) : undefined;
  for (const [id, variable] of ctx.varOf) {
    const feature = ctx.featureById.get(id);
    if (!feature) continue;
    const prefix = `${feature.type}:${id}:`;
    if (base.startsWith(prefix)) {
      return {
        owner: variable,
        role: idExpr(base.slice(prefix.length), ctx),
        ...(split !== undefined ? { split } : {}),
      };
    }
  }
  return { role: idExpr(base, ctx), ...(split !== undefined ? { split } : {}) };
}

/** An edge (`e[face|face]`) or vertex (`v[face|face]`) reference as code. */
function edgeOrVertex(kind: 'edge' | 'vertex', id: string, ctx: EmitContext): Expr {
  const match = /^[ev]\[(.*)\](?:@(\d+))?$/.exec(id);
  if (!match) return call('design.ref', [str(kind), idExpr(id, ctx)]);
  const faces = (match[1] ?? '').split('|').filter((face) => face.length > 0);
  const index = match[2] ? Number(match[2]) : undefined;
  let owner: string | undefined;
  const faceExprs = faces.map((face) => {
    const resolved = resolveFace(face, ctx);
    if (!owner && resolved.owner) owner = resolved.owner;
    const args: Expr[] = [resolved.role];
    if (resolved.split !== undefined) args.push(num(resolved.split));
    return resolved.owner ? call(`${resolved.owner}.faceName`, args) : idExpr(face, ctx);
  });
  if (!owner) return call('design.ref', [str(kind), idExpr(id, ctx)]);
  const args: Expr[] = [arr(faceExprs)];
  if (index !== undefined) args.push(num(index));
  return call(`${owner}.${kind}`, args);
}

/** An interior point of a region, for the API's `profileAt`. */
function regionInterior(
  data: import('@extrudo/core').SketchData,
  id: string,
): [number, number] | undefined {
  const region = detectProfiles(data).find((profile) => profile.id === id);
  if (!region) return undefined;
  const point =
    interiorPoint(
      region.outer.polygon,
      region.holes.map((hole) => hole.polygon),
    ) ?? profileCentroid(region);
  return [point[0], point[1]];
}

/** `points()[0]`, `lines()[2]`, `texts()[0]`… the accessor that returns `entity`. */
function entityAccessor(
  data: import('@extrudo/core').SketchData,
  entityId: string,
): string | undefined {
  const entity = data.entities[entityId as import('@extrudo/core').SketchEntityId] as
    | SketchEntity
    | undefined;
  if (!entity) return undefined;
  const kind = entity.type;
  const rank = Object.entries(data.entities)
    .filter(([, other]) => other.type === kind)
    .findIndex(([id]) => id === entityId);
  return rank < 0 ? undefined : `${ACCESSOR[kind]}()[${rank}]`;
}

/** The accessor a `SketchHandle` returns entities of a kind through. */
const ACCESSOR: Readonly<Record<SketchEntity['type'], string>> = {
  point: 'points',
  line: 'lines',
  circle: 'circles',
  arc: 'arcs',
  ellipse: 'ellipses',
  spline: 'splines',
  text: 'texts',
};

/** The expression each recorded ID becomes, built once per run. */
const expressionCache = new WeakMap<EmitContext, Map<string, string>>();

function idExpressions(ctx: EmitContext): Map<string, string> {
  const cached = expressionCache.get(ctx);
  if (cached) return cached;
  const map = new Map<string, string>();
  for (const [id, variable] of ctx.varOf) map.set(id, `${variable}.id`);
  // A face role embeds the sketch curve a sweep or shell came from; that curve's
  // ID changes with the run, so the role is built from the sketch's handle.
  for (const [featureId, view] of ctx.sketchOf) {
    const variable = ctx.varOf.get(featureId);
    if (!variable) continue;
    const counters = new Map<string, number>();
    for (const [entityId, entity] of Object.entries(view.data.entities)) {
      if (map.has(entityId)) continue;
      const rank = counters.get(entity.type) ?? 0;
      counters.set(entity.type, rank + 1);
      map.set(entityId, `${variable}.${ACCESSOR[entity.type]}()[${rank}].id`);
    }
  }
  expressionCache.set(ctx, map);
  return map;
}

/**
 * A name as code: a plain string, or a template literal with every recorded ID
 * turned into an expression (boundary-aware, so a script's generated
 * `<script>.f1` keeps its `.f1` and only the script's part is rewritten).
 */
export function idExpr(id: string, ctx: EmitContext): Expr {
  const segments = rewriteId(id, ctx);
  if (segments.length === 1 && typeof segments[0] === 'string') return str(segments[0]);
  return tmpl(segments);
}

/** The literal/expression segments of a name with recorded IDs rewritten. */
function rewriteId(id: string, ctx: EmitContext): (string | { expr: string })[] {
  const expressions = idExpressions(ctx);
  const ids = [...expressions.keys()].sort((a, b) => b.length - a.length);
  const segments: (string | { expr: string })[] = [];
  let literal = '';
  let i = 0;
  while (i < id.length) {
    const found = ids.find((candidate) => matchesAt(id, i, candidate));
    if (found) {
      if (literal) {
        segments.push(literal);
        literal = '';
      }
      segments.push({ expr: expressions.get(found) as string });
      i += found.length;
    } else {
      literal += id[i];
      i += 1;
    }
  }
  if (literal) segments.push(literal);
  return segments.length > 0 ? segments : [''];
}

const BEFORE = new Set(['', ':', '(', '[', '|', '/']);
const AFTER = new Set(['', ':', ')', ']', '#', '@', '|', '/', '.']);

/** Whether a feature ID sits at `at` as a whole token (or a generated-feature prefix). */
function matchesAt(text: string, at: number, id: string): boolean {
  if (!text.startsWith(id, at)) return false;
  const before = at === 0 ? '' : (text[at - 1] as string);
  const after = at + id.length >= text.length ? '' : (text[at + id.length] as string);
  return BEFORE.has(before) && AFTER.has(after);
}
