/**
 * Maps a decoded Fusion design onto an Extrudo design through @extrudo/api:
 * user parameters, sketches (on origin planes or planes offset from them),
 * and extrudes. What has no mapping yet is listed in the report, in timeline
 * order, so the person importing knows what to redo.
 *
 * Frames: Fusion stores each sketch's sketch-to-model transform (cm). Extrudo
 * sketches sit on fixed origin-plane frames (XZ's normal is −Y there, where
 * Fusion's is +Y), so every sketch coordinate is carried through model space
 * into the chosen Extrudo plane's frame, and an extrude flips when the two
 * normals point opposite ways.
 */
import {
  Design,
  edgeName,
  type GeomRef,
  type SketchBuilder,
  type SketchHandle,
} from '@extrudo/api';
import { ORIGIN_PLANES, type SketchData } from '@extrudo/core';
import {
  detectProfiles,
  insidePolygon,
  interiorPoint,
  type Profile,
} from '@extrudo/sketch/profiles';
import type { AsmSurface } from './asm';
import type { ProfileRegion } from './decode/extrude';
import type { ParameterValue } from './decode/parameters';
import type { SketchCircular, SketchPoint, Vec3 } from './decode/sketch-geometry';
import type {
  F3dDesign,
  F3dEdge,
  F3dEdgeFeature,
  F3dExtrude,
  F3dFace,
  F3dSketch,
  F3dSketchFeature,
  Matrix,
} from './model';

type Vec2 = [number, number];

export interface ImportReport {
  /** Timeline features that became Extrudo features. */
  imported: string[];
  /** Timeline features left out, with why. */
  skipped: { name: string; kind: string; reason: string }[];
  /** Smaller things that were approximated. */
  notes: string[];
}

