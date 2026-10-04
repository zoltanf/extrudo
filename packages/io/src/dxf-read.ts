/**
 * DXF reader (P4-06, FR-SK-14, ADR-0066 §1): an ASCII DXF file as an
 * `@extrudo/io` drawing in millimetres with y up. Binary DXF is refused with a
 * message saying to save it as ASCII.
 *
 * `$INSUNITS` gives the unit (0 unitless, 1 in, 2 ft, 4 mm, 5 cm, 6 m;
 * anything else read as millimetres). Entities read: `LINE`, `ARC`, `CIRCLE`,
 * `LWPOLYLINE`, `POLYLINE`/`VERTEX` (bulges as arcs, the closed flag),
 * `ELLIPSE` (whole or partial), `SPLINE` (its Bézier pieces, or 16 samples per
 * knot span when it isn't polynomial) and `POINT`. `INSERT` expands a block
 * with its position, scale, rotation and row and column counts, up to eight
 * levels deep. An entity extruded in −z is mirrored in x, as a mirrored arc
 * has to be; any other extrusion is skipped and counted.
 *
 * Everything else — `TEXT`, `MTEXT`, `DIMENSION`, `HATCH`, `SOLID`, `3DFACE`,
 * the rest — is counted in `skipped`.
 */

import { type Spline, sampleSpline, splinePieces } from './bspline';
import {
  type Contour,
  type Drawing,
  type DrawingImport,
  type DrawingUnit,
  type Layer,
  type Point,
  type Segment,
  UNIT_MM,
} from './drawing';
import { IDENTITY, type Matrix, multiply, transformContour } from './transform';

/** Thrown when a file isn't a DXF this reader can read. */
export class DxfError extends Error {
  override readonly name = 'DxfError';
}

const TAU = 2 * Math.PI;
/** How deep `INSERT`s may nest before we stop expanding them. */
export const MAX_INSERT_DEPTH = 8;

export interface DxfReadOptions {
  /** The layer's name. Layers of a DXF carry no geometry of their own here. */
  layer?: string;
}

/** A group code and its value, as one line pair of the file. */
export interface DxfCode {
  code: number;
  value: string;
}

/** One entity: its own pairs, and the `VERTEX` entities of an old polyline. */
export interface DxfEntity {
  type: string;
  codes: DxfCode[];
  vertices: DxfEntity[];
}

/** Reads an ASCII DXF file. Coordinates come out in mm for its `$INSUNITS`. */
export function readDxf(text: string, options: DxfReadOptions = {}): DrawingImport {
  if (text.includes('AutoCAD Binary DXF')) {
    throw new DxfError("Binary DXF isn't supported: save it as ASCII DXF.");
  }
  const pairs = readPairs(text);
  const units = unitsOf(pairs);
  const { entities, blocks } = scan(pairs);
  const skipped: Record<string, number> = {};
  const contours: Contour[] = [];
  // The unit is the one scale every entity goes through, so a drawing in
  // inches arrives as millimetres.
  const unit: Matrix = [UNIT_MM[units], 0, 0, UNIT_MM[units], 0, 0];
  for (const entity of entities) {
    readEntity(entity, blocks, unit, 0, contours, skipped);
  }
  const layerName = options.layer ?? 'Imported';
  const layer: Layer = { name: layerName, color: '#000000', aci: 7 };
  const drawing: Drawing = {
    layers: [layer],
    shapes: contours.map((contour) => ({ layer: layerName, contours: [contour] })),
  };
  return { drawing, units, skipped };
}

/** An ASCII DXF as its group-code pairs, two lines each. */
export function readPairs(text: string): DxfCode[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: DxfCode[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt((lines[i] as string).trim(), 10);
    if (!Number.isFinite(code)) continue;
    out.push({ code, value: (lines[i + 1] ?? '').trim() });
  }
  return out;
}

interface DxfFile {
  entities: DxfEntity[];
  blocks: Map<string, DxfEntity[]>;
}

/**
 * The file's entities and blocks: the `ENTITIES` section, and every `BLOCK` in
 * `BLOCKS` with the entities inside it. An old `POLYLINE` keeps its `VERTEX`
 * entities, which belong to it rather than to the section.
 */
