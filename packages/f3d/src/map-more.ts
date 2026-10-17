/**
 * Mapping of the features added after the first import (ADR-0083's
 * amendment of 2026-10-11): mirror, rectangular pattern, sweep, split body, thread and
 * torus (2026-10-14). Each
 * returns why it was left out, or what it made.
 */
import type { Design, GeomRef } from '@extrudo/api';
import { ORIGIN_PLANES } from '@extrudo/core';
import { type CopiedObjects, cantorPair } from './decode/copies';
import type { ModelPlane } from './decode/hole';
import type { ParameterValue } from './decode/parameters';
import type { RevolveAxis } from './decode/revolve';
import type { Vec3 } from './decode/sketch-geometry';
import {
  axisRef,
  type ImportReport,
  placeSketch,
  regionCurves,
  type SketchEntry,
  selectProfiles,
} from './map';
import type {
  F3dFace,
  F3dMirror,
  F3dPathPattern,
  F3dRectangularPattern,
  F3dSplit,
  F3dSweep,
  F3dThread,
  F3dTorus,
  Matrix,
} from './model';
import { type PathPiece, type ProfileCurve, type SweptFaces, sweptFaces } from './sweep-faces';

/** What the copying features need from the import so far. */
export interface CopyContext {
  /** f3d feature record → the Extrudo feature a pattern can replay for it. */
  made: Map<number, { id: string; name: string }>;
  sketches: Map<number, SketchEntry>;
  expressionOf: (p: ParameterValue, negate?: boolean) => string;
  /** f3d body records → Extrudo body references, when every one is known. */
  bodies: (records: number[]) => GeomRef[] | undefined;
  report: ImportReport;
}

const ORIGIN_AXES: [string, Vec3][] = [
  ['origin:x', [1, 0, 0]],
  ['origin:y', [0, 1, 0]],
  ['origin:z', [0, 0, 1]],
];

/**
 * An Extrudo reference for a direction (where it lies does not matter): an
 * origin axis parallel to it, else a line of an imported sketch; with the
 * sign of the reference's direction against the file's.
 */
export function directionRef(
  axis: RevolveAxis,
  sketches: Map<number, SketchEntry>,
): { ref: GeomRef; sign: number } | undefined {
  const D = axis.direction;
  const n = Math.hypot(D[0], D[1], D[2]);
  for (const [id, a] of ORIGIN_AXES) {
    const along = (D[0] * a[0] + D[1] * a[1] + D[2] * a[2]) / n;
    if (Math.abs(Math.abs(along) - 1) < 1e-9)
      return { ref: { kind: 'axis', id }, sign: Math.sign(along) };
  }
  return axisRef({ ...axis, point: [0, 0, 0] }, sketches);
}

/**
 * The Extrudo plane for a plane in model space: an origin plane, one moved
 * along its normal, or one turned about an origin axis (as a sketch's).
 */
function planeRef(
  d: Design,
  plane: ModelPlane,
  name: string,
  report: ImportReport,
  /** What the feature does in the plane, for the note ("mirrors in"). */
  verb: string,
): GeomRef | undefined {
  const { origin: O, x: X, y: Y } = plane;
  const N: Vec3 = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  const m = [X[0], Y[0], N[0], O[0], X[1], Y[1], N[1], O[1], X[2], Y[2], N[2], O[2], 0, 0, 0, 1];
  const notes: ImportReport = { imported: [], skipped: [], notes: [] };
  const placed = placeSketch(d, m, notes, name);
  for (const note of notes.notes) report.notes.push(note.replace(': drawn on ', `: ${verb} `));
  return placed?.plane;
}

/** The features or bodies a mirror or pattern copies, as Extrudo inputs; or why not. */
function copiedInputs(
  f: CopiedObjects & { name: string },
  context: CopyContext,
): string | Record<string, unknown> {
  if (f.objects === 'faces') return 'it copies faces (only features and bodies are imported)';
  if (f.objects === 'bodies') {
    const bodies = context.bodies(f.bodies);
    if (!bodies) return 'a body it copies was not imported as one body of one feature';
    return { objects: 'bodies', bodies };
  }
  const features: GeomRef[] = [];
  let left = 0;
  for (const record of f.features) {
    const feature = context.made.get(record);
    if (feature) features.push({ kind: 'feature', id: feature.id });
    else left++;
  }
  if (features.length === 0) return 'none of the features it copies was imported';
  if (left)
    context.report.notes.push(
      `${f.name}: ${left} of the ${f.features.length} features it copies left out (not imported, or a fillet or chamfer).`,
    );
  return { objects: 'features', features };
}

