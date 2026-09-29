/**
 * What the Measure panel and the status bar say (P2-13): an inspection as
 * rows of label and value, in the document's unit and precision.
 */
import { ANGLE, type Dim, formatQuantity, LENGTH, type Settings } from '@extrudo/core';
import type { Box, Inspection, ItemMeasure, Vec3 } from '@extrudo/kernel';

const AREA: Dim = { length: 2, angle: 0 };
const VOLUME: Dim = { length: 3, angle: 0 };

export interface MeasureRow {
  label: string;
  value: string;
}

export interface MeasureSection {
  /** "Face 3 · Body1", or "Between" for a pair, "Selection" for the box. */
  title: string;
  rows: MeasureRow[];
}

type Format = Pick<Settings, 'units' | 'precision'>;

const length = (mm: number, s: Format) => formatQuantity(mm, LENGTH, s);

/** Three numbers in the document unit, the unit once: "40.00, 80.00, 60.00 mm". */
function triple(v: Vec3, s: Format, join = ', '): string {
  const [a, b, c] = v.map((x) => formatQuantity(x, LENGTH, s).split(' ')[0]);
  return `${a}${join}${b}${join}${c} ${s.units}`;
}

/** The box's size: "40.00 × 80.00 × 60.00 mm". */
export function sizeText(box: Box, s: Format): string {
  return triple(
    [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]],
    s,
    ' × ',
  );
}

const SURFACES: Record<string, string> = {
  plane: 'Flat',
  cylinder: 'Cylinder',
  cone: 'Cone',
  sphere: 'Sphere',
  torus: 'Torus',
  bezier: 'Freeform',
  bspline: 'Freeform',
  revolution: 'Revolved',
  extrusion: 'Swept',
  offset: 'Offset',
  other: 'Other',
};

const CURVES: Record<string, string> = {
  line: 'Line',
  circle: 'Circle',
  ellipse: 'Ellipse',
  other: 'Curve',
  degenerate: 'Point',
};

/** One item's rows. */
export function itemRows(item: ItemMeasure, s: Format): MeasureRow[] {
  const rows: MeasureRow[] = [];
  const add = (label: string, value: string) => rows.push({ label, value });
  switch (item.kind) {
    case 'body':
      add('Volume', formatQuantity(item.volume, VOLUME, s));
      add('Area', formatQuantity(item.area, AREA, s));
      add('Centre', triple(item.centroid, s));
      break;
    case 'face':
      add('Type', SURFACES[item.surface] ?? 'Other');
      add('Area', formatQuantity(item.area, AREA, s));
      if (item.radius !== undefined) {
        add(item.surface === 'torus' ? 'Major radius' : 'Radius', length(item.radius, s));
        if (item.surface === 'cylinder' || item.surface === 'sphere') {
          add('Diameter', length(2 * item.radius, s));
        }
      }
      if (item.minorRadius !== undefined) add('Minor radius', length(item.minorRadius, s));
      if (item.halfAngle !== undefined) add('Half angle', formatQuantity(item.halfAngle, ANGLE, s));
      if (item.normal) add('Normal', item.normal.map((v) => fixed(v, s)).join(', '));
      if (item.center) add('Centre', triple(item.center, s));
      break;
    case 'edge': {
      const arc = item.curve === 'circle' && !item.closed;
      add('Type', arc ? 'Arc' : (CURVES[item.curve] ?? 'Curve'));
      add('Length', length(item.length, s));
      if (item.radius !== undefined) {
        add(item.minorRadius !== undefined ? 'Major radius' : 'Radius', length(item.radius, s));
        if (item.minorRadius === undefined) add('Diameter', length(2 * item.radius, s));
      }
      if (item.minorRadius !== undefined) add('Minor radius', length(item.minorRadius, s));
      if (arc && item.sweep !== undefined) add('Sweep', formatQuantity(item.sweep, ANGLE, s));
      if (item.center) add('Centre', triple(item.center, s));
      break;
    }
    case 'vertex':
      add('Position', triple(item.point, s));
      break;
  }
  return rows;
}

/** A pair's rows: distance with its X, Y, Z parts, angle, centre distance. */
export function pairRows(inspection: Inspection, s: Format): MeasureRow[] {
  const pair = inspection.pair;
  if (!pair) return [];
  const rows: MeasureRow[] = [{ label: 'Distance', value: length(pair.distance, s) }];
  if (pair.distance > 0) {
    const d = pair.to.map((v, k) => Math.abs(v - (pair.from[k] as number))) as unknown as Vec3;
    rows.push({ label: 'ΔX, ΔY, ΔZ', value: triple(d, s) });
  }
  if (pair.angle !== undefined) {
    rows.push({ label: 'Angle', value: formatQuantity(pair.angle, ANGLE, s) });
  }
  if (pair.centers) {
    rows.push({ label: 'Centre distance', value: length(pair.centers.distance, s) });
  }
  return rows;
}

/**
 * Totals for more than two items: the summed volume, area and length of
 * the bodies, faces and edges among them (only those of which there are
 * any).
 */
export function totalRows(items: readonly ItemMeasure[], s: Format): MeasureRow[] {
  let volume = 0;
  let area = 0;
  let edges = 0;
  const counts = { body: 0, face: 0, edge: 0 };
  for (const item of items) {
    if (item.kind === 'body') {
      volume += item.volume;
      counts.body++;
    } else if (item.kind === 'face') {
      area += item.area;
      counts.face++;
    } else if (item.kind === 'edge') {
      edges += item.length;
      counts.edge++;
    }
  }
  const rows: MeasureRow[] = [];
  if (counts.body) rows.push({ label: 'Volume', value: formatQuantity(volume, VOLUME, s) });
  if (counts.face) rows.push({ label: 'Face area', value: formatQuantity(area, AREA, s) });
  if (counts.edge) rows.push({ label: 'Edge length', value: length(edges, s) });
  return rows;
}

function fixed(v: number, s: Format): string {
  const text = v.toFixed(Math.max(2, s.precision));
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/**
 * The panel's sections for an inspection: each item (up to two, labelled
 * by `labelOf`), what lies between two, totals for more, and the box
 * around them all.
 */
export function measureSections(
  inspection: Inspection,
  labelOf: (index: number) => string,
  s: Format,
): MeasureSection[] {
  const out: MeasureSection[] = [];
  const { items } = inspection;
  if (items.length === 2 && inspection.pair) {
    out.push({ title: 'Between', rows: pairRows(inspection, s) });
  }
  if (items.length <= 2) {
    items.forEach((item, i) => {
      out.push({ title: labelOf(i), rows: itemRows(item, s) });
    });
  } else {
    out.push({ title: `${items.length} items`, rows: totalRows(items, s) });
  }
  if (inspection.bbox) {
    const b = inspection.bbox;
    out.push({
      title: 'Bounding box',
      rows: [
        { label: 'Size', value: sizeText(b, s) },
        { label: 'Min', value: triple(b.min, s) },
        { label: 'Max', value: triple(b.max, s) },
      ],
    });
  }
  return out;
}
