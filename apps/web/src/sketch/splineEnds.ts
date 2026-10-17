/**
 * Tangent grips of a fit spline (P4-12, ADR-0063's third amendment, B1): with
 * one open fit spline selected in sketch mode, each end has a grip a third of
 * the end derivative from the end point, on the curve's side, where a cubic
 * Bézier's inner control point is (`start + D0 / 3`, `end − Dn / 3`). The
 * viewport draws them and the tool host drags them; dragging one sets that
 * end's stored tangent. Not solver points: the solver never sees them.
 */
import {
  type SelectionItem,
  type SketchData,
  type SketchEntityId,
  splineCurve,
  splineTangentAt,
  type Vec2,
} from '@extrudo/core';

export interface TangentGrip {
  spline: SketchEntityId;
  end: 'start' | 'end';
  /** The spline's end point. */
  anchor: Vec2;
  /** Where the grip is drawn. */
  at: Vec2;
}

/** The two grips of an open fit spline; none for anything else. */
export function tangentGrips(data: SketchData, id: SketchEntityId): TangentGrip[] {
  const e = data.entities[id];
  if (e?.type !== 'spline' || (e.mode ?? 'fit') !== 'fit' || e.closed === true) return [];
  const points: Vec2[] = [];
  for (const ref of e.points) {
    const p = data.entities[ref];
    if (p?.type !== 'point') return [];
    points.push([p.x, p.y]);
  }
  // A stored tangent is the curve's own end derivative; a free end's is read off the curve.
  const curve = splineCurve(e, points);
  const grip = (end: 'start' | 'end'): TangentGrip => {
    const anchor = (end === 'start' ? points[0] : points[points.length - 1]) as Vec2;
    const d = e.tangents?.[end] ?? splineTangentAt(curve, end === 'start' ? 0 : 1);
    const s = end === 'start' ? 1 / 3 : -1 / 3;
    return { spline: id, end, anchor, at: [anchor[0] + s * d[0], anchor[1] + s * d[1]] };
  };
  return [grip('start'), grip('end')];
}

/** The tangent a grip moved to `at` stands for: three times its offset, turned to the curve's way. */
export function tangentAt(grip: Pick<TangentGrip, 'end' | 'anchor'>, at: Vec2): Vec2 {
  const s = grip.end === 'start' ? 3 : -3;
  return [s * (at[0] - grip.anchor[0]), s * (at[1] - grip.anchor[1])];
}

/** The grips of the selection when it is one open fit spline. */
export function selectedGrips(
  data: SketchData,
  selected: readonly SketchEntityId[],
): TangentGrip[] {
  return selected.length === 1 ? tangentGrips(data, selected[0] as SketchEntityId) : [];
}

/** The spline whose grips show: the selection's one open fit spline, if that is what it is. */
export function gripSplineOf(
  data: SketchData,
  selection: readonly SelectionItem[],
): SketchEntityId | undefined {
  const ids = selection
    .filter((s) => s.kind === 'sketchEntity' && s.id in data.entities)
    .map((s) => s.id as SketchEntityId);
  return ids.length === 1 && selectedGrips(data, ids).length > 0 ? ids[0] : undefined;
}
