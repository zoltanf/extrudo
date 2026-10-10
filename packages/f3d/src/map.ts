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
import { faceSketchFrame, ORIGIN_PLANES, type SketchData } from '@extrudo/core';
import {
  detectProfiles,
  insidePolygon,
  interiorPoint,
  type Profile,
} from '@extrudo/sketch/profiles';
import type { AsmSurface } from './asm';
import type { ProfileOperand, ProfileRegion } from './decode/extrude';
import type { ParameterValue } from './decode/parameters';
import type { RevolveAxis } from './decode/revolve';
import type { SketchCircular, SketchPoint, SketchSpline, Vec3 } from './decode/sketch-geometry';
import type {
  F3dCircularPattern,
  F3dDesign,
  F3dEdge,
  F3dEdgeFeature,
  F3dExtrude,
  F3dFace,
  F3dHole,
  F3dRevolve,
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

type ReadonlyVec3 = readonly [number, number, number];
const dot = (a: ReadonlyVec3, b: ReadonlyVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const EPS = 1e-6;

interface SketchEntry {
  handle: SketchHandle;
  placement: Placement;
  /** Extrudo curve ID → Fusion curve tag. */
  tags: Map<string, bigint>;
  /** Fusion text record → Extrudo text entity ID. */
  texts: Map<number, string>;
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

/** Extrudo's bundled fonts this import draws text in (`@extrudo/fonts`), by ID. */
const FONTS = {
  sans: { id: 'inter-regular@1', family: 'Inter' },
  bold: { id: 'inter-bold@1', family: 'Inter Bold' },
  serif: { id: 'noto-serif-regular@1', family: 'Noto Serif' },
  mono: { id: 'jetbrains-mono-regular@1', family: 'JetBrains Mono' },
  stencil: { id: 'allerta-stencil-regular@1', family: 'Allerta Stencil' },
};

/** Capital height over font size: Arial's, Fusion's usual font (and near most sans faces). */
const CAP_HEIGHT = 0.716;

/** The bundled font nearest a Fusion font family: Inter unless it is a serif, mono or stencil face. */
function fontFor(family: string): { id: string; family: string } {
  const f = family.toLowerCase();
  if (/mono|courier|consol|menlo/.test(f)) return FONTS.mono;
  if (/stencil/.test(f)) return FONTS.stencil;
  if (/times|georgia|garamond|cambria|serif/.test(f) && !/sans/.test(f)) return FONTS.serif;
  if (/bold|black|heavy/.test(f)) return FONTS.bold;
  return FONTS.sans;
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
  /** Fusion feature record → the Extrudo feature a pattern can replay for it. */
  const replayable = new Map<number, { id: string; name: string }>();
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

  /**
   * A copy of a sketch on a plane `cm` along its normal: where an extrude
   * with a start offset begins (Extrudo's extrude starts on its sketch).
   */
  const moved = new Map<string, SketchEntry | undefined>();
  const movedSketch = (entry: SketchEntry, cm: number, name: string): SketchEntry | undefined => {
    const key = `${entry.fusion.id}@${cm}`;
    if (moved.has(key)) return moved.get(key);
    const m = [...entry.fusion.frame];
    m[3] = (m[3] as number) + cm * (m[2] as number);
    m[7] = (m[7] as number) + cm * (m[6] as number);
    m[11] = (m[11] as number) + cm * (m[10] as number);
    const placement = placeSketch(d, m, report, name, entry.fusion.texts.length > 0);
    let made: SketchEntry | undefined;
    if (placement) {
      const fusion = { ...entry.fusion, frame: m };
      const copy: F3dSketchFeature = {
        type: 'sketch',
        id: -1,
        kind: 'Sketch',
        name,
        suppressed: false,
        parameters: [],
        sketch: fusion,
      };
      const tags = new Map<string, bigint>();
      const texts = new Map<number, string>();
      const used = profileCurves.get(fusion.id) ?? new Set<string>();
      const handle = d.sketch(
        placement.plane,
        (k) => drawSketch(k, copy, placement, { tags, texts }, used, report),
        { name },
      );
      made = { handle, placement, tags, texts, fusion };
    }
    moved.set(key, made);
    return made;
  };

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
        const placement = placeSketch(
          d,
          feature.sketch.frame,
          report,
          feature.name,
          feature.sketch.texts.length > 0,
        );
        if (!placement) {
          report.skipped.push({
            name: feature.name,
            kind: 'Sketch',
            reason: 'its plane is not along an origin axis',
          });
          continue;
        }
        const tags = new Map<string, bigint>();
        const texts = new Map<number, string>();
        const used = profileCurves.get(feature.sketch.id) ?? new Set<string>();
        const handle = d.sketch(
          placement.plane,
          (k) => drawSketch(k, feature, placement, { tags, texts }, used, report),
          {
            name: feature.name,
          },
        );
        sketches.set(feature.sketch.id, {
          handle,
          placement,
          tags,
          texts,
          fusion: feature.sketch,
        });
        report.imported.push(feature.name);
      } else if (feature.type === 'extrude') {
        const made = extrude(d, feature, sketches, extrudes, expressionOf, movedSketch, report);
        if (typeof made === 'string')
          report.skipped.push({ name: feature.name, kind: 'Extrude', reason: made });
        else {
          extrudes.set(feature.id, made);
          replayable.set(feature.id, { id: made.id, name: feature.name });
          report.imported.push(feature.name);
        }
      } else if (feature.type === 'hole') {
        const made = hole(d, feature, expressionOf, report);
        if (typeof made === 'string')
          report.skipped.push({ name: feature.name, kind: 'Hole', reason: made });
        else {
          replayable.set(feature.id, { id: made.id, name: feature.name });
          report.imported.push(feature.name);
        }
      } else if (feature.type === 'revolve') {
        const made = revolve(d, feature, sketches, expressionOf);
        if (typeof made === 'string')
          report.skipped.push({ name: feature.name, kind: 'Revolve', reason: made });
        else {
          replayable.set(feature.id, { id: made.id, name: feature.name });
          report.imported.push(feature.name);
        }
      } else if (feature.type === 'circular-pattern') {
        const reason = circularPattern(d, feature, replayable, sketches, expressionOf, report);
        if (reason) report.skipped.push({ name: feature.name, kind: feature.kind, reason });
        else report.imported.push(feature.name);
      } else if (feature.type === 'fillet' || feature.type === 'chamfer') {
        const reason = edgeTreatment(d, feature, extrudes, expressionOf, report);
        if (reason) report.skipped.push({ name: feature.name, kind: feature.kind, reason });
        else report.imported.push(feature.name);
      } else if (feature.kind === 'Component' || feature.kind === 'CreateComponent') {
        // The component's own features are on this timeline: they join the design.
        report.notes.push(
          `${feature.name}: components are not supported yet; its features are part of this design.`,
        );
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

/** The Extrudo frame of a sketch plane: its origin, axes and normal (mm). */
interface PlaneFrame {
  origin: ReadonlyVec3;
  x: ReadonlyVec3;
  y: ReadonlyVec3;
  normal: ReadonlyVec3;
}

/** Planes made for sketches so far, per design: two sketches on one plane share it. */
const madePlanes = new WeakMap<Design, Map<string, GeomRef>>();
const planeKey = (...values: number[]) => values.map((v) => Number(v.toPrecision(9))).join(',');

/**
 * Picks the Extrudo plane for a Fusion sketch frame: an origin plane, or one
 * moved along its normal, for a sketch parallel to one; for a sketch plane
 * along an origin axis, a plane turned about that axis from an origin plane
 * (and moved along its normal). A construction plane's frame follows its
 * normal alone (`faceSketchFrame`), which here is Fusion's sketch normal.
 */
function placeSketch(
  d: Design,
  m: Matrix,
  report: ImportReport,
  name: string,
  /** Never mirror the sketch (text reads backwards in a mirror): face Fusion's normal instead. */
  unmirrored = false,
): Placement | undefined {
  const X: Vec3 = [m[0] as number, m[4] as number, m[8] as number];
  const Y: Vec3 = [m[1] as number, m[5] as number, m[9] as number];
  const N: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  const O: Vec3 = [(m[3] as number) * 10, (m[7] as number) * 10, (m[11] as number) * 10];
  const made = madePlanes.get(d) ?? new Map<string, GeomRef>();
  madePlanes.set(d, made);
  const placed = (plane: GeomRef, f: PlaneFrame): Placement => {
    const map = (u: number, v: number): Vec2 => {
      const w: Vec3 = [
        O[0] + 10 * (u * X[0] + v * Y[0]) - f.origin[0],
        O[1] + 10 * (u * X[1] + v * Y[1]) - f.origin[1],
        O[2] + 10 * (u * X[2] + v * Y[2]) - f.origin[2],
      ];
      return [dot(w, f.x), dot(w, f.y)];
    };
    // The 2D map's determinant: (X·x)(Y·y) − (Y·x)(X·y).
    const det = dot(X, f.x) * dot(Y, f.y) - dot(Y, f.x) * dot(X, f.y);
    return { plane, map, mirrored: det < 0, opposite: dot(N, f.normal) < 0 };
  };
  /** The plane `base` (normal `n`) moved along `n` to the sketch's origin. */
  const moved = (base: GeomRef, n: Vec3, from: string): GeomRef => {
    const offset = dot(O, n);
    if (Math.abs(offset) <= 1e-7) return base;
    const key = `${base.id}@${planeKey(offset)}`;
    let plane = made.get(key);
    if (!plane) {
      const p = d.offsetPlane(
        { plane: base, distance: `${Number(offset.toPrecision(12))} mm` },
        { name: `${name} plane` },
      );
      plane = { kind: 'plane', id: p.id };
      made.set(key, plane);
    }
    report.notes.push(`${name}: drawn on a plane ${Number(offset.toFixed(4))} mm from ${from}.`);
    return plane;
  };
  for (const p of ORIGIN_PLANES) {
    const n = p.frame.normal as Vec3;
    if (Math.abs(Math.abs(dot(N, n)) - 1) > EPS) continue;
    const frame = { origin: scale(n, dot(O, n)), x: p.frame.x, y: p.frame.y, normal: n };
    if (unmirrored && placed({ kind: 'plane', id: p.id }, frame).mirrored) break;
    return placed(moved({ kind: 'plane', id: p.id }, n, p.label), frame);
  }
  for (const [axis, a] of ORIGIN_AXES) {
    if (Math.abs(dot(N, a)) > EPS) continue;
    // Turned right-handed about the axis from an origin plane through it:
    // that plane's normal goes to N.
    const base = ORIGIN_PLANES.find((p) => Math.abs(dot(p.frame.normal as Vec3, a)) < EPS);
    if (!base) continue;
    const zero = base.frame.normal as Vec3;
    const angle = (Math.atan2(dot(N, cross(a, zero)), dot(N, zero)) * 180) / Math.PI;
    const key = `${axis}:${planeKey(angle)}`;
    let turned = made.get(key);
    if (!turned) {
      const p = d.planeAtAngle(
        {
          axis: { kind: 'axis', id: axis },
          plane: { kind: 'plane', id: base.id },
          angle: `${Number(angle.toPrecision(12))} deg`,
        },
        { name: `${name} plane` },
      );
      turned = { kind: 'plane', id: p.id };
      made.set(key, turned);
    }
    const plane = moved(turned, N, `a plane at ${Number(angle.toFixed(4))}° to ${base.label}`);
    return placed(plane, faceSketchFrame(scale(N, dot(O, N)), N));
  }
  return undefined;
}

/**
 * Draws a Fusion sketch's curves, texts and points, noting the Fusion tag of
 * every curve and the record of every text it makes.
 */
function drawSketch(
  k: SketchBuilder,
  feature: F3dSketchFeature,
  placement: Placement,
  made: { tags: Map<string, bigint>; texts: Map<number, string> },
  profileCurves: Set<string>,
  report: ImportReport,
): void {
  const { tags } = made;
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
  for (const c of s.splines) {
    if (c.rho !== undefined) {
      const [p0, p1, p2] = c.poles as [Vec3, Vec3, Vec3];
      const start = at(c.startPoint ?? -1, p0);
      const end = at(c.endPoint ?? -1, p2);
      const h = k.conic(start, at(c.shoulderPoint ?? -1, p1), end, c.rho);
      const [hs, hm, he] = h.points;
      for (const [fusion, handle] of [
        [c.startPoint, hs],
        [c.shoulderPoint, hm],
        [c.endPoint, he],
      ] as const)
        if (fusion !== undefined && handle) {
          join(fusion, handle);
          used.add(fusion);
        }
      if (c.tag !== undefined) tags.set(h.id, c.tag);
      continue;
    }
    const shape = splineShape(c, placement);
    const first = shape.points[0] as Vec2;
    const last = shape.points.at(-1) as Vec2;
    // The ends sit on Fusion's own points, so neighbouring curves meet exactly.
    if (c.startPoint !== undefined) shape.points[0] = at(c.startPoint, c.poles[0] as Vec3);
    if (c.endPoint !== undefined && !shape.closed)
      shape.points[shape.points.length - 1] = at(c.endPoint, c.poles.at(-1) as Vec3);
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9 && !shape.closed) continue;
    const h =
      shape.mode === 'control'
        ? k.splineControl(shape.points, shape.knots ? { knots: shape.knots } : {})
        : k.spline(shape.points, shape.closed ? { closed: true } : {});
    const ends = [h.points[0], shape.closed ? h.points[0] : h.points.at(-1)];
    if (c.startPoint !== undefined && ends[0]) {
      join(c.startPoint, ends[0]);
      used.add(c.startPoint);
    }
    if (c.endPoint !== undefined && ends[1] && !shape.closed) {
      join(c.endPoint, ends[1]);
      used.add(c.endPoint);
    }
    if (c.tag !== undefined) tags.set(h.id, c.tag);
    if (c.construction) setConstruction(h.id);
  }
  for (const t of s.texts) {
    // Fusion's height is the font size and its box's bottom edge the
    // baseline; Extrudo's height is the capitals'. Centred in the box: the
    // font is Extrudo's own, so the width differs, and centring keeps the
    // text where it was.
    const base = [Math.cos(t.angle), Math.sin(t.angle)] as const;
    const up = [-base[1], base[0]] as const;
    const u = t.at[0] + (base[0] * t.width) / 2;
    const v = t.at[1] + (base[1] * t.width) / 2;
    const cap = t.height * CAP_HEIGHT;
    const font = fontFor(t.font);
    const h = k.text(
      placement.map(u, v),
      placement.map(u + up[0] * cap, v + up[1] * cap),
      { text: t.text, font: font.id, align: 'center' },
      { upright: false },
    );
    made.texts.set(t.id, h.id);
    report.notes.push(`${feature.name}: text "${t.text}" in ${t.font} is drawn in ${font.family}.`);
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

interface SplineShape {
  mode: 'control' | 'fit';
  points: Vec2[];
  /** A control spline's own clamped knots, 0 to 1 (absent: a single Bézier span). */
  knots?: number[];
  /** A fit spline that runs back round to its first point. */
  closed?: boolean;
}

/**
 * A Fusion spline as Extrudo draws it. Extrudo's control splines are clamped,
 * non-rational cubics: such a Fusion spline keeps its poles and knots (scaled
 * to 0..1); a single quadratic span is raised to the same curve as a cubic;
 * anything else (rational, other degrees, unclamped) becomes a fit spline
 * through points along it.
 */
function splineShape(c: SketchSpline, placement: Placement): SplineShape {
  const p = c.degree;
  const poles = c.poles.map((q) => placement.map(q[0], q[1]));
  const k = c.knots;
  const rational = c.weights.some((w) => Math.abs(w - (c.weights[0] as number)) > 1e-12);
  const clamped =
    k.slice(0, p + 1).every((x) => x === k[0]) && k.slice(-p - 1).every((x) => x === k.at(-1));
  if (!rational && clamped && p === 3) {
    const a = k[0] as number;
    const span = (k.at(-1) as number) - a;
    const knots = k.map((x) => Math.min(1, Math.max(0, (x - a) / span)));
    return poles.length === 4
      ? { mode: 'control', points: poles }
      : { mode: 'control', points: poles, knots };
  }
  if (!rational && clamped && p === 2 && poles.length === 3) {
    const [a, b, d] = poles as [Vec2, Vec2, Vec2];
    const third = (x: Vec2, y: Vec2): Vec2 => [
      x[0] + (2 / 3) * (y[0] - x[0]),
      x[1] + (2 / 3) * (y[1] - x[1]),
    ];
    return { mode: 'control', points: [a, third(a, b), third(d, b), d] };
  }
  const t0 = k[p] as number;
  const t1 = k[poles.length] as number;
  const n = Math.max(8, 4 * (poles.length - p));
  const points: Vec2[] = [];
  for (let i = 0; i <= n; i++) points.push(nurbsAt(c, poles, t0 + ((t1 - t0) * i) / n));
  const first = points[0] as Vec2;
  const last = points.at(-1) as Vec2;
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-7) {
    points.pop();
    return { mode: 'fit', points, closed: true };
  }
  return { mode: 'fit', points };
}

/** A point on a (rational) B-spline, by de Boor's algorithm. */
function nurbsAt(c: SketchSpline, poles: Vec2[], t: number): Vec2 {
  const p = c.degree;
  const k = c.knots;
  const last = poles.length - 1;
  let span = p;
  while (span < last && t >= (k[span + 1] as number)) span++;
  const d: [number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const i = j + span - p;
    const w = c.weights[i] ?? 1;
    const q = poles[i] as Vec2;
    d.push([q[0] * w, q[1] * w, w]);
  }
  for (let r = 1; r <= p; r++)
    for (let j = p; j >= r; j--) {
      const i = j + span - p;
      const den = (k[i + p - r + 1] as number) - (k[i] as number);
      const a = den === 0 ? 0 : (t - (k[i] as number)) / den;
      const x = d[j - 1] as [number, number, number];
      const y = d[j] as [number, number, number];
      d[j] = [x[0] + a * (y[0] - x[0]), x[1] + a * (y[1] - x[1]), x[2] + a * (y[2] - x[2])];
    }
  const h = d[p] as [number, number, number];
  return [h[0] / h[2], h[1] / h[2]];
}

const keyOf = (tags: bigint[]) => [...new Set(tags.map(String))].sort().join(',');

/** Adds an extrude; returns why not when it cannot. */
function extrude(
  d: Design,
  f: F3dExtrude,
  sketches: Map<number, SketchEntry>,
  extrudes: Map<number, ImportedExtrude>,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  movedSketch: (entry: SketchEntry, cm: number, name: string) => SketchEntry | undefined,
  report: ImportReport,
): string | ImportedExtrude {
  if (!f.solid) return 'surface extrudes are not supported';
  if (f.profiles.length === 0) return 'its profile is a face, not a sketch profile';
  const param = (kind: string) => f.parameters.find((p) => p.kind === kind);
  // Extrudo's extrude starts on its sketch: a start offset, or a start face
  // parallel to the sketch, takes the profiles from a copy of their sketch
  // that far along its normal (cm).
  const offset = param('ProfileOffset');
  const startFace = f.start === 'face' ? f.faces[0] : undefined;
  const toFace = param('Side1Offset') ? f.faces[startFace ? 1 : 0] : undefined;
  let faceNote = false;
  const shiftFor = (own: SketchEntry): number => {
    let cm = offset ? offset.value : 0;
    if (startFace) {
      const at = planeOffset(startFace, own.fusion.frame);
      if (at === undefined) faceNote = true;
      else cm += at;
    }
    return Math.abs(cm) > 1e-9 ? cm : 0;
  };
  const selected = selectProfiles(f.profiles, (operand) => {
    const own = sketches.get(operand.sketch);
    if (!own) return 'its sketch was not imported';
    const shift = shiftFor(own);
    const sketch = shift ? movedSketch(own, shift, `${f.name} start`) : own;
    return sketch ?? 'its offset start plane is not along an origin axis';
  });
  if (typeof selected === 'string') return selected;
  const { profiles, entry } = selected;
  const placement = entry.placement;
  if (faceNote)
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
  if (f.direction === 'one-side' && toFace) {
    // Up to a face: a plane parallel to the start becomes the distance to it
    // (past it by the offset); another face is named if it can be.
    const past = param('Side1Offset')?.value ?? 0;
    const to = planeOffset(toFace, entry.fusion.frame);
    if (to !== undefined) {
      const total = to + Math.sign(to) * past;
      if (Math.abs(total) < 1e-9) return 'it goes up to a face in its own plane';
      inputs.distance = numberExpression(Math.abs(total), 'cm');
      if (placement.opposite !== total < 0) inputs.flip = true;
      report.notes.push(`${f.name}: up to a face, imported as a distance.`);
    } else {
      const name = faceName(toFace, extrudes);
      if (!name) return 'it goes up to a face that could not be found';
      inputs.extent = 'to-object';
      inputs.toObject = { kind: 'face', id: name };
      if (Math.abs(past) > 1e-12) inputs.offset = numberExpression(past, 'cm');
    }
  } else if (f.direction === 'one-side') {
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
  if (flip && !(f.direction === 'one-side' && toFace)) inputs.flip = true;
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

/** The Extrudo profiles a feature's profile operands select, and the sketch they are in. */
function selectProfiles(
  operands: ProfileOperand[],
  sketchOf: (operand: ProfileOperand) => SketchEntry | string,
): { profiles: GeomRef[]; entry: SketchEntry } | string {
  const profiles: GeomRef[] = [];
  let entry: SketchEntry | undefined;
  for (const operand of operands) {
    const sketch = sketchOf(operand);
    if (typeof sketch === 'string') return sketch;
    entry ??= sketch;
    if (operand.text !== undefined) {
      const text = sketch.texts.get(operand.text);
      if (!text) return 'its text was not imported';
      profiles.push({ kind: 'sketchEntity', id: `${sketch.handle.id}/${text}` });
      continue;
    }
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
  return entry ? { profiles, entry } : 'no profile';
}

/**
 * Holes at their centres: a sketch of the centre points on the plane of the
 * face they start on (when Extrudo can place a sketch there), and one hole
 * feature drilling into that face. Returns the feature made, or why not.
 */
function hole(
  d: Design,
  f: F3dHole,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  report: ImportReport,
): string | { id: string } {
  if (!f.plane) return 'its face was not found';
  if (f.centres.length === 0) return 'its centres were not found';
  const { origin: O, x: X, y: Y } = f.plane;
  const N = cross(X, Y);
  const m: Matrix = [
    X[0],
    Y[0],
    N[0],
    O[0],
    X[1],
    Y[1],
    N[1],
    O[1],
    X[2],
    Y[2],
    N[2],
    O[2],
    0,
    0,
    0,
    1,
  ];
  const placement = placeSketch(d, m, report, `${f.name} face`);
  if (!placement) return 'its face is not along an origin axis';
  const points: ReturnType<SketchBuilder['point']>[] = [];
  d.sketch(
    placement.plane,
    (k) => {
      for (const c of f.centres) {
        const w = sub(c, O);
        points.push(k.point(placement.map(dot(w, X), dot(w, Y))));
      }
    },
    { name: `${f.name} centres` },
  );
  const param = (kind: string) => f.parameters.find((p) => p.kind === kind);
  const inputs: Record<string, unknown> = {
    plane: placement.plane,
    points: points.map((p) => p.ref()),
    extent: 'blind',
  };
  const set = (input: string, kind: string) => {
    const p = param(kind);
    if (p) inputs[input] = expressionOf(p);
  };
  set('diameter', 'HoleDiameter');
  set('depth', 'HoleDepth');
  // A flat bottom is 180° in Fusion, 0° in Extrudo.
  const tip = param('TipAngle');
  if (tip) inputs.tipAngle = tip.value >= Math.PI - 1e-9 ? '0 deg' : expressionOf(tip);
  if (param('CSDiameter')) {
    inputs.type = 'countersink';
    set('csDiameter', 'CSDiameter');
    set('csAngle', 'CSAngle');
  } else if (param('CBDiameter')) {
    inputs.type = 'counterbore';
    set('cbDiameter', 'CBDiameter');
    set('cbDepth', 'CBDepth');
  }
  // Extrudo drills against its plane's normal; Fusion against N, unless flipped.
  if (placement.opposite !== f.flipped) inputs.flip = true;
  return { id: d.hole(inputs as Parameters<Design['hole']>[0], { name: f.name }).id };
}

const ORIGIN_AXES: [string, Vec3][] = [
  ['origin:x', [1, 0, 0]],
  ['origin:y', [0, 1, 0]],
  ['origin:z', [0, 0, 1]],
];

/**
 * An Extrudo reference for a Fusion axis: an origin axis, or a line of an
 * imported sketch (`only`: of that sketch alone); with the sign of its
 * direction against Fusion's.
 */
function axisRef(
  axis: RevolveAxis,
  sketches: Map<number, SketchEntry>,
  only?: SketchEntry,
): { ref: GeomRef; sign: number } | undefined {
  const { point: P, direction: D } = axis;
  const u = scale(D, 1 / norm(D));
  for (const [id, a] of ORIGIN_AXES)
    if (norm(cross(u, a)) < 1e-9 && norm(cross(P, a)) < 1e-6)
      return { ref: { kind: 'axis', id }, sign: Math.sign(dot(u, a)) };
  const entry = axis.sketch !== undefined ? sketches.get(axis.sketch) : undefined;
  if (!entry || axis.tag === undefined || (only && entry !== only)) return undefined;
  const tag = String(axis.tag);
  const line = entry.fusion.lines.find((l) => String(l.tag) === tag);
  const id = [...entry.tags].find(([, t]) => String(t) === tag)?.[0];
  if (!line || !id) return undefined;
  const m = entry.fusion.frame;
  const along = sub(toModel(m, line.end), toModel(m, line.start));
  return {
    ref: { kind: 'sketchEntity', id: `${entry.handle.id}/${id}` },
    sign: Math.sign(dot(along, u)),
  };
}

/**
 * A revolve about an origin axis, or about a line of its own sketch. The
 * angle turns right-handed about Fusion's axis direction, as about
 * Extrudo's; a full turn has no direction. Returns the feature made, or why
 * not.
 */
function revolve(
  d: Design,
  f: F3dRevolve,
  sketches: Map<number, SketchEntry>,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
): string | { id: string } {
  if (!f.axis) return 'its axis was not found';
  if (f.profiles.length === 0) return 'its profile is a face, not a sketch profile';
  const selected = selectProfiles(
    f.profiles,
    (operand) => sketches.get(operand.sketch) ?? 'its sketch was not imported',
  );
  if (typeof selected === 'string') return selected;
  const { profiles, entry } = selected;
  const m = entry.fusion.frame;
  const O: Vec3 = [m[3] as number, m[7] as number, m[11] as number];
  const N: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  const { point: P, direction: D } = f.axis;
  const u = scale(D, 1 / norm(D));
  if (Math.abs(dot(sub(P, O), N)) > 1e-6 || Math.abs(dot(u, N)) > 1e-6)
    return "its axis is not in its profile's plane";
  const axis = axisRef(f.axis, sketches, entry);
  if (!axis) return 'its axis is not an origin axis or a line of its sketch';
  const along = f.parameters.find((p) => p.kind === 'AlongAngle');
  const negative = (along?.value ?? 0) < 0;
  const inputs: Record<string, unknown> = { profiles, axis: axis.ref, operation: f.operation };
  if (along) inputs.angle = expressionOf(along, negative);
  if (axis.sign < 0 !== negative) inputs.flip = true;
  return { id: d.revolve(inputs as Parameters<Design['revolve']>[0], { name: f.name }).id };
}

/**
 * A circular pattern of features: the tools of the imported features it
 * repeats, replayed round an origin axis or a sketch line and joined or cut
 * as each feature was. Features Extrudo does not replay (fillets, chamfers)
 * or did not import are left out with a note.
 */
function circularPattern(
  d: Design,
  f: F3dCircularPattern,
  made: Map<number, { id: string; name: string }>,
  sketches: Map<number, SketchEntry>,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  report: ImportReport,
): string | undefined {
  if (f.objects !== 'features' || f.features.length === 0)
    return 'it repeats faces (only features are imported)';
  if (!f.axis) return 'its axis was not found';
  if (!f.count) return 'its count was not found';
  const features: GeomRef[] = [];
  let left = 0;
  for (const record of f.features) {
    const feature = made.get(record);
    if (feature) features.push({ kind: 'feature', id: feature.id });
    else left++;
  }
  if (features.length === 0) return 'none of the features it repeats was imported';
  if (left)
    report.notes.push(
      `${f.name}: ${left} of the ${f.features.length} features it repeats left out (not imported, or a fillet or chamfer).`,
    );
  const axis = axisRef(f.axis, sketches);
  if (!axis) return 'its axis is not an origin axis or a sketch line';
  const angle = f.parameters.find((p) => p.kind === 'TotalAngle');
  const inputs: Record<string, unknown> = {
    objects: 'features',
    features,
    axis: axis.ref,
    count: expressionOf(f.count),
  };
  if (angle) inputs.angle = expressionOf(angle, axis.sign < 0);
  d.circularPattern(inputs as Parameters<Design['circularPattern']>[0], { name: f.name });
  return undefined;
}

/**
 * How far along a sketch's normal a face's plane lies from the sketch plane
 * (cm), when the face is a plane parallel to it.
 */
function planeOffset(face: F3dFace, m: Matrix): number | undefined {
  const s = face.surface;
  if (s?.kind !== 'plane') return undefined;
  const N: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  if (norm(cross(s.normal, N)) > 1e-6) return undefined;
  const O: Vec3 = [m[3] as number, m[7] as number, m[11] as number];
  return dot(sub(s.point, O), N);
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
/**
 * A point inside a region, once per region: `interiorPoint` is slow on long
 * spline outlines, and every wanted region tests every region of the sketch.
 */
const probes = new WeakMap<Profile, readonly [number, number] | undefined>();
function probeOf(r: Profile): readonly [number, number] | undefined {
  if (!probes.has(r))
    probes.set(
      r,
      interiorPoint(
        r.outer.polygon,
        r.holes.map((h) => h.polygon),
      ),
    );
  return probes.get(r);
}

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
    const refs = [e.start, e.end, e.center, ...((e.points as unknown[] | undefined) ?? [])];
    for (const ref of refs)
      if (typeof ref === 'string' && data.entities[ref as keyof typeof data.entities])
        entities[ref] = data.entities[ref as keyof typeof data.entities];
  }
  const own = detectProfiles({ entities, constraints: {}, dimensions: {} } as SketchData);
  const onOuter = (r: Profile) =>
    r.outer.edges.every((e) => outerTags.has(String(tags.get(e.curve))));
  const region = own.filter(onOuter).sort((a, b) => Math.abs(b.area) - Math.abs(a.area))[0];
  if (!region) return staleRegion(handle, regions, tags, outerTags);
  const holes = region.holes.map((h) => h.polygon);
  const inside = (p: readonly [number, number]) =>
    insidePolygon(region.outer.polygon, p) && !holes.some((h) => insidePolygon(h, p));
  const out: GeomRef[] = [];
  for (const r of regions) {
    if (r.text !== undefined) continue;
    const p = probeOf(r);
    if (p && inside(p)) out.push({ kind: 'profile', id: `${handle.id}/${r.id}` });
  }
  return out;
}

/**
 * A region whose curves were edited after it was picked: some of the curves
 * Fusion lists are gone (redrawn under new IDs), so its outline no longer
 * closes. The smallest region of the sketch whose outline still runs along
 * every listed curve that is left — at least two of them — stands in for it.
 */
function staleRegion(
  handle: SketchHandle,
  regions: SketchHandle['regions'],
  tags: Map<string, bigint>,
  outerTags: Set<string>,
): GeomRef[] {
  const left = new Set([...tags.values()].map(String).filter((t) => outerTags.has(t)));
  if (left.size < 2 || left.size === outerTags.size) return [];
  const best = regions
    .filter((r) => {
      if (r.text !== undefined) return false;
      const along = new Set(r.outer.edges.map((e) => String(tags.get(e.curve))));
      return [...left].every((t) => along.has(t));
    })
    .sort((a, b) => Math.abs(a.area) - Math.abs(b.area))[0];
  return best ? [{ kind: 'profile', id: `${handle.id}/${best.id}` }] : [];
}