/** What a mirror or pattern made, for naming the faces it copied (`FaceNaming.copies`). */
export interface MadeCopies {
  op: 'pattern' | 'mirror';
  id: string;
  /** Extrudo's label of the file's instance code. */
  label: (code: number) => string | undefined;
}

/** A mirror of features or bodies in a plane. */
export function mirror(d: Design, f: F3dMirror, context: CopyContext): string | MadeCopies {
  if (!f.plane) return 'its plane was not found';
  const copied = copiedInputs(f, context);
  if (typeof copied === 'string') return copied;
  const plane = planeRef(d, f.plane, f.name, context.report, 'mirrors in');
  if (!plane) return 'its plane is not along an origin axis';
  const made = d.mirror({ ...copied, plane } as Parameters<Design['mirror']>[0], { name: f.name });
  return { op: 'mirror', id: made.id, label: () => '' };
}

/**
 * A rectangular pattern of features or bodies along one or two directions.
 * The file's distance is the whole extent from the first instance to the
 * last (both patterns in the corpus fit only that), signed along the
 * direction's line.
 */
export function rectangularPattern(
  d: Design,
  f: F3dRectangularPattern,
  context: CopyContext,
): string | MadeCopies {
  const copied = copiedInputs(f, context);
  if (typeof copied === 'string') return copied;
  const inputs: Record<string, unknown> = { ...copied };
  const distances = [
    f.parameters.find((p) => p.kind === 'uSpaceDistance'),
    f.parameters.find((p) => p.kind === 'vSpaceDistance'),
  ];
  for (const i of [0, 1]) {
    const count = f.counts[i];
    if (!count || (i === 1 && count.value <= 1)) continue;
    const axis = f.directions[i];
    const distance = distances[i];
    if (!axis || !distance) return `its direction ${i + 1} was not found`;
    const dir = directionRef(axis, context.sketches);
    if (!dir) return `its direction ${i + 1} is not an origin axis or a sketch line`;
    const n = i + 1;
    inputs[`direction${n}`] = dir.ref;
    inputs[`count${n}`] = context.expressionOf(count);
    inputs[`distance${n}`] = context.expressionOf(distance, dir.sign < 0);
    inputs[`measure${n}`] = 'extent';
  }
  if (!inputs.direction1) return 'its count was not found';
  const made = d.rectangularPattern(inputs as Parameters<Design['rectangularPattern']>[0], {
    name: f.name,
  });
  // The file's code pairs the instance's indexes (u from 1, the original's, v from 0); a row only.
  const row = inputs.direction2 === undefined;
  const label = (code: number) => {
    const [u, v] = cantorPair(code);
    return row && v === 0 && u >= 2 ? String(u - 1) : undefined;
  };
  return { op: 'pattern', id: made.id, label };
}

/**
 * A sweep of sketch profiles along a chain of sketch curves. Extrudo sweeps
 * the whole path, from its end nearer the profile; the file's fractions of
 * the path (`AlongDistance` from the profile, `AgainstDistance` back from
 * it) must cover the whole path one way.
 */