function scan(pairs: readonly DxfCode[]): DxfFile {
  const entities: DxfEntity[] = [];
  const blocks = new Map<string, DxfEntity[]>();
  let section = '';
  let block: { name: string; entities: DxfEntity[] } | undefined;
  let current: DxfEntity | undefined;
  let pending: DxfCode[] = [];

  const emit = (entity: DxfEntity) => {
    if (section === 'BLOCKS') {
      if (entity.type === 'BLOCK') {
        block = { name: entity.codes.find((c) => c.code === 2)?.value ?? '', entities: [] };
        return;
      }
      if (entity.type === 'ENDBLK') {
        if (block?.name) blocks.set(block.name, block.entities);
        block = undefined;
        return;
      }
      block?.entities.push(entity);
      return;
    }
    if (section === 'ENTITIES') entities.push(entity);
  };

  for (let at = 0; at < pairs.length; at++) {
    const pair = pairs[at] as DxfCode;
    if (pair.code === 0) {
      const type = pair.value;
      if (type === 'VERTEX' || type === 'SEQEND') {
        if (type === 'VERTEX' && current?.type === 'POLYLINE') {
          // The vertex's own codes follow its name, so they are a fresh array.
          const vertex: DxfEntity = { type, codes: [], vertices: [] };
          current.vertices.push(vertex);
          pending = vertex.codes;
        } else {
          pending = [];
        }
        continue;
      }
      if (type === 'SECTION' || type === 'ENDSEC') {
        // The section's own records (`2 HEADER`, `2 ENTITIES`…) are not entities.
        if (current) emit(current);
        section = type === 'SECTION' ? (pairs[at + 1]?.value ?? '') : '';
        current = undefined;
        pending = [];
        continue;
      }
      if (current) emit(current);
      // The type comes first and its codes follow, so `pending` is the entity's.
      current = { type, codes: [], vertices: [] };
      pending = current.codes;
      continue;
    }
    pending.push(pair);
  }
  if (current) emit(current);
  return { entities, blocks };
}

/** The unit `$INSUNITS` names (0 none, 1 in, 2 ft, 4 mm, 5 cm, 6 m). */
export function unitsOf(pairs: readonly DxfCode[]): DrawingUnit {
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i]?.code !== 9 || pairs[i]?.value !== '$INSUNITS') continue;
    const value = Number.parseInt(pairs[i + 1]?.value ?? '', 10);
    if (value === 1) return 'in';
    if (value === 2) return 'ft';
    if (value === 4) return 'mm';
    if (value === 5) return 'cm';
    if (value === 6) return 'm';
    return 'unitless';
  }
  return 'unitless';
}

/** The values of one group code, in order. */
const codesOf = (entity: readonly DxfCode[], code: number): string[] =>
  entity.filter((c) => c.code === code).map((c) => c.value);

/** The first value of a group code as a number, or `fallback`. */
const numOf = (entity: readonly DxfCode[], code: number, fallback = 0): number => {
  const value = Number.parseFloat(codesOf(entity, code)[0] ?? '');
  return Number.isFinite(value) ? value : fallback;
};

/** An entity's extrusion direction; (0, 0, 0) means the drawing plane. */
function extrusion(entity: readonly DxfCode[]): [number, number, number] {
  return [numOf(entity, 210), numOf(entity, 220), numOf(entity, 230)];
}

/**
 * The transform an entity's extrusion direction asks for: none in the drawing
 * plane, a mirror in x for −z (a mirrored arc has to be mirrored back), and
 * `undefined` for anything else, whose coordinates we can't place.
 */
export function extrusionMatrix(entity: readonly DxfCode[]): Matrix | undefined {
  const [x, y, z] = extrusion(entity);
  if (x === 0 && y === 0 && (z === 0 || z === 1)) return IDENTITY;
  if (x === 0 && y === 0 && z === -1) return [-1, 0, 0, 1, 0, 0];
  return undefined;
}

/** One entity read into contours (its own coordinates), or `undefined` to skip it. */
function entityContours(entity: DxfEntity, skipped: Record<string, number>): Contour[] | undefined {
  switch (entity.type) {
    case 'LINE':
      return [
        {
          start: [numOf(entity.codes, 10), numOf(entity.codes, 20)],
          segments: [{ type: 'line', to: [numOf(entity.codes, 11), numOf(entity.codes, 21)] }],
          closed: false,
        },
      ];
    case 'CIRCLE':
      return [
        circleContour(
          [numOf(entity.codes, 10), numOf(entity.codes, 20)],
          Math.abs(numOf(entity.codes, 40)),
        ),
      ];
    case 'ARC':
      return [arcContour(entity.codes)];
    case 'ELLIPSE':
      return [ellipseContour(entity.codes)];
    case 'LWPOLYLINE':
      return [
        vertexContour(
          polylineVertices(entity.codes),
          (numOf(entity.codes, 70) & 1) === 1,
          codesOf(entity.codes, 42).map(Number),
        ),
      ];
    case 'POLYLINE':
      return [
        vertexContour(
          entity.vertices.map((v) => [numOf(v.codes, 10), numOf(v.codes, 20)] as Point),
          (numOf(entity.codes, 70) & 1) === 1,
          entity.vertices.map((v) => Number.parseFloat(codesOf(v.codes, 42)[0] ?? '0')),
        ),
      ];
    case 'SPLINE':
      return [splineContour(entity.codes, skipped)];
    case 'POINT': {
      // A drawing has no points; a zero-length line is how it says so, and the
      // importer drops it.
      const at: Point = [numOf(entity.codes, 10), numOf(entity.codes, 20)];
      return [{ start: at, segments: [{ type: 'line', to: at }], closed: false }];
    }
    default:
      return undefined;
  }
}

