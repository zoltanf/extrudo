/**
 * Trim, break and extend (P1-10, FR-SK-10): cutting a line, circle or arc
 * where other curves cross it, or lengthening it to the next curve.
 *
 * Each is a "split": the curve is replaced by pieces of itself, each a range
 * of its parameter (a line's t from start to end, an arc's angle from its
 * start, a circle's angle). The piece that starts where the curve started
 * keeps its ID (so its dimensions and most constraints stay), the others
 * are new curves held to it (collinear lines, concentric arcs). An end
 * point that no piece keeps is removed with everything on it; a new end at
 * a crossing is put on the curve that made it. The curve's own constraints
 * go where they still mean the same, or go (ADR-0019 lists the rules).
 *
 * Ellipses and splines can only be deleted whole (no crossings) for now:
 * the sketch has no elliptical arcs, and cutting a fit-point spline would
 * change its shape.
 */
import {
  type ConstraintId,
  constraintRefs,
  curvePolyline,
  type DimensionId,
  dimensionRefs,
  entityRemoval,
  type SketchConstraint,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import {
  type Curve,
  dist,
  dot,
  intersectCurves,
  intersectRay,
  normalizeAngle,
  polar,
  sub,
  TAU,
} from '../inference/geometry';
import { ChangeBuilder, ModifyError, type ModifyResult, pointOf } from './change';

/** Positions closer than this (mm) are the same place. */
const SAME = 1e-6;

/** A line, arc or circle of the sketch, with its parameter. */
export interface Span {
  id: SketchEntityId;
  kind: 'line' | 'arc' | 'circle';
  entity: SketchEntity;
  curve: Curve;
  /** The stored curve's range is [0, max]: 1 for a line, the sweep for an arc, 2π for a circle. */
  max: number;
  /** mm per unit of parameter: the length of a line, the radius of an arc or a circle. */
  scale: number;
  /** An arc's or a circle's center; a line's start. */
  center: Vec2;
  at(u: number): Vec2;
  /** A position's parameter: a line's t (unbounded); an arc's or circle's angle in [0, 2π). */
  param(p: Vec2): number;
}

export function spanOf(data: SketchData, id: SketchEntityId): Span | undefined {
  const e = data.entities[id];
  const at = (ref: SketchEntityId) => pointOf(data, ref);
  if (e?.type === 'line') {
    const a = at(e.start);
    const b = at(e.end);
    if (!a || !b) return undefined;
    const d = sub(b, a);
    const len2 = dot(d, d);
    if (len2 === 0) return undefined;
    return {
      id,
      kind: 'line',
      entity: e,
      curve: { kind: 'line', id, a, b },
      max: 1,
      scale: Math.sqrt(len2),
      center: a,
      at: (t) => [a[0] + d[0] * t, a[1] + d[1] * t],
      param: (p) => dot(sub(p, a), d) / len2,
    };
  }
  if (e?.type === 'circle') {
    const center = at(e.center);
    if (!center) return undefined;
    return {
      id,
      kind: 'circle',
      entity: e,
      curve: { kind: 'circle', id, center, radius: e.radius },
      max: TAU,
      scale: e.radius,
      center,
      at: (u) => polar(center, e.radius, u),
      param: (p) => normalizeAngle(Math.atan2(p[1] - center[1], p[0] - center[0])),
    };
  }
  if (e?.type === 'arc') {
    const center = at(e.center);
    const s = at(e.start);
    const t = at(e.end);
    if (!center || !s || !t) return undefined;
    const radius = dist(center, s);
    if (radius === 0) return undefined;
    const from = Math.atan2(s[1] - center[1], s[0] - center[0]);
    let sweep = normalizeAngle(Math.atan2(t[1] - center[1], t[0] - center[0]) - from);
    if (sweep <= 1e-12) sweep = TAU;
    return {
      id,
      kind: 'arc',
      entity: e,
      curve: { kind: 'arc', id, center, radius, from, sweep },
      max: sweep,
      scale: radius,
      center,
      at: (u) => polar(center, radius, from + u),
      param: (p) => normalizeAngle(Math.atan2(p[1] - center[1], p[0] - center[0]) - from),
    };
  }
  return undefined;
}

/** Where another curve crosses a span. */
export interface Cut {
  u: number;
  p: Vec2;
  /** The curve that crosses there. */
  cutter: SketchEntityId;
  /** A point of the cutter at the crossing (its end), if there is one. */
  at?: SketchEntityId;
}

/** The other curves as shapes to intersect with: lines, circles, arcs, and ellipses and splines as polylines. */
function cutters(
  data: SketchData,
  except: SketchEntityId,
): { id: SketchEntityId; curves: Curve[] }[] {
  const out: { id: SketchEntityId; curves: Curve[] }[] = [];
  for (const [key, e] of Object.entries(data.entities)) {
    const id = key as SketchEntityId;
    if (id === except || e.type === 'point') continue;
    if (e.type === 'line' || e.type === 'circle' || e.type === 'arc') {
      const span = spanOf(data, id);
      if (span) out.push({ id, curves: [span.curve] });
      continue;
    }
    const line = curvePolyline(data, e);
    if (!line) continue;
    const curves: Curve[] = [];
    for (let i = 1; i < line.length; i++) {
      curves.push({ kind: 'line', id, a: line[i - 1] as Vec2, b: line[i] as Vec2 });
    }
    out.push({ id, curves });
  }
  return out;
}

/** The points of a curve that lie on it (not a center): where it can meet another curve. */
function rimPoints(e: SketchEntity): SketchEntityId[] {
  switch (e.type) {
    case 'line':
      return [e.start, e.end];
    case 'arc':
      return [e.start, e.end];
    case 'ellipse':
      return [e.major, e.minor];
    case 'spline':
      return [...e.points];
    default:
      return [];
  }
}

function cutAt(data: SketchData, cutter: SketchEntityId, p: Vec2, u: number): Cut {
  const e = data.entities[cutter];
  const at =
    e &&
    rimPoints(e).find((id) => {
      const q = pointOf(data, id);
      return q !== undefined && dist(q, p) < SAME;
    });
  return at ? { u, p, cutter, at } : { u, p, cutter };
}

/** Sorts cuts and merges those at the same place, preferring one at a cutter's point. */
function merged(span: Span, cuts: Cut[]): Cut[] {
  const tol = SAME / span.scale;
  const sorted = [...cuts].sort((a, b) => a.u - b.u);
  const out: Cut[] = [];
  for (const cut of sorted) {
    const last = out[out.length - 1];
    if (last && cut.u - last.u < tol) {
      if (!last.at && cut.at) out[out.length - 1] = cut;
      continue;
    }
    out.push(cut);
  }
  if (span.kind === 'circle' && out.length > 1) {
    const first = out[0] as Cut;
    const last = out[out.length - 1] as Cut;
    if (first.u + TAU - last.u < tol) {
      out.pop();
      if (!first.at && last.at) out[0] = { ...last, u: first.u };
    }
  }
  return out;
}

/** Where the other curves cross a span, inside it (not at a line's or an arc's ends), in order. */
export function spanCuts(data: SketchData, span: Span): Cut[] {
  const tol = SAME / span.scale;
  const cuts: Cut[] = [];
  for (const { id, curves } of cutters(data, span.id)) {
    for (const curve of curves) {
      for (const p of intersectCurves(span.curve, curve)) {
        const u = span.param(p);
        if (span.kind !== 'circle' && (u < tol || u > span.max - tol)) continue;
        cuts.push(cutAt(data, id, p, u));
      }
    }
  }
  return merged(span, cuts);
}

/** A span's range between the crossings around parameter `u` (a circle's may wrap past 2π). */
function around(
  span: Span,
  cuts: Cut[],
  u: number,
): { lo?: Cut; hi?: Cut; from: number; to: number } {
  if (span.kind === 'circle') {
    if (cuts.length === 0) return { from: 0, to: TAU };
    const hiIndex = cuts.findIndex((c) => c.u > u);
    const hi = cuts[hiIndex === -1 ? 0 : hiIndex] as Cut;
    const lo = cuts[
      hiIndex === -1 ? cuts.length - 1 : (hiIndex - 1 + cuts.length) % cuts.length
    ] as Cut;
    let to = hi.u;
    if (to <= lo.u) to += TAU;
    return { lo, hi, from: lo.u, to };
  }
  const t = Math.min(span.max, Math.max(0, u));
  const lo = [...cuts].reverse().find((c) => c.u <= t);
  const hi = cuts.find((c) => c.u > t);
  return { lo, hi, from: lo?.u ?? 0, to: hi?.u ?? span.max };
}

/** Points along a span from `from` to `to` (a preview of a piece). */
export function spanPolyline(span: Span, from: number, to: number): Vec2[] {
  if (span.kind === 'line') return [span.at(from), span.at(to)];
  const n = Math.max(2, Math.ceil((Math.abs(to - from) / TAU) * 96));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push(span.at(from + ((to - from) * i) / n));
  return out;
}

// Trim --------------------------------------------------------------------------

/** What a trim at the cursor would take away, as polylines (the preview). */
export function trimPreview(data: SketchData, id: SketchEntityId, cursor: Vec2): Vec2[][] {
  const e = data.entities[id];
  if (!e || e.type === 'point') return [];
  const span = spanOf(data, id);
  if (!span) {
    const line = curvePolyline(data, e);
    return line ? [line] : [];
  }
  const cuts = spanCuts(data, span);
  if (span.kind === 'circle' && cuts.length < 2) return [spanPolyline(span, 0, TAU)];
  const { from, to } = around(span, cuts, span.param(cursor));
  return [spanPolyline(span, from, to)];
}

/**
 * Trims a curve at the cursor: the part between the crossings on either
 * side goes. A curve nothing crosses goes whole, as does a circle crossed
 * only once. Throws a `ModifyError` for an ellipse or a spline that other
 * curves cross.
 */
export function trim(
  data: SketchData,
  id: SketchEntityId,
  cursor: Vec2,
  newId: () => string,
): ModifyResult {
  const b = new ChangeBuilder(data, newId);
  const e = data.entities[id];
  if (!e || e.type === 'point') throw new ModifyError('Pick a curve to trim.');
  const span = spanOf(data, id);
  if (!span) {
    if (hasCrossings(data, id)) {
      throw new ModifyError('Only lines, circles and arcs can be trimmed where curves cross.');
    }
    return removeWhole(b, id);
  }
  const cuts = spanCuts(data, span);
  if (cuts.length === 0 || (span.kind === 'circle' && cuts.length < 2)) {
    return removeWhole(b, id);
  }
  const { lo, hi, from, to } = around(span, cuts, span.param(cursor));
  if (span.kind === 'circle') {
    // What's left is one arc, from the far crossing round to the near one.
    circleToArcs(b, span, [{ from: to, to: from + TAU, fromCut: hi, toCut: lo }], false);
    return b.result();
  }
  const pieces: Piece[] = [];
  if (lo) pieces.push({ from: 0, to: from, toCut: lo });
  if (hi) pieces.push({ from: to, to: span.max, fromCut: hi });
  resplit(b, span, pieces, false);
  return b.result();
}

function hasCrossings(data: SketchData, id: SketchEntityId): boolean {
  const e = data.entities[id];
  const line = e && curvePolyline(data, e);
  if (!line) return false;
  for (let i = 1; i < line.length; i++) {
    const seg: Curve = { kind: 'line', id, a: line[i - 1] as Vec2, b: line[i] as Vec2 };
    for (const other of cutters(data, id)) {
      for (const c of other.curves) if (intersectCurves(seg, c).length > 0) return true;
    }
  }
  return false;
}

function removeWhole(b: ChangeBuilder, id: SketchEntityId): ModifyResult {
  const removal = entityRemoval(b.data, [id]);
  for (const e of removal.entities) b.removeEntity(e);
  for (const c of removal.constraints) b.removeConstraint(c);
  for (const d of removal.dimensions) b.removeDimension(d);
  return b.result();
}

// Break -------------------------------------------------------------------------

/** What a break at the cursor would cut out as its own curve (the preview). */
export function breakPreview(data: SketchData, id: SketchEntityId, cursor: Vec2): Vec2[][] {
  const span = spanOf(data, id);
  if (!span) return [];
  const cuts = spanCuts(data, span);
  if (cuts.length === 0 || (span.kind === 'circle' && cuts.length < 2)) return [];
  const { from, to } = around(span, cuts, span.param(cursor));
  return [spanPolyline(span, from, to)];
}

/**
 * Breaks a curve at the crossings on either side of the cursor: the part
 * between them becomes a curve of its own, joined to the rest by
 * coincident ends. Throws a `ModifyError` if nothing crosses it there.
 */
export function breakCurve(
  data: SketchData,
  id: SketchEntityId,
  cursor: Vec2,
  newId: () => string,
): ModifyResult {
  const b = new ChangeBuilder(data, newId);
  const span = spanOf(data, id);
  if (!span) throw new ModifyError('Only lines, circles and arcs can be broken.');
  const cuts = spanCuts(data, span);
  if (span.kind === 'circle' && cuts.length < 2) {
    throw new ModifyError('A circle breaks where two curves cross it.');
  }
  if (cuts.length === 0) throw new ModifyError('Nothing crosses it to break it at.');
  const { lo, hi, from, to } = around(span, cuts, span.param(cursor));
  if (span.kind === 'circle') {
    circleToArcs(
      b,
      span,
      [
        { from: to, to: from + TAU, fromCut: hi, toCut: lo },
        { from, to, fromCut: lo, toCut: hi },
      ],
      true,
    );
    return b.result();
  }
  const pieces: Piece[] = [];
  if (lo) pieces.push({ from: 0, to: from, toCut: lo });
  pieces.push({ from, to, fromCut: lo, toCut: hi });
  if (hi) pieces.push({ from: to, to: span.max, fromCut: hi });
  resplit(b, span, pieces, true);
  return b.result();
}

// Extend ------------------------------------------------------------------------

/** Where extending the end of a line or an arc nearer the cursor would take it. */
export function extendTarget(
  data: SketchData,
  id: SketchEntityId,
  cursor: Vec2,
): { span: Span; end: 'start' | 'end'; cut: Cut; piece: Piece } | undefined {
  const span = spanOf(data, id);
  if (!span || span.kind === 'circle') return undefined;
  const u = span.param(cursor);
  const end: 'start' | 'end' =
    span.kind === 'line'
      ? u < 0.5
        ? 'start'
        : 'end'
      : Math.min(u, TAU - u) < Math.abs(span.max - u)
        ? 'start'
        : 'end';
  const tol = SAME / span.scale;
  const hits: Cut[] = [];
  for (const { id: other, curves } of cutters(data, span.id)) {
    for (const curve of curves) {
      const points =
        span.kind === 'line'
          ? intersectRay({ a: span.at(0), d: sub(span.at(1), span.at(0)) }, curve)
          : intersectCurves(
              { kind: 'circle', id: span.id, center: span.center, radius: span.scale },
              curve,
            );
      for (const p of points) {
        const v = span.param(p);
        if (span.kind === 'line') {
          if (end === 'end' ? v > 1 + tol : v < -tol) hits.push(cutAt(data, other, p, v));
        } else if (v > span.max + tol && v < TAU - tol) {
          hits.push(cutAt(data, other, p, end === 'end' ? v : v - TAU));
        }
      }
    }
  }
  if (hits.length === 0) return undefined;
  const cut = hits.reduce((best, h) =>
    end === 'end' ? (h.u < best.u ? h : best) : h.u > best.u ? h : best,
  );
  const piece: Piece =
    end === 'end'
      ? { from: 0, to: cut.u, toCut: cut }
      : { from: cut.u, to: span.max, fromCut: cut };
  return { span, end, cut, piece };
}

/** The extension a click would add (the preview). */
export function extendPreview(data: SketchData, id: SketchEntityId, cursor: Vec2): Vec2[][] {
  const target = extendTarget(data, id, cursor);
  if (!target) return [];
  const { span, end, cut } = target;
  return [end === 'end' ? spanPolyline(span, span.max, cut.u) : spanPolyline(span, cut.u, 0)];
}

/**
 * Extends the end of a line or an arc nearer the cursor to the next curve
 * it would meet. The end moves there and is put on that curve; whatever held
 * the old end goes. Throws a `ModifyError` if nothing is in the way.
 */
export function extend(
  data: SketchData,
  id: SketchEntityId,
  cursor: Vec2,
  newId: () => string,
): ModifyResult {
  const e = data.entities[id];
  if (e?.type !== 'line' && e?.type !== 'arc') {
    throw new ModifyError('Only lines and arcs can be extended.');
  }
  const target = extendTarget(data, id, cursor);
  if (!target) throw new ModifyError('There is nothing for it to reach.');
  const b = new ChangeBuilder(data, newId);
  resplit(b, target.span, [target.piece], false);
  return b.result();
}

// Splitting ---------------------------------------------------------------------

/** A piece of a span to keep: its parameter range and the crossings at its ends. */
export interface Piece {
  from: number;
  to: number;
  fromCut?: Cut;
  toCut?: Cut;
}

/**
 * Replaces a line or an arc by `pieces` of itself. `joined`: neighbouring
 * pieces meet at their shared crossing (break), else each new end goes on
 * the curve that crosses there (trim, extend).
 */
function resplit(b: ChangeBuilder, span: Span, pieces: Piece[], joined: boolean): void {
  const e = span.entity;
  if (e.type !== 'line' && e.type !== 'arc') return;
  const tol = SAME / span.scale;
  const isStart = (u: number) => Math.abs(u) < tol;
  const isEnd = (u: number) => Math.abs(u - span.max) < tol;
  const owner = Math.max(
    0,
    pieces.findIndex((p) => isStart(p.from)),
  );
  const construction = e.construction;

  // Pieces, their ends and IDs.
  const made = pieces.map((piece, i) => {
    const start = isStart(piece.from) ? e.start : b.addPoint(span.at(piece.from));
    const end = isEnd(piece.to) ? e.end : b.addPoint(span.at(piece.to));
    let id = span.id;
    if (i !== owner) {
      if (e.type === 'line') id = b.add({ type: 'line', start, end, construction });
      else {
        const center = b.addPoint(span.center);
        id = b.add({ type: 'arc', center, start, end, construction });
      }
    } else {
      b.set(id, e.type === 'line' ? { ...e, start, end } : { ...e, start, end });
    }
    return { ...piece, id, start, end };
  });
  const ownerId = span.id;

  // Ends no piece keeps go, with everything on them.
  const removed = new Set<SketchEntityId>();
  const used = new Set(made.flatMap((m) => [m.start, m.end]));
  for (const p of [e.start, e.end]) {
    if (!used.has(p)) {
      removed.add(p);
      b.removeEntity(p);
    }
  }

  // New ends: joined to the neighbouring piece, or put on the curve that crosses there.
  for (let i = 0; i < made.length; i++) {
    const m = made[i] as (typeof made)[number];
    const next = made[i + 1];
    if (joined && next && m.toCut && next.fromCut === m.toCut) {
      b.constrain({ type: 'coincident', a: m.end, b: next.start });
      continue;
    }
    if (m.toCut && !isEnd(m.to)) boundary(b, m.end, m.toCut);
    if (m.fromCut && !isStart(m.from) && !(joined && i > 0 && made[i - 1]?.toCut === m.fromCut)) {
      boundary(b, m.start, m.fromCut);
    }
  }

  // New pieces follow the one that keeps the ID.
  for (const m of made) {
    if (m.id === ownerId) continue;
    if (e.type === 'line') {
      b.constrain({ type: joined ? 'parallel' : 'collinear', a: ownerId, b: m.id });
    } else {
      b.constrain({ type: 'concentric', a: ownerId, b: m.id });
      if (!joined) b.constrain({ type: 'equal', a: ownerId, b: m.id });
    }
  }

  // Where does a position on the old curve end up?
  const pieceAt = (p: Vec2) => {
    const u = span.param(p);
    const inside = (m: (typeof made)[number]) =>
      e.type === 'line'
        ? u >= m.from - tol && u <= m.to + tol
        : [u, u - TAU, u + TAU].some((v) => v >= m.from - tol && v <= m.to + tol);
    const hit = made.find(inside);
    if (hit) return hit.id;
    // Beyond the old ends (a point held on the line's extension) it stays with the owner.
    return u > tol && u < span.max - tol ? undefined : ownerId;
  };
  const endAt = (point: SketchEntityId) =>
    made.find((m) => m.start === point || m.end === point)?.id;

  for (const [key, c] of Object.entries(b.data.constraints)) {
    const cid = key as ConstraintId;
    const refs = constraintRefs(c);
    if (refs.some((r) => removed.has(r))) {
      b.removeConstraint(cid);
      continue;
    }
    if (!refs.includes(span.id)) continue;
    const moveTo = (curve: SketchEntityId | undefined) => {
      if (curve === undefined) b.removeConstraint(cid);
      else if (curve !== ownerId) b.replaceConstraint(cid, retarget(c, span.id, curve));
    };
    switch (c.type) {
      case 'pointOnCurve': {
        const p = pointOf(b.data, c.point);
        moveTo(p && pieceAt(p));
        break;
      }
      case 'midpoint':
        b.removeConstraint(cid);
        break;
      case 'symmetric':
        if (c.axis !== span.id) b.removeConstraint(cid);
        break;
      case 'equal':
        if (e.type === 'line') b.removeConstraint(cid);
        break;
      case 'tangent':
      case 'smooth': {
        const other = c.a === span.id ? c.b : c.a;
        const at = jointWith(b.data, other, [e.start, e.end]);
        if (at === undefined) break;
        moveTo(removed.has(at) ? undefined : endAt(at));
        break;
      }
      case 'fix':
        for (const m of made) if (m.id !== ownerId) b.constrain({ type: 'fix', entity: m.id });
        break;
      default:
        break;
    }
  }

  for (const [key, d] of Object.entries(b.data.dimensions)) {
    const refs = dimensionRefs(d);
    const lengthOfLine = d.type === 'distance' && d.a === span.id && d.b === undefined;
    if (refs.some((r) => removed.has(r)) || lengthOfLine) b.removeDimension(key as DimensionId);
  }
}

/**
 * Replaces a circle by arcs of it (trim leaves one; break two). The first
 * arc keeps the circle's ID and center; `joined` arcs meet at their shared
 * crossings, else each end goes on the curve that crosses there.
 */
function circleToArcs(b: ChangeBuilder, span: Span, arcs: Piece[], joined: boolean): void {
  const e = span.entity;
  if (e.type !== 'circle') return;
  const made = arcs.map((piece, i) => {
    const start = b.addPoint(span.at(piece.from));
    const end = b.addPoint(span.at(piece.to));
    const center = i === 0 ? e.center : b.addPoint(span.center);
    const arc: SketchEntity = { type: 'arc', center, start, end, construction: e.construction };
    const id = i === 0 ? span.id : b.add(arc);
    if (i === 0) b.set(id, arc);
    return { ...piece, id, start, end };
  });
  const [first, second] = made;
  if (joined && first && second) {
    b.constrain({ type: 'coincident', a: first.end, b: second.start });
    b.constrain({ type: 'coincident', a: second.end, b: first.start });
    // Two arcs through the same two points with equal radii: the same circle.
    b.constrain({ type: 'equal', a: first.id, b: second.id });
  } else {
    for (const m of made) {
      if (m.fromCut) boundary(b, m.start, m.fromCut);
      if (m.toCut) boundary(b, m.end, m.toCut);
    }
  }
  const tol = SAME / span.scale;
  const arcAt = (p: Vec2) => {
    const u = span.param(p);
    return made.find((m) => [u, u + TAU, u - TAU].some((v) => v >= m.from - tol && v <= m.to + tol))
      ?.id;
  };
  for (const [key, c] of Object.entries(b.data.constraints)) {
    const cid = key as ConstraintId;
    if (!constraintRefs(c).includes(span.id)) continue;
    if (c.type === 'symmetric' && c.axis !== span.id) b.removeConstraint(cid);
    if (c.type === 'pointOnCurve') {
      const p = pointOf(b.data, c.point);
      const to = p && arcAt(p);
      if (to === undefined) b.removeConstraint(cid);
      else if (to !== span.id) b.replaceConstraint(cid, retarget(c, span.id, to));
    }
    if (c.type === 'fix') {
      for (const m of made) if (m.id !== span.id) b.constrain({ type: 'fix', entity: m.id });
    }
  }
}

/** Puts a new end at a crossing on the curve that crosses there (or on its point). */
function boundary(b: ChangeBuilder, point: SketchEntityId, cut: Cut): void {
  if (cut.at) {
    b.constrain({ type: 'coincident', a: point, b: cut.at });
    return;
  }
  const kind = b.data.entities[cut.cutter]?.type;
  if (kind === 'line' || kind === 'circle' || kind === 'arc' || kind === 'ellipse') {
    b.constrain({ type: 'pointOnCurve', point, curve: cut.cutter });
  }
}

/** Which of `ends` another curve meets with one of its own ends, if any. */
function jointWith(
  data: SketchData,
  other: SketchEntityId,
  ends: SketchEntityId[],
): SketchEntityId | undefined {
  const e = data.entities[other];
  if (!e) return undefined;
  const theirs = rimPoints(e)
    .map((id) => pointOf(data, id))
    .filter((p) => p !== undefined);
  return ends.find((id) => {
    const p = pointOf(data, id);
    return p !== undefined && theirs.some((q) => dist(p, q) < SAME);
  });
}

/** The same constraint on `to` instead of `from`. */
export function retarget(
  c: SketchConstraint,
  from: SketchEntityId,
  to: SketchEntityId,
): SketchConstraint {
  const swap = (id: SketchEntityId) => (id === from ? to : id);
  switch (c.type) {
    case 'pointOnCurve':
      return { ...c, curve: swap(c.curve) };
    case 'midpoint':
      return { ...c, of: swap(c.of) };
    case 'fix':
      return { ...c, entity: swap(c.entity) };
    case 'symmetric':
      return { ...c, a: swap(c.a), b: swap(c.b), axis: swap(c.axis) };
    case 'horizontal':
    case 'vertical':
      return c.b === undefined ? { ...c, a: swap(c.a) } : { ...c, a: swap(c.a), b: swap(c.b) };
    default:
      return { ...c, a: swap(c.a), b: swap(c.b) };
  }
}
