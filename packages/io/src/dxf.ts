/**
 * DXF writer (P1-13, FR-SK-16): AutoCAD R12 (AC1009) ASCII, the version
 * every CAD, CAM, laser and CNC program reads. Units are millimetres
 * (`$INSUNITS` 4; R12 readers that don't know the variable skip it).
 *
 * Stroke layers write each segment as its own entity: LINE, ARC, CIRCLE,
 * and POLYLINE for what R12 can't express (ellipses and Béziers, flattened
 * to `tolerance`). Fill layers write each contour as one closed POLYLINE
 * with bulges, so circular arcs stay exact and a region is one entity a
 * CAM program can pick. Layers carry their colour, and dashed layers the
 * DASHED linetype.
 */
import { type Contour, type Drawing, drawingBounds, flattenSegment, type Point } from './drawing';
import { num } from './format';

export interface DxfOptions {
  /** Largest distance (mm) between a flattened curve and its polyline. */
  tolerance?: number;
}

const FULL_TURN = 2 * Math.PI;

export function writeDxf(drawing: Drawing, options: DxfOptions = {}): string {
  const tolerance = options.tolerance ?? 0.002;
  const out = new DxfText();
  const box = drawingBounds(drawing) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  out.pair(0, 'SECTION').pair(2, 'HEADER');
  out.pair(9, '$ACADVER').pair(1, 'AC1009');
  out.pair(9, '$INSBASE').point(10, [0, 0]);
  out.pair(9, '$EXTMIN').point(10, [box.minX, box.minY]);
  out.pair(9, '$EXTMAX').point(10, [box.maxX, box.maxY]);
  out.pair(9, '$INSUNITS').pair(70, 4);
  out.pair(0, 'ENDSEC');

  out.pair(0, 'SECTION').pair(2, 'TABLES');
  out.pair(0, 'TABLE').pair(2, 'LTYPE').pair(70, 2);
  out.pair(0, 'LTYPE').pair(2, 'CONTINUOUS').pair(70, 0).pair(3, 'Solid line');
  out.pair(72, 65).pair(73, 0).pair(40, 0);
  out.pair(0, 'LTYPE').pair(2, 'DASHED').pair(70, 0).pair(3, '__ __ __ __');
  out.pair(72, 65).pair(73, 2).pair(40, 3).pair(49, 2).pair(49, -1);
  out.pair(0, 'ENDTAB');
  out
    .pair(0, 'TABLE')
    .pair(2, 'LAYER')
    .pair(70, drawing.layers.length + 1);
  out.pair(0, 'LAYER').pair(2, '0').pair(70, 0).pair(62, 7).pair(6, 'CONTINUOUS');
  for (const layer of drawing.layers) {
    out.pair(0, 'LAYER').pair(2, layerName(layer.name)).pair(70, 0).pair(62, layer.aci);
    out.pair(6, layer.dashed ? 'DASHED' : 'CONTINUOUS');
  }
  out.pair(0, 'ENDTAB');
  out.pair(0, 'ENDSEC');

  out.pair(0, 'SECTION').pair(2, 'ENTITIES');
  for (const layer of drawing.layers) {
    const name = layerName(layer.name);
    for (const shape of drawing.shapes) {
      if (shape.layer !== layer.name) continue;
      for (const contour of shape.contours) {
        if (layer.fill && contour.closed) closedPolyline(out, name, contour, tolerance);
        else strokeEntities(out, name, contour, tolerance);
      }
    }
  }
  out.pair(0, 'ENDSEC');
  out.pair(0, 'EOF');
  return out.text();
}

/** R12 layer names: letters, digits, `$`, `-` and `_`, upper case. */
function layerName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9$_-]+/g, '_') || '0';
}

class DxfText {
  #lines: string[] = [];
  /** Codes 60 to 99 are integers; other numbers are reals, to six decimals. */
  pair(code: number, value: string | number): this {
    const text =
      typeof value === 'string'
        ? value
        : code >= 60 && code < 100
          ? String(Math.round(value))
          : num(value, 6);
    this.#lines.push(String(code).padStart(3, ' '), text);
    return this;
  }
  point(code: number, [x, y]: Point): this {
    return this.pair(code, x)
      .pair(code + 10, y)
      .pair(code + 20, 0);
  }
  text(): string {
    return `${this.#lines.join('\n')}\n`;
  }
}