function circleContour(center: Point, radius: number): Contour {
  const start: Point = [center[0] + radius, center[1]];
  return {
    start,
    segments: [{ type: 'arc', center, sweep: TAU, to: start }],
    closed: true,
  };
}

/** `ARC`: counter-clockwise from its start angle to its end angle. */
function arcContour(codes: readonly DxfCode[]): Contour {
  const center: Point = [numOf(codes, 10), numOf(codes, 20)];
  const radius = Math.abs(numOf(codes, 40));
  const from = (numOf(codes, 50) * Math.PI) / 180;
  const to = (numOf(codes, 51) * Math.PI) / 180;
  const at = (angle: number): Point => [
    center[0] + radius * Math.cos(angle),
    center[1] + radius * Math.sin(angle),
  ];
  let sweep = to - from;
  // The end angle runs past the start when the arc crosses zero degrees.
  if (sweep <= 1e-12) sweep += TAU;
  return {
    start: at(from),
    segments: [{ type: 'arc', center, sweep, to: at(from + sweep) }],
    closed: false,
  };
}

/** `ELLIPSE`: the major axis vector from the centre, a ratio, and the parameter range. */
function ellipseContour(codes: readonly DxfCode[]): Contour {
  const center: Point = [numOf(codes, 10), numOf(codes, 20)];
  const vector: Point = [numOf(codes, 11), numOf(codes, 21)];
  const length = Math.hypot(vector[0], vector[1]);
  const rotation = Math.atan2(vector[1], vector[0]);
  const from = numOf(codes, 41);
  // A missing end parameter means a whole ellipse.
  const sweep = numOf(codes, 42, 0) === 0 ? TAU : numOf(codes, 42) - from;
  const a = length;
  const b = length * numOf(codes, 40, 1);
  const at = (t: number): Point => {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    return [center[0] + x * cos - y * sin, center[1] + x * sin + y * cos];
  };
  return {
    start: at(from),
    segments: [{ type: 'ellipse', center, rx: a, ry: b, rotation, sweep, to: at(from + sweep) }],
    closed: Math.abs(sweep) >= TAU - 1e-9,
  };
}

/** `LWPOLYLINE`'s vertices: group codes 10 and 20 in step. */
function polylineVertices(codes: readonly DxfCode[]): Point[] {
  const xs = codesOf(codes, 10).map(Number);
  const ys = codesOf(codes, 20).map(Number);
  return xs.map((x, i) => [x, ys[i] ?? 0] as Point);
}

/**
 * A polyline as one contour: `segments` are the vertices (bulge 0 unless the
 * list has them), `closed` the file's flag.
 */
function vertexContour(
  points: readonly Point[],
  closed: boolean,
  bulges: readonly number[] = [],
): Contour {
  const start = points[0] ?? [0, 0];
  const segments: Segment[] = [];
  const last = closed ? points.length : Math.max(0, points.length - 1);
  for (let i = 0; i < last; i++) {
    const from = points[i] as Point;
    const to = points[(i + 1) % points.length] as Point;
    const bulge = bulges[i] ?? 0;
    segments.push(
      Number.isFinite(bulge) && bulge !== 0 ? bulgeArc(from, to, bulge) : { type: 'line', to },
    );
  }
  return { start, segments, closed };
}

/**
 * The arc between two polyline vertices a bulge away (DXF: the bulge is the
 * tangent of a quarter of the included angle, positive counter-clockwise).
 */
export function bulgeArc(from: Point, to: Point, bulge: number): Segment {
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const sweep = 4 * Math.atan(bulge);
  if (chord === 0 || Math.abs(sweep) < 1e-12) return { type: 'line', to };
  const midpoint: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  // The centre lies on the chord's perpendicular, a half-chord / tan(half) away.
  const ux = (to[0] - from[0]) / chord;
  const uy = (to[1] - from[1]) / chord;
  const offset = chord / (2 * Math.tan(sweep / 2));
  const center: Point = [midpoint[0] - uy * offset, midpoint[1] + ux * offset];
  return { type: 'arc', center, sweep, to };
}