export interface ImportResult {
  design: Design;
  report: ImportReport;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const EPS = 1e-6;

interface SketchEntry {
  handle: SketchHandle;
  placement: Placement;
  /** Extrudo curve ID → Fusion curve tag. */
  tags: Map<string, bigint>;
  fusion: F3dSketch;
}

/** An extrude that was imported: what naming its faces needs. */
interface ImportedExtrude {
  id: string;
  sketch: SketchEntry;
  /** The Extrudo curves around the regions it extruded. */
  curves: string[];
  oneSided: boolean;
}

/** Where a Fusion sketch lands in Extrudo: a plane and a 2D map into its frame. */
interface Placement {
  plane: GeomRef;
  /** Fusion sketch (u, v) in cm → Extrudo plane (x, y) in mm. */
  map: (u: number, v: number) => Vec2;
  /** The 2D map mirrors (arcs change direction). */
  mirrored: boolean;
  /** Fusion's sketch normal points against the Extrudo plane's. */
  opposite: boolean;
}

/** Fusion's units in an expression are Extrudo's too, except a few spellings. */
function numberExpression(value: number, unit: string): string {
  const v = Number(value.toPrecision(12));
  if (unit === 'deg') return `${Number(((value * 180) / Math.PI).toPrecision(12))} deg`;
  if (unit === '' || unit === 'Text') return `${v}`;
  // Lengths are stored in cm.
  return `${Number((value * 10).toPrecision(12))} mm`;
}

/** What the new design is stamped with (the app passes a fresh ID and its version). */
export interface ImportOptions {
  id?: string;
  appVersion?: string;
}

export function f3dToDesign(
  f3d: F3dDesign,
  name: string,
  options: ImportOptions = {},
): ImportResult {
  const report: ImportReport = { imported: [], skipped: [], notes: [] };
  const d = Design.create({
    name,
    units: 'mm',
    ...(options.id ? { id: options.id as never } : {}),
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
  });
  const userNames = new Set<string>();

  // User parameters, in the order they were made.
  for (const p of [...f3d.userParameters].sort((a, b) => a.number - b.number)) {
    try {
      d.parameter(
        p.name,
        p.text !== undefined ? `'${p.text}'` : p.expression,
        p.comment ? { comment: p.comment } : {},
      );
      userNames.add(p.name);
    } catch (error) {
      // An expression Extrudo does not read: keep the value.
      try {
        d.parameter(
          p.name,
          numberExpression(p.value, p.unit),
          p.comment ? { comment: p.comment } : {},
        );
        userNames.add(p.name);
        report.notes.push(
          `Parameter ${p.name}: "${p.expression}" kept as its value (${(error as Error).message}).`,
        );
      } catch (inner) {
        report.notes.push(`Parameter ${p.name} skipped: ${(inner as Error).message}`);
      }
    }
  }

  /**
   * An input's expression: Fusion's own when it only names user parameters
   * (so the design stays driven by them), its value otherwise — dimension
   * parameters (`d12`) have no Extrudo counterpart yet.
   */
  const expressionOf = (p: ParameterValue, negate = false): string => {
    const names = p.expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    const units = new Set(['mm', 'cm', 'm', 'in', 'ft', 'deg', 'rad', 'um', 'mil']);
    const own = names.every((n) => units.has(n) || userNames.has(n));
    if (own && names.some((n) => userNames.has(n)))
      return negate ? `-(${p.expression})` : p.expression;
    return numberExpression(negate ? -p.value : p.value, p.unit);
  };

  const sketches = new Map<number, SketchEntry>();
  const extrudes = new Map<number, ImportedExtrude>();
  // Curves Fusion's own profiles run along are never construction geometry,
  // whatever the flag reading says.
  const profileCurves = new Map<number, Set<string>>();
  for (const f of f3d.features) {
    if (f.type !== 'extrude') continue;
    for (const operand of f.profiles) {
      const set = profileCurves.get(operand.sketch) ?? new Set<string>();
      for (const r of operand.regions ?? [])
        for (const t of [...r.outer, ...r.inner].flat()) set.add(String(t));
      profileCurves.set(operand.sketch, set);
    }
  }

  for (const feature of f3d.features) {
    if (feature.suppressed) {
      report.skipped.push({
        name: feature.name,
        kind: feature.kind,
        reason: 'suppressed in Fusion',
      });
      continue;
    }
    try {
      if (feature.type === 'sketch') {
        const placement = placeSketch(d, feature.sketch.frame, report, feature.name);
        if (!placement) {
          report.skipped.push({
            name: feature.name,
            kind: 'Sketch',
            reason: 'its plane is not parallel to an origin plane',
          });
          continue;
        }
        const tags = new Map<string, bigint>();
        const used = profileCurves.get(feature.sketch.id) ?? new Set<string>();
        const handle = d.sketch(
          placement.plane,
          (k) => drawSketch(k, feature, placement, tags, used, report),
          {
            name: feature.name,
          },
        );
        sketches.set(feature.sketch.id, { handle, placement, tags, fusion: feature.sketch });
        report.imported.push(feature.name);
      } else if (feature.type === 'extrude') {
        const made = extrude(d, feature, sketches, expressionOf, report);
        if (typeof made === 'string')
          report.skipped.push({ name: feature.name, kind: 'Extrude', reason: made });
        else {
          extrudes.set(feature.id, made);
          report.imported.push(feature.name);
        }
      } else if (feature.type === 'fillet' || feature.type === 'chamfer') {
        const reason = edgeTreatment(d, feature, extrudes, expressionOf, report);
        if (reason) report.skipped.push({ name: feature.name, kind: feature.kind, reason });
        else report.imported.push(feature.name);
      } else if (feature.kind === 'Component' || feature.kind === 'CreateComponent') {
        report.skipped.push({
          name: feature.name,
          kind: feature.kind,
          reason: 'components are not supported yet; their features join this design',
        });
      } else {
        report.skipped.push({
          name: feature.name,
          kind: feature.kind,
          reason: 'not supported yet',
        });
      }
    } catch (error) {
      report.skipped.push({
        name: feature.name,
        kind: feature.kind,
        reason: (error as Error).message,
      });
    }
  }
  return { design: d, report };
}

/** Picks the Extrudo plane for a Fusion sketch frame. */
function placeSketch(
  d: Design,
  m: Matrix,
  report: ImportReport,
  name: string,
): Placement | undefined {
  const X: Vec3 = [m[0] as number, m[4] as number, m[8] as number];
  const Y: Vec3 = [m[1] as number, m[5] as number, m[9] as number];
  const N: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  const O: Vec3 = [(m[3] as number) * 10, (m[7] as number) * 10, (m[11] as number) * 10];
  for (const p of ORIGIN_PLANES) {
    const n = p.frame.normal as Vec3;
    const c = dot(N, n);
    if (Math.abs(Math.abs(c) - 1) > EPS) continue;
    const offset = dot(O, n);
    let plane: GeomRef = { kind: 'plane', id: p.id };
    if (Math.abs(offset) > 1e-7) {
      const made = d.offsetPlane(
        { plane, distance: `${Number(offset.toPrecision(12))} mm` },
        { name: `${name} plane` },
      );
      plane = { kind: 'plane', id: made.id };
      report.notes.push(
        `${name}: drawn on a plane ${Number(offset.toFixed(4))} mm from ${p.label}.`,
      );
    }
    const x = p.frame.x as Vec3;
    const y = p.frame.y as Vec3;
    const origin: Vec3 = [n[0] * offset, n[1] * offset, n[2] * offset];
    const map = (u: number, v: number): Vec2 => {
      const w: Vec3 = [
        O[0] + 10 * (u * X[0] + v * Y[0]) - origin[0],
        O[1] + 10 * (u * X[1] + v * Y[1]) - origin[1],
        O[2] + 10 * (u * X[2] + v * Y[2]) - origin[2],
      ];
      return [dot(w, x), dot(w, y)];
    };
    // The 2D map's determinant: (X·x)(Y·y) − (Y·x)(X·y).
    const det = dot(X, x) * dot(Y, y) - dot(Y, x) * dot(X, y);
    return { plane, map, mirrored: det < 0, opposite: c < 0 };
  }
  return undefined;
}

/** Draws a Fusion sketch's curves and points; returns the tags of every curve made. */
function drawSketch(
  k: SketchBuilder,
  feature: F3dSketchFeature,
  placement: Placement,
  tags: Map<string, bigint>,
  profileCurves: Set<string>,
  report: ImportReport,
): void {
  const s: F3dSketch = feature.sketch;
  const points = new Map<number, SketchPoint>(s.points.map((p) => [p.id, p]));
  const at = (id: number, fallback: Vec3): Vec2 => {
    const p = points.get(id)?.at ?? fallback;
    return placement.map(p[0], p[1]);
  };
  /** Extrudo point handles per Fusion point: joined by coincident constraints. */
  const joined = new Map<number, ReturnType<SketchBuilder['point']>[]>();
  const join = (fusionPoint: number, handle: ReturnType<SketchBuilder['point']>) => {
    const list = joined.get(fusionPoint) ?? [];
    list.push(handle);
    joined.set(fusionPoint, list);
  };
  const used = new Set<number>();
  const setConstruction = (id: string) => {
    const tag = tags.get(id);
    if (tag !== undefined && profileCurves.has(String(tag))) return;
    const e = k.data.entities[id as keyof typeof k.data.entities] as
      | { construction?: boolean }
      | undefined;
    if (e && 'construction' in e) e.construction = true;
  };

  for (const l of s.lines) {
    const a = at(l.startPoint, l.start);
    const b = at(l.endPoint, l.end);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) continue;
    const h = k.line(a, b);
    join(l.startPoint, h.start);
    join(l.endPoint, h.end);
    used.add(l.startPoint).add(l.endPoint);
    if (l.tag !== undefined) tags.set(h.id, l.tag);
    if (l.construction) setConstruction(h.id);
  }
  for (const c of s.circulars) {
    const center = at(c.centerPoint, c.center);
    const r = c.radius * 10;
    used.add(c.centerPoint);
    if (
      c.startPoint === undefined ||
      c.endPoint === undefined ||
      Math.abs(c.endAngle - c.startAngle) >= 2 * Math.PI - 1e-9
    ) {
      const h = k.circle(center, r);
      join(c.centerPoint, h.center);
      if (c.tag !== undefined) tags.set(h.id, c.tag);
      if (c.construction) setConstruction(h.id);
      continue;
    }
    const start = arcEnd(c, c.startAngle, placement);
    const end = arcEnd(c, c.endAngle, placement);
    // Counter-clockwise about the arc's own normal in Fusion; the 2D map may mirror it.
    const ccw = c.normal[2] >= 0 !== placement.mirrored;
    const h = k.arcCentered(center, start, end, { reversed: !ccw });
    join(c.centerPoint, h.center);
    join(c.startPoint, h.start);
    join(c.endPoint, h.end);
    used.add(c.startPoint).add(c.endPoint);
    if (c.tag !== undefined) tags.set(h.id, c.tag);
    if (c.construction) setConstruction(h.id);
  }
  // Points on their own (hole centres, reference points), except the
  // projected origin every sketch has.
  for (const p of s.points) {
    if (used.has(p.id)) continue;
    const xy = placement.map(p.at[0], p.at[1]);
    if (Math.hypot(xy[0], xy[1]) < 1e-9 && p.tag === 100n) continue;
    join(p.id, k.point(xy));
  }
  // A Fusion point shared by several curves is one point; Extrudo gives each
  // curve its own, held together.
  let skipped = 0;
  for (const list of joined.values()) {
    const first = list[0];
    if (!first) continue;
    for (const other of list.slice(1)) {
      try {
        k.coincident(first, other);
      } catch {
        skipped++;
      }
    }
  }
  if (skipped) report.notes.push(`${feature.name}: ${skipped} coincident constraints left out.`);
}

