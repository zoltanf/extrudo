/**
 * The view evaluator (P6-24 S2, ADR-0143's S2 amendment): bodies and a view
 * frame in, `ViewGeometry` out. Runs in Node and in the worker; every OCCT
 * handle it makes is scoped.
 *
 * The bodies go through hidden-line removal together (one compound), so one
 * body hides another; each HLR entry is mapped back to its body and that
 * body's own edge or face index (`Kernel.locate`), and from there to the
 * topological name (ADR-0005). Raw indices never leave this file.
 */
import type { BodyId, SheetViewFrame, Vec2, Vec3 } from '@extrudo/core';
import type { EdgeGeometry, HlrKind, Kernel, ShapeHandle } from '../kernel';
import type { TopoNames } from '../naming/names';
import {
  boundsOf,
  conicMinorDirection,
  joinPieces,
  polyline,
  projectSpan,
  type SkippedBody,
  TINY,
  toView,
  uncovered,
  type ViewCurve,
  type ViewCurveKind,
  type ViewGeometry,
  type ViewPiece,
} from './geometry';

/** A body to draw: its shape at the marker and its naming table. */
export interface ViewBody {
  id: BodyId;
  shape: ShapeHandle;
  names?: TopoNames;
}

/** Points per curve that is no line, circle or ellipse (an outline HLR adds, a B-spline edge). */
export const VIEW_SAMPLES = 64;

/** How an HLR entry is drawn, or `undefined` when it isn't (seams, hidden tangent edges). */
function kindOf(kind: HlrKind, visible: boolean): ViewCurveKind | undefined {
  if (kind === 'seam') return undefined;
  if (!visible) return kind === 'smooth' ? undefined : 'hidden';
  return kind === 'sharp' ? 'visible' : kind === 'outline' ? 'outline' : 'tangent';
}

/** Where a sub-shape of the compound comes from. */
interface Owner {
  body: number;
  index: number;
}

/** The bodies as one shape for HLR, and the way back from its sub-shape indices. */
function together(
  kernel: Kernel,
  bodies: readonly ViewBody[],
  scope: ReturnType<Kernel['scope']>,
): { shape: ShapeHandle; edge(i: number): Owner | undefined; face(i: number): Owner | undefined } {
  if (bodies.length === 1) {
    const only = (i: number) => ({ body: 0, index: i });
    return { shape: (bodies[0] as ViewBody).shape, edge: only, face: only };
  }
  const shape = scope.track(kernel.compound(bodies.map((b) => b.shape)));
  const maps = (kind: 'edge' | 'face') => {
    const back = new Map<number, Owner>();
    bodies.forEach((b, body) => {
      kernel.locate(b.shape, shape, kind).forEach((at, index) => {
        if (at >= 0 && !back.has(at)) back.set(at, { body, index });
      });
    });
    return (i: number) => back.get(i);
  };
  return { shape, edge: maps('edge'), face: maps('face') };
}

/** Spans in order, touching ones joined; on a closed curve the last runs on into the first. */
function joined(
  spans: readonly [number, number][],
  range: [number, number],
  closed: boolean,
): [number, number][] {
  const gap = 1e-9 * Math.max(1, Math.abs(range[1] - range[0]));
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (closed && out.length > 1 && first && last) {
    if (first[0] - range[0] <= gap && range[1] - last[1] <= gap) {
      // Past the end of a closed curve is its start again: one span across the seam.
      out.shift();
      last[1] = range[1] + (first[1] - range[0]);
    }
  }
  return out;
}

/** The pieces of a span past a closed curve's end, for curves only sampled (not conics). */
function wrapped(
  g: EdgeGeometry,
  range: [number, number],
  [t0, t1]: [number, number],
  frame: SheetViewFrame,
  minor: Vec3 | undefined,
): ViewPiece[] {
  if (t1 <= range[1] || (minor && g.type !== 'other')) {
    return projectSpan(g, range, t0, t1, frame, minor);
  }
  const head = projectSpan(g, range, t0, range[1], frame);
  const tail = projectSpan(g, range, range[0], range[0] + (t1 - range[1]), frame);
  const points = [...head, ...tail].flatMap((p) =>
    p.type === 'line' ? [p.a, p.b] : p.type === 'polyline' ? p.points : [],
  );
  return polyline(points);
}

/**
 * The exact view (`Kernel.hlrSpans`): one curve per model edge and kind
 * (its pieces the edge's spans of that kind) and one per outline HLR adds,
 * named; exact lines, arcs and ellipses, polylines otherwise.
 */