const degrees = (radians: number) => {
  const d = ((radians * 180) / Math.PI) % 360;
  return d < 0 ? d + 360 : d;
};

function strokeEntities(out: DxfText, layer: string, contour: Contour, tolerance: number): void {
  let at = contour.start;
  // Flattened curves in a row become one polyline.
  let run: Point[] | undefined;
  const flush = () => {
    if (run && run.length > 1) openPolyline(out, layer, run);
    run = undefined;
  };
  for (const segment of contour.segments) {
    switch (segment.type) {
      case 'line':
        flush();
        out.pair(0, 'LINE').pair(8, layer).point(10, at).point(11, segment.to);
        break;
      case 'arc': {
        flush();
        const { center, sweep } = segment;
        const r = Math.hypot(at[0] - center[0], at[1] - center[1]);
        if (Math.abs(Math.abs(sweep) - FULL_TURN) < 1e-9) {
          out.pair(0, 'CIRCLE').pair(8, layer).point(10, center).pair(40, r);
          break;
        }
        // ARC runs counter-clockwise from its start angle to its end angle.
        const from = Math.atan2(at[1] - center[1], at[0] - center[0]);
        const to = Math.atan2(segment.to[1] - center[1], segment.to[0] - center[0]);
        const [start, end] = sweep > 0 ? [from, to] : [to, from];
        out.pair(0, 'ARC').pair(8, layer).point(10, center).pair(40, r);
        out.pair(50, degrees(start)).pair(51, degrees(end));
        break;
      }
      default:
        run ??= [at];
        run.push(...flattenSegment(at, segment, tolerance));
    }
    at = segment.to;
  }
  flush();
}

function openPolyline(out: DxfText, layer: string, points: readonly Point[]): void {
  const closed = points.length > 2 && same(points[0] as Point, points[points.length - 1] as Point);
  out
    .pair(0, 'POLYLINE')
    .pair(8, layer)
    .pair(66, 1)
    .point(10, [0, 0])
    .pair(70, closed ? 1 : 0);
  for (const p of closed ? points.slice(0, -1) : points) {
    out.pair(0, 'VERTEX').pair(8, layer).point(10, p);
  }
  out.pair(0, 'SEQEND').pair(8, layer);
}

/**
 * A closed contour as a POLYLINE: each vertex carries the bulge of the
 * segment that starts there (tan of a quarter of the arc's sweep; arcs over
 * a half turn are split), and the closing segment is implied.
 */
function closedPolyline(out: DxfText, layer: string, contour: Contour, tolerance: number): void {
  const vertices: [Point, number][] = [];
  let at = contour.start;
  for (const segment of contour.segments) {
    if (segment.type === 'line') {
      vertices.push([at, 0]);
    } else if (segment.type === 'arc') {
      const { center, sweep } = segment;
      const r = Math.hypot(at[0] - center[0], at[1] - center[1]);
      const a0 = Math.atan2(at[1] - center[1], at[0] - center[0]);
      const n = Math.max(1, Math.ceil(Math.abs(sweep) / Math.PI - 1e-9));
      for (let i = 0; i < n; i++) {
        const a = a0 + (sweep * i) / n;
        const p: Point = i === 0 ? at : [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)];
        vertices.push([p, Math.tan(sweep / n / 4)]);
      }
    } else {
      vertices.push([at, 0]);
      for (const p of flattenSegment(at, segment, tolerance).slice(0, -1)) vertices.push([p, 0]);
    }
    at = segment.to;
  }
  out.pair(0, 'POLYLINE').pair(8, layer).pair(66, 1).point(10, [0, 0]).pair(70, 1);
  for (const [p, bulge] of vertices) {
    out.pair(0, 'VERTEX').pair(8, layer).point(10, p);
    if (bulge !== 0) out.pair(42, bulge);
  }
  out.pair(0, 'SEQEND').pair(8, layer);
}

function same(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}