/**
 * A `SPLINE` as one contour of cubic Béziers: exactly, by knot insertion, for
 * a non-rational spline of degree ≤ 3 (degree 2 elevated to 3, degree 1 left
 * as lines); otherwise 16 samples per knot span through a Catmull-Rom fit,
 * which is as close as Béziers get to a rational or high-degree curve.
 */
export function splineContour(
  codes: readonly DxfCode[],
  skipped?: Record<string, number>,
): Contour {
  const polesX = codesOf(codes, 10).map(Number);
  const polesY = codesOf(codes, 20).map(Number);
  if (polesX.length < 2) {
    if (skipped) skipped.spline = (skipped.spline ?? 0) + 1;
    return { start: [0, 0], segments: [], closed: false };
  }
  const degree = Math.max(1, Math.round(numOf(codes, 71, 3)));
  const weights = codesOf(codes, 41).map(Number);
  const knots = codesOf(codes, 40).map(Number);
  const spline: Spline = {
    degree: Math.min(degree, polesX.length - 1),
    poles: polesX.map((x, i) => [x, polesY[i] ?? 0] as [number, number]),
    knots: knots.length > 0 ? knots : uniformKnots(polesX.length, degree),
    ...(weights.length === polesX.length && { weights }),
  };
  const pieces = splinePieces(spline) ?? sampleSpline(spline);
  const segments: Segment[] = pieces.map((piece) => ({
    type: 'cubic',
    c1: piece.points[1] as Point,
    c2: piece.points[2] as Point,
    to: piece.points[3] as Point,
  }));
  return {
    start: pieces[0]?.points[0] ?? [polesX[0] as number, polesY[0] ?? 0],
    segments,
    closed: false,
  };
}

/** The clamped uniform knots of a spline whose file leaves them out. */
export function uniformKnots(poles: number, degree: number): number[] {
  const spans = Math.max(1, poles - degree);
  return [
    ...new Array(degree + 1).fill(0),
    ...Array.from({ length: spans - 1 }, (_, j) => (j + 1) / spans),
    ...new Array(degree + 1).fill(1),
  ];
}

/** Reads one entity and the blocks it inserts, into the target contours. */
function readEntity(
  entity: DxfEntity,
  blocks: Map<string, DxfEntity[]>,
  matrix: Matrix,
  depth: number,
  target: Contour[],
  skipped: Record<string, number>,
): void {
  if (entity.type === 'INSERT') {
    readInsert(entity, blocks, matrix, depth, target, skipped);
    return;
  }
  const mirror = extrusionMatrix(entity.codes);
  if (!mirror) {
    skipped[entity.type.toLowerCase()] = (skipped[entity.type.toLowerCase()] ?? 0) + 1;
    return;
  }
  const shapes = entityContours(entity, skipped);
  if (!shapes) {
    skipped[entity.type.toLowerCase()] = (skipped[entity.type.toLowerCase()] ?? 0) + 1;
    return;
  }
  const here = multiply(matrix, mirror);
  for (const contour of shapes) target.push(transformContour(here, contour));
}

/**
 * `INSERT`: the block's entities at every copy, with the insert's position,
 * scale and rotation (and its row and column counts and spacing).
 */
function readInsert(
  entity: DxfEntity,
  blocks: Map<string, DxfEntity[]>,
  matrix: Matrix,
  depth: number,
  target: Contour[],
  skipped: Record<string, number>,
): void {
  if (depth >= MAX_INSERT_DEPTH) {
    skipped.insert = (skipped.insert ?? 0) + 1;
    return;
  }
  const name = codesOf(entity.codes, 2)[0];
  const block = name ? blocks.get(name) : undefined;
  if (!block) {
    if (name) skipped.insert = (skipped.insert ?? 0) + 1;
    return;
  }
  const sx = numOf(entity.codes, 41, 1) || 1;
  const sy = numOf(entity.codes, 42, 1) || 1;
  const angle = (numOf(entity.codes, 50) * Math.PI) / 180;
  const flags = numOf(entity.codes, 70);
  const columns = Math.max(1, flags & 0x1f);
  const rows = Math.max(1, Math.floor(flags / 31));
  const columnSpacing = numOf(entity.codes, 44);
  const rowSpacing = numOf(entity.codes, 45);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at: Point = [numOf(entity.codes, 10), numOf(entity.codes, 20)];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      // The counts and spacing are in the insert's own axes, like its scale
      // and turn, so a turned array spreads along the turned axes.
      const across = column * columnSpacing;
      const up = row * rowSpacing;
      const place: Matrix = [
        sx * cos,
        sx * sin,
        -sy * sin,
        sy * cos,
        at[0] + across * cos - up * sin,
        at[1] + across * sin + up * cos,
      ];
      const here = multiply(matrix, place);
      for (const inner of block) readEntity(inner, blocks, here, depth + 1, target, skipped);
    }
  }
}