/** An arc's end point in the Extrudo plane, from its angle about its own axes. */
function arcEnd(c: SketchCircular, angle: number, placement: Placement): Vec2 {
  const n = c.normal;
  const x = c.xAxis;
  // y = n × x
  const y: Vec3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const u = c.center[0] + c.radius * (Math.cos(angle) * x[0] + Math.sin(angle) * y[0]);
  const v = c.center[1] + c.radius * (Math.cos(angle) * x[1] + Math.sin(angle) * y[1]);
  return placement.map(u, v);
}

const keyOf = (tags: bigint[]) => [...new Set(tags.map(String))].sort().join(',');

/** Adds an extrude; returns why not when it cannot. */
function extrude(
  d: Design,
  f: F3dExtrude,
  sketches: Map<number, SketchEntry>,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  report: ImportReport,
): string | ImportedExtrude {
  if (!f.solid) return 'surface extrudes are not supported';
  if (f.profiles.length === 0) return 'its profile is a face, not a sketch profile';
  const param = (kind: string) => f.parameters.find((p) => p.kind === kind);
  const profiles: GeomRef[] = [];
  let placement: Placement | undefined;
  let entry: SketchEntry | undefined;
  for (const operand of f.profiles) {
    const sketch = sketches.get(operand.sketch);
    if (!sketch) return 'its sketch was not imported';
    placement ??= sketch.placement;
    entry ??= sketch;
    const regions = sketch.handle.regions;
    if (!operand.regions) {
      profiles.push(...sketch.handle.profiles());
      continue;
    }
    for (const want of operand.regions) {
      const refs = matchRegions(sketch.handle, regions, sketch.tags, want);
      if (refs.length === 0) {
        const have = regions
          .map((r) =>
            keyOf(
              r.outer.edges
                .map((e) => sketch.tags.get(e.curve))
                .filter((t): t is bigint => t !== undefined),
            ),
          )
          .slice(0, 8);
        return `profile region {${want.outer.map((l) => keyOf(l)).join('|')}} not found in the sketch (it has ${regions.length}: ${have.map((k) => `{${k}}`).join(' ')})`;
      }
      for (const ref of refs) if (!profiles.some((p) => p.id === ref.id)) profiles.push(ref);
    }
  }
  if (!placement || !entry) return 'no profile';
  const offset = param('ProfileOffset');
  if (offset && Math.abs(offset.value) > 1e-9) return 'a start offset is not supported yet';
  if (f.start === 'face' && offset === undefined)
    report.notes.push(`${f.name}: starts from a face; imported from the profile plane.`);

  const along = param('AlongDistance');
  const against = param('AgainstDistance');
  const symmetric = param('SymmetricDistance') ?? param('Distance');
  const taper = param('TaperAngle');
  const taper2 = param('Side2TaperAngle');

  // Side 1 runs along Fusion's sketch normal, reversed by the flag or a
  // negative distance; Extrudo's runs along its plane's normal unless flipped.
  const negative = (along?.value ?? 0) < 0;
  const flip = placement.opposite !== (f.reversed !== negative);
  const inputs: Record<string, unknown> = { profiles, operation: f.operation };
  if (f.direction === 'one-side') {
    if (along) inputs.distance = expressionOf(along, negative);
    else inputs.extent = 'through-all';
  } else if (f.direction === 'two-sides') {
    inputs.direction = 'two-sides';
    if (!along || !against) return 'a two-sided extrude without two distances';
    inputs.distance = expressionOf(along, negative);
    inputs.distance2 = expressionOf(against, against.value < 0);
    if (taper2 && Math.abs(taper2.value) > 1e-12) inputs.taper2 = expressionOf(taper2);
  } else {
    inputs.direction = 'symmetric';
    const dist = symmetric ?? along;
    if (!dist) inputs.extent = 'through-all';
    else inputs.distance = expressionOf(dist, dist.value < 0);
  }
  if (taper && Math.abs(taper.value) > 1e-12) inputs.taper = expressionOf(taper);
  if (flip) inputs.flip = true;
  const made = d.extrude(inputs as Parameters<Design['extrude']>[0], { name: f.name });
  const chosen = new Set(profiles.map((p) => p.id));
  const curves = new Set<string>();
  for (const region of entry.handle.regions) {
    if (!chosen.has(`${entry.handle.id}/${region.id}`)) continue;
    for (const loop of [region.outer, ...region.holes])
      for (const e of loop.edges) curves.add(e.curve);
  }
  return { id: made.id, sketch: entry, curves: [...curves], oneSided: f.direction === 'one-side' };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const round6 = (x: number) => Math.round(x * 1e6) / 1e6 || 0;
/** A direction with its first non-zero component positive, as Extrudo stores axes. */
const canonical = (v: Vec3): Vec3 => {
  const first = v.find((x) => Math.abs(x) > 1e-9) ?? 1;
  const k = first < 0 ? -1 : 1;
  return [round6(v[0] * k), round6(v[1] * k), round6(v[2] * k)];
};

interface EdgeShape {
  type: string;
  at: [number, number, number];
  dir: [number, number, number];
  size: number;
}

/**
 * An edge's geometry in mm, from its two faces' surfaces (cm): two planes
 * meet in a line, ended by the bounding faces that are planes; a plane
 * across a cylinder's axis cuts a circle. What Extrudo's fingerprint of
 * that edge would hold: type, midpoint (a circle: its centre), axis or
 * direction, length.
 */
function edgeShape(e: F3dEdge): EdgeShape | undefined {
  const a = e.faces[0].surface;
  const b = e.faces[1].surface;
  if (!a || !b) return undefined;
  const plane = (s: AsmSurface) => (s.kind === 'plane' ? s : undefined);
  const pa = plane(a);
  const pb = plane(b);
  if (pa && pb) {
    const u = cross(pa.normal, pb.normal);
    const uu = dot(u, u);
    if (uu < 1e-12) return undefined;
    const d1 = dot(pa.normal, pa.point);
    const d2 = dot(pb.normal, pb.point);
    const p0 = scale(add(scale(cross(pb.normal, u), d1), scale(cross(u, pa.normal), d2)), 1 / uu);
    const dir = scale(u, 1 / Math.sqrt(uu));
    const ts: number[] = [];
    for (const f of e.bounds) {
      const s = f.surface;
      if (s?.kind !== 'plane') continue;
      const nd = dot(s.normal, dir);
      if (Math.abs(nd) < 1e-9) continue;
      ts.push(dot(s.normal, sub(s.point, p0)) / nd);
    }
    if (ts.length < 2) return undefined;
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    if (t1 - t0 < 1e-9) return undefined;
    const mid = add(p0, scale(dir, (t0 + t1) / 2));
    return {
      type: 'line',
      at: [round6(mid[0] * 10), round6(mid[1] * 10), round6(mid[2] * 10)],
      dir: canonical(dir),
      size: round6((t1 - t0) * 10),
    };
  }
  const p = pa ?? pb;
  const c = a.kind === 'cone' ? a : b.kind === 'cone' ? b : undefined;
  if (p && c?.cylinder) {
    const axis = scale(c.axis, 1 / norm(c.axis));
    const along = dot(p.normal, axis);
    if (Math.abs(Math.abs(along) - 1) > 1e-6) return undefined;
    const center = add(c.center, scale(axis, dot(p.normal, sub(p.point, c.center)) / along));
    return {
      type: 'circle',
      at: [round6(center[0] * 10), round6(center[1] * 10), round6(center[2] * 10)],
      dir: canonical(axis),
      size: round6(2 * Math.PI * c.radius * 10),
    };
  }
  return undefined;
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** A Fusion sketch point (cm, sketch frame) in model space (cm). */
function toModel(m: Matrix, p: Vec3): Vec3 {
  const g = (i: number) => m[i] as number;
  return [
    g(0) * p[0] + g(1) * p[1] + g(2) * p[2] + g(3),
    g(4) * p[0] + g(5) * p[1] + g(6) * p[2] + g(7),
    g(8) * p[0] + g(9) * p[1] + g(10) * p[2] + g(11),
  ];
}

/**
 * The Extrudo name of a face Fusion's extrude made: an end cap (parallel to
 * the sketch, at the profile plane or not) or the side swept from one of the
 * curves around the extruded regions (a plane through a line's two ends, a
 * cylinder about a circle's or arc's centre).
 */
/** Why faces could not be named, counted (for the corpus tools). */
export const faceMisses: Record<string, number> = {};
const miss = (why: string): undefined => {
  faceMisses[why] = (faceMisses[why] ?? 0) + 1;
  return undefined;
};

function faceName(face: F3dFace, extrudes: Map<number, ImportedExtrude>): string | undefined {
  if (face.feature === undefined) return miss('no feature');
  const ex = extrudes.get(face.feature);
  if (!ex) return miss('feature not an imported extrude');
  const s = face.surface;
  if (!s) return miss('face not in the B-rep');
  const m = ex.sketch.fusion.frame;
  const O: Vec3 = [m[3] as number, m[7] as number, m[11] as number];
  const N: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  const lines = new Map(ex.sketch.fusion.lines.map((l) => [String(l.tag), l]));
  const circles = new Map(ex.sketch.fusion.circulars.map((c) => [String(c.tag), c]));
  const tol = 1e-5;
  if (s.kind === 'plane') {
    if (norm(cross(s.normal, N)) < 1e-6) {
      if (!ex.oneSided) return miss('cap of a two-sided extrude');
      return `extrude:${ex.id}:cap:${Math.abs(dot(sub(s.point, O), N)) < tol ? 'start' : 'end'}`;
    }
    for (const curve of ex.curves) {
      const l = lines.get(String(ex.sketch.tags.get(curve)));
      if (!l) continue;
      const on = (p: Vec3) => Math.abs(dot(sub(toModel(m, p), s.point), s.normal)) < tol;
      if (on(l.start) && on(l.end)) return `extrude:${ex.id}:side:${curve}`;
    }
    return miss('plane side: no curve');
  }
  if (s.kind === 'cone' && s.cylinder && norm(cross(s.axis, N)) < 1e-6) {
    for (const curve of ex.curves) {
      const c = circles.get(String(ex.sketch.tags.get(curve)));
      if (!c || Math.abs(c.radius - s.radius) > tol) continue;
      const off = sub(toModel(m, c.center), s.center);
      if (norm(cross(off, s.axis)) / Math.max(norm(s.axis), 1e-12) < tol)
        return `extrude:${ex.id}:side:${curve}`;
    }
    return miss('cylinder side: no curve');
  }
  return miss(`surface ${s.kind === 'other' ? s.type : s.kind}`);
}

/** Adds a fillet or chamfer on the edges that can be named; returns why not when none can. */
function edgeTreatment(
  d: Design,
  f: F3dEdgeFeature,
  extrudes: Map<number, ImportedExtrude>,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  report: ImportReport,
): string | undefined {
  const inputs: Record<string, unknown> = {};
  let set = 0;
  let total = 0;
  let named = 0;
  for (const s of f.sets) {
    const refs: GeomRef[] = [];
    for (const e of s.edges) {
      total++;
      const a = faceName(e.faces[0], extrudes);
      const b = faceName(e.faces[1], extrudes);
      const shape = edgeShape(e);
      const names = a && b && a !== b ? [a, b] : undefined;
      if (!names && !shape) continue;
      // The name, when both faces have one; the geometry always, so Extrudo
      // finds the edge where joins merged or split those faces.
      const id = names ? edgeName(names) : `e[f3d.edge.${f.id}.${total}]`;
      const ref: GeomRef = { kind: 'edge', id };
      if (shape) ref.fingerprint = { ...shape, ...(names ? { adj: [...names].sort() } : {}) };
      if (!refs.some((r) => r.id === id)) refs.push(ref);
      named++;
    }
    if (refs.length === 0 || !s.size || set >= 32) continue;
    const n = set === 0 ? '' : String(set + 1);
    inputs[`edges${n}`] = refs;
    if (f.type === 'fillet') inputs[`radius${n}`] = expressionOf(s.size);
    else {
      inputs[`distance${n}`] = expressionOf(s.size);
      if (s.size2) {
        if (s.size2.unit === 'deg') {
          inputs[`mode${n}`] = 'distance-angle';
          inputs[`angle${n}`] = expressionOf(s.size2);
        } else {
          inputs[`mode${n}`] = 'two-distances';
          inputs[`distanceB${n}`] = expressionOf(s.size2);
        }
      }
    }
    set++;
  }
  if (set === 0) return total === 0 ? 'no edges' : `none of its ${total} edges could be named`;
  if (named < total)
    report.notes.push(
      `${f.name}: ${total - named} of ${total} edges left out (faces not made by an imported extrude).`,
    );
  if (f.type === 'fillet') d.fillet(inputs as Parameters<Design['fillet']>[0], { name: f.name });
  else d.chamfer(inputs as Parameters<Design['chamfer']>[0], { name: f.name });
  return undefined;
}

/**
 * The Extrudo regions a Fusion region covers. Fusion names a region by the
 * curves along its boundary as they were when it was picked — every curve
 * where collinear ones overlap — and re-finds it after later edits. So the
 * region is rebuilt from those curves alone, and every region of the whole
 * sketch whose inside lies within it is taken: one region usually, several
 * where curves drawn later (or construction lines) cut it up.
 */
function matchRegions(
  handle: SketchHandle,
  regions: SketchHandle['regions'],
  tags: Map<string, bigint>,
  want: ProfileRegion,
): GeomRef[] {
  const data = handle.data;
  const outerTags = new Set(want.outer.flat().map(String));
  const allTags = new Set([...outerTags, ...want.inner.flat().map(String)]);
  // A sketch of the region's own curves (never construction: Fusion used them).
  const entities: Record<string, unknown> = {};
  for (const [id, tag] of tags) {
    if (!allTags.has(String(tag))) continue;
    const e = data.entities[id as keyof typeof data.entities] as
      | Record<string, unknown>
      | undefined;
    if (!e) continue;
    entities[id] = { ...e, construction: false };
    for (const key of ['start', 'end', 'center']) {
      const ref = e[key] as string | undefined;
      if (ref && data.entities[ref as keyof typeof data.entities])
        entities[ref] = data.entities[ref as keyof typeof data.entities];
    }
  }
  const own = detectProfiles({ entities, constraints: {}, dimensions: {} } as SketchData);
  const onOuter = (r: Profile) =>
    r.outer.edges.every((e) => outerTags.has(String(tags.get(e.curve))));
  const region = own.filter(onOuter).sort((a, b) => Math.abs(b.area) - Math.abs(a.area))[0];
  if (!region) return [];
  const holes = region.holes.map((h) => h.polygon);
  const inside = (p: readonly [number, number]) =>
    insidePolygon(region.outer.polygon, p) && !holes.some((h) => insidePolygon(h, p));
  const out: GeomRef[] = [];
  for (const r of regions) {
    if (r.text !== undefined) continue;
    const p = interiorPoint(
      r.outer.polygon,
      r.holes.map((h) => h.polygon),
    );
    if (p && inside(p)) out.push({ kind: 'profile', id: `${handle.id}/${r.id}` });
  }
  return out;
}
