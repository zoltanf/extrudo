/**
 * Mapping of the features added after the first import (ADR-0083's
 * amendment of 2026-10-11): mirror and rectangular pattern. Each returns why
 * it was left out, or nothing when it became an Extrudo feature.
 */
import type { Design, GeomRef } from '@extrudo/api';
import type { CopiedObjects } from './decode/copies';
import type { ModelPlane } from './decode/hole';
import type { ParameterValue } from './decode/parameters';
import type { RevolveAxis } from './decode/revolve';
import type { Vec3 } from './decode/sketch-geometry';
import { axisRef, type ImportReport, placeSketch, type SketchEntry } from './map';
import type { F3dMirror, F3dRectangularPattern } from './model';

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
): GeomRef | undefined {
  const { origin: O, x: X, y: Y } = plane;
  const N: Vec3 = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  const m = [X[0], Y[0], N[0], O[0], X[1], Y[1], N[1], O[1], X[2], Y[2], N[2], O[2], 0, 0, 0, 1];
  const notes: ImportReport = { imported: [], skipped: [], notes: [] };
  const placed = placeSketch(d, m, notes, name);
  for (const note of notes.notes) report.notes.push(note.replace(': drawn on ', ': mirrors in '));
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

/** A mirror of features or bodies in a plane. */
export function mirror(d: Design, f: F3dMirror, context: CopyContext): string | undefined {
  if (!f.plane) return 'its plane was not found';
  const copied = copiedInputs(f, context);
  if (typeof copied === 'string') return copied;
  const plane = planeRef(d, f.plane, f.name, context.report);
  if (!plane) return 'its plane is not along an origin axis';
  d.mirror({ ...copied, plane } as Parameters<Design['mirror']>[0], { name: f.name });
  return undefined;
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
): string | undefined {
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
  d.rectangularPattern(inputs as Parameters<Design['rectangularPattern']>[0], { name: f.name });
  return undefined;
}