export function sweep(
  d: Design,
  f: F3dSweep,
  sketches: Map<number, SketchEntry>,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  participants: (records: number[], operation?: string, name?: string) => GeomRef[] | undefined,
  report: ImportReport,
): string | { id: string; faces?: SweptFaces } {
  if (f.profiles.length === 0) return 'its profile is a face, not a sketch profile';
  if (f.pathEdges) return 'its path runs along body edges (only sketch curves are imported)';
  if (f.paths.length !== 1)
    return f.paths.length ? 'it follows a guide rail' : 'its path was not found';
  const param = (kind: string) => f.parameters.find((p) => p.kind === kind)?.value ?? 0;
  const along = param('AlongDistance');
  const against = param('AgainstDistance');
  if (Math.abs(along - 1) > 1e-9 && Math.abs(against - 1) > 1e-9)
    return 'it follows only part of its path';
  if (Math.abs(param('TaperAngle')) > 1e-12) return 'it tapers (Extrudo sweeps scale instead)';
  const selected = selectProfiles(
    f.profiles,
    (operand) => sketches.get(operand.sketch) ?? 'its sketch was not imported',
    (text) => report.notes.push(`${f.name}: ${text}`),
  );
  if (typeof selected === 'string') return selected;
  const path: GeomRef[] = [];
  for (const curve of f.paths[0] ?? []) {
    const entry = sketches.get(curve.sketch);
    if (!entry) return "its path's sketch was not imported";
    const tag = String(curve.tag);
    const ids = [...entry.tags].filter(([, t]) => String(t) === tag).map(([id]) => id);
    if (ids.length === 0) return 'a curve of its path was not found in its sketch';
    for (const id of ids) path.push({ kind: 'sketchEntity', id: `${entry.handle.id}/${id}` });
  }
  if (path.length === 0) return 'its path was not found';
  const inputs: Record<string, unknown> = {
    profiles: selected.profiles,
    path,
    operation: f.operation,
  };
  const twist = f.parameters.find((p) => p.kind === 'TwistAngle');
  if (twist && Math.abs(twist.value) > 1e-12) inputs.twist = expressionOf(twist);
  const bodies =
    f.operation === 'new-body' ? undefined : participants(f.participants, f.operation, f.name);
  if (bodies) inputs.bodies = bodies;
  const id = d.sweep(inputs as Parameters<Design['sweep']>[0], { name: f.name }).id;
  const faces = sweepFaces(f.paths[0] ?? [], sketches, selected.entry, selected.profiles);
  return faces ? { id, faces } : { id };
}

