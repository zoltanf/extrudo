/**
 * SVG writer (P1-13, FR-SK-15): one user unit is one millimetre, and the
 * root's `width`/`height` say so in `mm`, so Inkscape, browsers, slicers and
 * laser software open the file at its real size. The viewBox is the
 * drawing's bounding box; y is flipped (SVG runs down, CAD up) by writing
 * negated coordinates rather than a transform, so the path data is the
 * geometry itself.
 *
 * Each layer is a group (an Inkscape layer too). Stroke layers draw
 * hairlines; fill layers fill their shapes even-odd, so a region's inner
 * contours are holes. Curves stay exact: circular and elliptical arcs as `A`
 * (split into half turns or less), Béziers as `Q`/`C`.
 */
import { type Drawing, drawingBounds, ellipseAt, ellipseParam, type Point } from './drawing';
import { num, xmlText } from './format';

export interface SvgOptions {
  /** Stroke width of stroke layers, mm. */
  strokeWidth?: number;
}

export function writeSvg(drawing: Drawing, options: SvgOptions = {}): string {
  const stroke = options.strokeWidth ?? 0.1;
  const box = drawingBounds(drawing) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  // A drawing with no extent across (one straight line) still gets a visible page.
  let { minX, minY, maxX, maxY } = box;
  if (maxX - minX < stroke) [minX, maxX] = [(minX + maxX - stroke) / 2, (minX + maxX + stroke) / 2];
  if (maxY - minY < stroke) [minY, maxY] = [(minY + maxY - stroke) / 2, (minY + maxY + stroke) / 2];
  const width = maxX - minX;
  const height = maxY - minY;

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${num(width)}mm" height="${num(height)}mm" viewBox="${num(minX)} ${num(-maxY)} ${num(width)} ${num(height)}">`,
  ];
  if (drawing.title) lines.push(`<title>${xmlText(drawing.title)}</title>`);
  for (const layer of drawing.layers) {
    const shapes = drawing.shapes.filter((s) => s.layer === layer.name);
    if (shapes.length === 0) continue;
    const style = layer.fill
      ? `fill="${layer.color}" fill-rule="evenodd" stroke="none"`
      : `fill="none" stroke="${layer.color}" stroke-width="${num(stroke)}" stroke-linecap="round" stroke-linejoin="round"${layer.dashed ? ` stroke-dasharray="${num(stroke * 20)} ${num(stroke * 10)}"` : ''}`;
    const label = xmlText(layer.name);
    lines.push(`<g id="${label}" inkscape:groupmode="layer" inkscape:label="${label}" ${style}>`);
    for (const shape of shapes) lines.push(`<path d="${pathData(shape.contours)}"/>`);
    lines.push('</g>');
  }
  lines.push('</svg>', '');
  return lines.join('\n');
}

const pt = (p: Point) => `${num(p[0])} ${num(-p[1])}`;

function pathData(contours: Drawing['shapes'][number]['contours']): string {
  const out: string[] = [];
  for (const contour of contours) {
    out.push(`M${pt(contour.start)}`);
    let at = contour.start;
    for (const segment of contour.segments) {
      switch (segment.type) {
        case 'line':
          out.push(`L${pt(segment.to)}`);
          break;
        case 'arc': {
          const { center, sweep } = segment;
          const r = Math.hypot(at[0] - center[0], at[1] - center[1]);
          const a0 = Math.atan2(at[1] - center[1], at[0] - center[0]);
          // Counter-clockwise with y up is the negative-angle direction once y points down.
          const flag = sweep > 0 ? 0 : 1;
          const n = pieces(sweep);
          for (let i = 1; i <= n; i++) {
            const a = a0 + (sweep * i) / n;
            const to: Point =
              i === n ? segment.to : [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)];
            out.push(`A${num(r)} ${num(r)} 0 0 ${flag} ${pt(to)}`);
          }
          break;
        }
        case 'ellipse': {
          const t0 = ellipseParam(segment, at);
          const flag = segment.sweep > 0 ? 0 : 1;
          const rotation = num((-segment.rotation * 180) / Math.PI);
          const n = pieces(segment.sweep);
          for (let i = 1; i <= n; i++) {
            const to = i === n ? segment.to : ellipseAt(segment, t0 + (segment.sweep * i) / n);
            out.push(`A${num(segment.rx)} ${num(segment.ry)} ${rotation} 0 ${flag} ${pt(to)}`);
          }
          break;
        }
        case 'quadratic':
          out.push(`Q${pt(segment.control)} ${pt(segment.to)}`);
          break;
        case 'cubic':
          out.push(`C${pt(segment.c1)} ${pt(segment.c2)} ${pt(segment.to)}`);
          break;
      }
      at = segment.to;
    }
    if (contour.closed) out.push('Z');
  }
  return out.join('');
}

/** Half turns or less per `A` command, so the large-arc flag is always 0. */
function pieces(sweep: number): number {
  return Math.max(1, Math.ceil(Math.abs(sweep) / Math.PI - 1e-9));
}