export function exactView(
  kernel: Kernel,
  bodies: readonly ViewBody[],
  frame: SheetViewFrame,
  skipped: readonly SkippedBody[] = [],
): ViewGeometry {
  const curves: ViewCurve[] = [];
  if (bodies.length > 0) {
    using scope = kernel.scope();
    const all = together(kernel, bodies, scope);
    const eye: Vec3 = [-frame.direction[0], -frame.direction[1], -frame.direction[2]];
    const byKey = new Map<string, ViewCurve>();
    const geometry = new Map<string, { g: EdgeGeometry; minor: Vec3 | undefined }>();
    const edgeOf = (owner: Owner) => {
      const key = `${owner.body}:${owner.index}`;
      let found = geometry.get(key);
      if (!found) {
        const body = bodies[owner.body] as ViewBody;
        const g = kernel.edgeGeometry(body.shape, owner.index, VIEW_SAMPLES);
        found = { g, minor: conicMinorDirection(g) };
        geometry.set(key, found);
      }
      return found;
    };
    kernel.hlrSpans(all.shape, eye, VIEW_SAMPLES).forEach((entry, record) => {
      const edge = entry.edge === undefined ? undefined : all.edge(entry.edge);
      const face = entry.face === undefined ? undefined : all.face(entry.face);
      const owner = edge ?? face;
      if (!owner) return;
      const body = bodies[owner.body] as ViewBody;
      let source: { g: EdgeGeometry; minor: Vec3 | undefined } | undefined;
      if (entry.curve) {
        source = { g: entry.curve, minor: conicMinorDirection(entry.curve) };
      } else if (edge) {
        source = edgeOf(edge);
      }
      if (!source || source.g.type === 'degenerate') return;
      const { g, minor } = source;
      for (const [spans, visible] of [
        [entry.visible, true],
        [entry.hidden, false],
      ] as const) {
        const kind = kindOf(entry.kind, visible);
        if (!kind || spans.length === 0) continue;
        const pieces = joined(spans, entry.range, g.closed).flatMap((span) =>
          wrapped(g, entry.range, span, frame, minor),
        );
        if (pieces.length === 0) continue;
        const edgeName = edge ? body.names?.edges[edge.index] : undefined;
        const faceName = face ? body.names?.faces[face.index] : undefined;
        // A model edge's pieces of one kind are one curve (an edge HLR split
        // at outline points comes back whole); each added outline is its own.
        const key = edge ? `e:${owner.body}:${edge.index}:${kind}` : `o:${record}:${kind}`;
        let curve = byKey.get(key);
        if (!curve) {
          curve = {
            kind,
            body: body.id,
            ...(edgeName !== undefined && { edge: edgeName }),
            ...(faceName !== undefined && { face: faceName }),
            pieces: [],
          };
          byKey.set(key, curve);
          curves.push(curve);
        }
        curve.pieces.push(...pieces);
      }
    });
  }
  return finish(curves, skipped, true);
}

/**
 * The quick view (`Kernel.hlrPolySpans`, plan §13.2): straight pieces of
 * the faces' triangulation, chained into polylines per edge or outline and
 * kind, with no names, marked `exact: false`. The caller makes sure every
 * body already has its display triangulation (`RecomputeEngine.sheetViews`):
 * `hlrPolySpans` meshes faces that have none and leaves that mesh on them.
 */
export function quickView(
  kernel: Kernel,
  bodies: readonly ViewBody[],
  frame: SheetViewFrame,
  deflection: number,
  skipped: readonly SkippedBody[] = [],
): ViewGeometry {
  const curves: ViewCurve[] = [];
  if (bodies.length > 0) {
    using scope = kernel.scope();
    const all = together(kernel, bodies, scope);
    const eye: Vec3 = [-frame.direction[0], -frame.direction[1], -frame.direction[2]];
    const byKey = new Map<string, ViewCurve>();
    let open: { key: string; points: Vec2[] } | undefined;
    const flush = () => {
      const curve = open && byKey.get(open.key);
      if (open && curve) curve.pieces.push(...polyline(open.points));
      open = undefined;
    };
    for (const piece of kernel.hlrPolySpans(all.shape, eye, deflection)) {
      const kind = kindOf(piece.kind, piece.visible);
      const owner =
        piece.edge !== undefined
          ? all.edge(piece.edge)
          : piece.face !== undefined
            ? all.face(piece.face)
            : undefined;
      if (!kind || !owner) continue;
      const key = `${piece.edge !== undefined ? 'e' : 'f'}:${owner.body}:${owner.index}:${kind}`;
      if (!byKey.has(key)) {
        const curve: ViewCurve = { kind, body: (bodies[owner.body] as ViewBody).id, pieces: [] };
        byKey.set(key, curve);
        curves.push(curve);
      }
      const a = toView(frame, piece.from);
      const b = toView(frame, piece.to);
      const end = open?.points[open.points.length - 1];
      if (open?.key === key && end && Math.hypot(a[0] - end[0], a[1] - end[1]) <= TINY) {
        open.points.push(b);
      } else {
        flush();
        open = { key, points: [a, b] };
      }
    }
    flush();
  }
  return finish(curves, skipped, false);
}

function finish(all: ViewCurve[], skipped: readonly SkippedBody[], exact: boolean): ViewGeometry {
  // Hidden stretches under drawn lines go (`uncovered`).
  const drawn = all.filter((c) => c.kind !== 'hidden').flatMap((c) => c.pieces);
  const curves = all
    .map((c) => ({
      ...c,
      pieces: joinPieces(
        c.kind === 'hidden' ? c.pieces.flatMap((p) => uncovered(p, drawn)) : c.pieces,
      ),
    }))
    .filter((c) => c.pieces.length > 0);
  const bounds = boundsOf(curves.flatMap((c) => c.pieces));
  return {
    curves,
    ...(bounds && { bounds }),
    status: skipped.length > 0 ? 'partial' : 'ok',
    skipped: [...skipped],
    exact,
  };
}