/** What naming the sweep's faces needs: its path pieces and profile curves in model space. */
function sweepFaces(
  path: F3dSweep['paths'][number],
  sketches: Map<number, SketchEntry>,
  entry: SketchEntry,
  profiles: GeomRef[],
): SweptFaces | undefined {
  const pieces: PathPiece[] = [];
  for (const ref of path) {
    const source = sketches.get(ref.sketch)?.source;
    if (!source) return undefined;
    const m = source.frame;
    const tag = String(ref.tag);
    const line = source.lines.find((l) => String(l.tag) === tag);
    const arc = source.circulars.find((c) => String(c.tag) === tag);
    if (line)
      pieces.push({ kind: 'line', a: modelPoint(m, line.start), b: modelPoint(m, line.end) });
    else if (arc) {
      const y = crossOf(arc.normal, arc.xAxis);
      const at = (θ: number): Vec3 =>
        modelPoint(
          m,
          [0, 1, 2].map(
            (i) =>
              (arc.center[i] as number) +
              arc.radius *
                (Math.cos(θ) * (arc.xAxis[i] as number) + Math.sin(θ) * (y[i] as number)),
          ) as Vec3,
        );
      const centre = modelPoint(m, arc.center);
      const axis = sub3(modelPoint(m, arc.normal), modelPoint(m, [0, 0, 0]));
      pieces.push({ kind: 'arc', a: at(arc.startAngle), b: at(arc.endAngle), centre, axis });
    } else {
      // A clamped spline: it runs from its first pole to its last, along the poles beside them.
      const spline = source.splines.find((c) => String(c.tag) === tag);
      const poles = spline?.poles.map((q) => modelPoint(m, q)) ?? [];
      const k = spline ? spline.degree + 1 : 0;
      const knots = spline?.knots ?? [];
      const clamped =
        poles.length >= 2 &&
        knots.length >= 2 * k &&
        knots.slice(0, k).every((v) => v === knots[0]) &&
        knots.slice(-k).every((v) => v === knots[knots.length - 1]);
      if (!clamped) return undefined;
      const a = poles[0] as Vec3;
      const b = poles[poles.length - 1] as Vec3;
      const ta = sub3(poles[1] as Vec3, a);
      const tb = sub3(b, poles[poles.length - 2] as Vec3);
      pieces.push({ kind: 'curve', a, b, ta, tb, points: poles });
    }
  }
  const m = entry.source.frame;
  const curves: ProfileCurve[] = [];
  for (const name of regionCurves(entry, profiles)) {
    const c = entry.curves.get(name);
    if (!c) continue;
    if ('center' in c)
      curves.push({ name, kind: 'arc', centre: modelPoint(m, c.center), radius: c.radius });
    else curves.push({ name, kind: 'line', a: modelPoint(m, c.start), b: modelPoint(m, c.end) });
  }
  const origin: Vec3 = [m[3] as number, m[7] as number, m[11] as number];
  const normal: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  return sweptFaces(pieces, { origin, normal }, curves);
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossOf = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** A split of bodies by a plane, keeping both sides. */
export function splitBody(d: Design, f: F3dSplit, context: CopyContext): string | undefined {
  if (!f.plane) return 'it splits with a face (only planes are imported)';
  if (f.bodies.length === 0) return 'the bodies it splits were not found';
  const bodies = context.bodies(f.bodies);
  if (!bodies) return 'a body it splits was not imported as one body of one feature';
  const plane = planeRef(d, f.plane, f.name, context.report, 'splits on');
  if (!plane) return 'its plane is not along an origin axis';
  d.splitBody({ bodies, plane } as Parameters<Design['splitBody']>[0], { name: f.name });
  return undefined;
}

/**
 * A modeled thread on cylindrical faces, at the file's major diameter and
 * pitch with no clearance (the file's diameters are the thread's own).
 * Extrudo's tooth is the 60° ISO profile: a 55° pipe thread comes out a
 * little deeper. The file first resizes the face to the thread's crest;
 * Extrudo cuts the thread into the face as it is, so a hole wider than the
 * thread is left out.
 */
export function thread(
  d: Design,
  f: F3dThread,
  /** The Extrudo name of a face, and its sketch circle's radius (cm) where known. */
  faceName: (face: F3dFace) => { id: string; radius?: number | undefined } | undefined,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  report: ImportReport,
): string | undefined {
  const { spec } = f;
  const faces: GeomRef[] = [];
  for (const face of f.faces) {
    const named = faceName(face);
    if (!named || faces.some((r) => r.id === named.id)) continue;
    // The file resizes the face to the thread; Extrudo only cuts into it.
    if (!spec.external && named.radius !== undefined && named.radius >= spec.major / 2)
      return 'its hole is wider than the thread (the file fills it in to the thread first)';
    faces.push({ kind: 'face', id: named.id });
  }
  if (faces.length === 0)
    return f.faces.length === 0 ? 'its face was not found' : 'its face could not be named';
  const mm = (cm: number) => `${Number((cm * 10).toPrecision(12))} mm`;
  const inputs: Record<string, unknown> = {
    faces,
    diameter: mm(spec.major),
    pitch: mm(spec.pitch),
    tolerance: '0 mm',
  };
  if (!spec.full) {
    const length = f.parameters.find((p) => p.kind === 'ThreadLength');
    const offset = f.parameters.find((p) => p.kind === 'ThreadOffset');
    inputs.extent = 'length';
    if (length) inputs.length = expressionOf(length);
    if (offset && Math.abs(offset.value) > 1e-12) inputs.offset = expressionOf(offset);
  }
  if (Math.abs(spec.angle - 60) > 1e-6)
    report.notes.push(
      `${f.name}: ${spec.designation} has a ${spec.angle}° profile; imported with Extrudo's 60° one.`,
    );
  d.thread(inputs as Parameters<Design['thread']>[0], { name: f.name });
  return undefined;
}

/** A sketch point (cm) in model space through the sketch's frame. */
function modelPoint(m: Matrix, p: Vec3): Vec3 {
  const r = (i: number) =>
    (m[4 * i] as number) * p[0] +
    (m[4 * i + 1] as number) * p[1] +
    (m[4 * i + 2] as number) * p[2] +
    (m[4 * i + 3] as number);
  return [r(0), r(1), r(2)];
}

/**
 * A path pattern of features or bodies along a chain of sketch curves.
 * Extrudo walks the chain from its first curve's own start, or from its far
 * end with `flip`; the file starts at a point it stores. So the curve at
 * that point goes first: a line (whose direction Extrudo keeps), walked from
 * the start point. Extrudo, like the file, takes the original to sit at the
 * start and moves each copy by the way the path went from there.
 */
export function pathPattern(
  d: Design,
  f: F3dPathPattern,
  context: CopyContext,
): string | MadeCopies {
  const copied = copiedInputs(f, context);
  if (typeof copied === 'string') return copied;
  if (f.path.length === 0) return 'its path was not found (only sketch curves are imported)';
  if (!f.start) return 'its start point was not found';
  if (f.flag !== 0) return 'it has a setting not read yet';
  const distance = f.parameters.find((p) => p.kind === 'PathPatternDelta');
  if (!f.count || !distance) return 'its count or distance was not found';
  const S = f.start;
  const close = (a: Vec3) => Math.hypot(a[0] - S[0], a[1] - S[1], a[2] - S[2]) < 1e-5;
  let first: { ref: GeomRef; flip: boolean } | undefined;
  const rest: GeomRef[] = [];
  for (const curve of f.path) {
    const entry = context.sketches.get(curve.sketch);
    if (!entry) return "its path's sketch was not imported";
    const tag = String(curve.tag);
    const ids = [...entry.tags].filter(([, t]) => String(t) === tag).map(([id]) => id);
    if (ids.length === 0) return 'a curve of its path was not found in its sketch';
    const line = entry.source.lines.find((l) => String(l.tag) === tag);
    const m = entry.source.frame;
    const at =
      line && ids.length === 1 ? [line.start, line.end].map((p) => close(modelPoint(m, p))) : [];
    const refs = ids.map(
      (id): GeomRef => ({ kind: 'sketchEntity', id: `${entry.handle.id}/${id}` }),
    );
    if (!first && (at[0] || at[1])) first = { ref: refs[0] as GeomRef, flip: !at[0] };
    else rest.push(...refs);
  }
  if (!first) return 'its path does not start with a sketch line at its start point';
  const inputs: Record<string, unknown> = {
    ...copied,
    path: [first.ref, ...rest],
    count: context.expressionOf(f.count),
    distance: context.expressionOf(distance),
    measure: f.extent ? 'extent' : 'spacing',
  };
  if (f.aligned) inputs.aligned = true;
  if (first.flip) inputs.flip = true;
  const made = d.pathPattern(inputs as Parameters<Design['pathPattern']>[0], { name: f.name });
  // The one instance seen has code 1.
  return { op: 'pattern', id: made.id, label: (code) => (code >= 1 ? String(code) : undefined) };
}

/**
 * A torus primitive, on the origin plane its axis is square to: its centre's
 * place in that plane's frame and its height off it (mm). An axis along no
 * origin axis is left out (none seen).
 */
export function torus(
  d: Design,
  f: F3dTorus,
  expressionOf: (p: ParameterValue) => string,
  participants: (records: number[], operation?: string, name?: string) => GeomRef[] | undefined,
): string | { id: string } {
  const major = f.parameters.find((p) => p.kind === 'MajorDiameter');
  const minor = f.parameters.find((p) => p.kind === 'MinorDiameter');
  if (!major || !minor) return 'its diameters were not found';
  if (!(minor.value > 0 && minor.value < major.value))
    return 'its tube is not thinner than its ring (Extrudo makes only a ring torus)';
  const dot = (a: readonly number[], b: readonly number[]) =>
    (a[0] as number) * (b[0] as number) +
    (a[1] as number) * (b[1] as number) +
    (a[2] as number) * (b[2] as number);
  const p = ORIGIN_PLANES.find((o) => Math.abs(Math.abs(dot(f.axis, o.frame.normal)) - 1) < 1e-9);
  if (!p) return 'its axis is not along an origin axis';
  const mm = (v: number) => `${Number((10 * v).toPrecision(12))} mm`;
  const inputs: Record<string, unknown> = {
    plane: [{ kind: 'plane', id: p.id }],
    x: mm(dot(f.centre, p.frame.x)),
    y: mm(dot(f.centre, p.frame.y)),
    offset: mm(dot(f.centre, p.frame.normal)),
    diameter: expressionOf(major),
    tube: expressionOf(minor),
    operation: f.operation,
  };
  const bodies =
    f.operation === 'new-body' ? undefined : participants(f.participants, f.operation, f.name);
  if (bodies) inputs.bodies = bodies;
  return { id: d.torus(inputs as Parameters<Design['torus']>[0], { name: f.name }).id };
}
