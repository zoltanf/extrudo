/**
 * SVG reader (P4-06, FR-SK-14, ADR-0066 §1): an SVG file as an `@extrudo/io`
 * drawing in millimetres with y up, the format `writeSvg` writes and
 * `@extrudo/sketch/export` builds. No dependency beyond the small XML reader
 * in `./xml` and the affine transforms in `./transform`.
 *
 * What comes in: `path` (every command, arcs as elliptical arcs), `rect` with
 * rounded corners, `circle`, `ellipse`, `line`, `polyline` and `polygon`, at
 * any depth inside `g` and nested `svg`, with `transform` composed down the
 * tree. What doesn't: `text`, `image`, `use`, `defs`, `clipPath`, `mask`,
 * `pattern`, `style` and `foreignObject`, each counted in `skipped`.
 *
 * **Units.** The root's `width` (or `height`) says how big the page is; its
 * `viewBox` says how many user units that is, so the two together give
 * millimetres per user unit. Without a viewBox a user unit is the unit of the
 * width. SVG's y points down, so the whole drawing is mirrored in y on the way
 * out — every segment's turn reverses with it.
 */
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
import { parseXml, type XmlNode } from './xml';

/** Thrown when a file isn't an SVG this reader can read. */
export class SvgError extends Error {
  override readonly name = 'SvgError';
}

const TAU = 2 * Math.PI;
/** The layer the geometry lands on (one per file: SVG layers carry no geometry here). */
const LAYER_COLOR = '#000000';

export interface SvgReadOptions {
  /** The layer's name; the file's id, or "Imported". */
  layer?: string;
}

/**
 * Reads an SVG file. Coordinates come out in millimetres for the unit the file
 * declares, with y up; `units` is that unit, so a panel can offer it.
 */
export function readSvg(text: string, options: SvgReadOptions = {}): DrawingImport {
  let root: XmlNode;
  try {
    root = parseXml(text);
  } catch (error) {
    // A file that isn't XML at all reads the same to a user as a wrong file.
    const reason = error instanceof Error ? error.message : String(error);
    throw new SvgError(`This file isn't an SVG file Extrudo can read: ${reason}`);
  }
  if (root.name !== 'svg')
    throw new SvgError("This isn't an SVG file: it has no <svg> root element.");

  const { scale, unit } = pageScale(root);
  const skipped: Record<string, number> = {};
  const contours: Contour[] = [];
  const walk = (node: XmlNode, matrix: Matrix) => {
    if (hidden(node)) return;
    const here = multiply(matrix, transformOf(node.attributes.transform));
    const name = node.name.replace(/^.*:/, '');
    if (SKIPPED.has(name)) {
      skipped[name] = (skipped[name] ?? 0) + 1;
      return;
    }
    const shapes = shapesOf(node);
    if (shapes) {
      for (const contour of shapes) contours.push(transformContour(here, contour));
      return;
    }
    for (const child of node.children) walk(child, here);
  };
  walk(root, [scale, 0, 0, -scale, 0, 0]);

  const layer: Layer = {
    name: options.layer ?? root.attributes.id ?? 'Imported',
    color: LAYER_COLOR,
    aci: 7,
  };
  const title = root.children.find((c) => c.name === 'title')?.text.trim();
  const drawing: Drawing = {
    layers: [layer],
    shapes: contours.map((contour) => ({ layer: layer.name, contours: [contour] })),
    ...(title && { title }),
  };
  return { drawing, units: unit, skipped };
}

// Elements that carry no geometry we can use, and are counted instead.
const SKIPPED = new Set([
  'text',
  'tspan',
  'textPath',
  'image',
  'use',
  'defs',
  'clipPath',
  'mask',
  'pattern',
  'style',
  'foreignObject',
]);

/** Whether an element is not drawn (`display:none` on it or in its style). */
function hidden(node: XmlNode): boolean {
  if (node.attributes.display === 'none') return true;
  return /(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/.test(node.attributes.style ?? '');
}

/** The contours of a shape element, or `undefined` for a container. */
function shapesOf(node: XmlNode): Contour[] | undefined {
  const a = node.attributes;
  const number = (name: string, fallback: number) => {
    const value = Number.parseFloat(a[name] ?? '');
    return Number.isFinite(value) ? value : fallback;
  };
  switch (node.name) {
    case 'path':
      return a.d ? pathContours(a.d) : [];
    case 'rect': {
      const w = number('width', 0);
      const h = number('height', 0);
      if (w <= 0 || h <= 0) return [];
      const x = number('x', 0);
      const y = number('y', 0);
      return [rectContour(x, y, w, h, number('rx', 0), number('ry', 0))];
    }
    case 'circle': {
      const r = number('r', 0);
      if (r <= 0) return [];
      const center: Point = [number('cx', 0), number('cy', 0)];
      const start: Point = [center[0] + r, center[1]];
      return [{ start, segments: [{ type: 'arc', center, sweep: TAU, to: start }], closed: true }];
    }
    case 'ellipse': {
      const rx = number('rx', 0);
      const ry = number('ry', 0);
      if (rx <= 0 || ry <= 0) return [];
      const center: Point = [number('cx', 0), number('cy', 0)];
      const start: Point = [center[0] + rx, center[1]];
      return [
        {
          start,
          segments: [{ type: 'ellipse', center, rx, ry, rotation: 0, sweep: TAU, to: start }],
          closed: true,
        },
      ];
    }
    case 'line': {
      const from: Point = [number('x1', 0), number('y1', 0)];
      return [
        {
          start: from,
          segments: [{ type: 'line', to: [number('x2', 0), number('y2', 0)] }],
          closed: false,
        },
      ];
    }
    case 'polyline':
    case 'polygon': {
      const points = pointList(a.points ?? '');
      if (points.length === 0) return [];
      const start = points[0] as Point;
      const segments = points.slice(1).map((to) => ({ type: 'line' as const, to }));
      return [{ start, segments, closed: node.name === 'polygon' }];
    }
    default:
      return undefined;
  }
}

/** A rect as one contour, clockwise from its top edge, with rounded corners. */
function rectContour(x: number, y: number, w: number, h: number, rx: number, ry: number): Contour {
  // A missing radius takes the other; both are capped at half the side.
  const crx = Math.min(Math.max(rx || ry, 0), w / 2);
  const cry = Math.min(Math.max(ry || rx, 0), h / 2);
  const start: Point = [x + crx, y];
  if (crx <= 0 || cry <= 0) {
    return {
      start,
      segments: [
        { type: 'line', to: [x + w, y] },
        { type: 'line', to: [x + w, y + h] },
        { type: 'line', to: [x, y + h] },
        { type: 'line', to: [x, y] },
      ],
      closed: true,
    };
  }
  // Each corner is a quarter turn; this contour runs counter-clockwise.
  const corner = (cx: number, cy: number, to: Point): Segment => ({
    type: 'ellipse',
    center: [cx, cy],
    rx: crx,
    ry: cry,
    rotation: 0,
    sweep: Math.PI / 2,
    to,
  });
  return {
    start,
    segments: [
      { type: 'line', to: [x + w - crx, y] },
      corner(x + w - crx, y + cry, [x + w, y + cry]),
      { type: 'line', to: [x + w, y + h - cry] },
      corner(x + w - crx, y + h - cry, [x + w - crx, y + h]),
      { type: 'line', to: [x + crx, y + h] },
      corner(x + crx, y + h - cry, [x, y + h - cry]),
      { type: 'line', to: [x, y + cry] },
      corner(x + crx, y + cry, [x, y]),
    ],
    closed: true,
  };
}

/** A `points` list: numbers in pairs, with commas or spaces between them. */
function pointList(text: string): Point[] {
  const numbers = text.match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g);
  if (!numbers) return [];
  const out: Point[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2)
    out.push([Number(numbers[i]), Number(numbers[i + 1])]);
  return out;
}

// Path data --------------------------------------------------------------------

/** The numbers and flags of a path's `d`, left to right. */
class PathData {
  #text: string;
  #at = 0;

  constructor(text: string) {
    this.#text = text;
  }

  /** The next number, or `undefined` when none is left. */
  next(): number | undefined {
    this.#spaces();
    const rest = this.#text.slice(this.#at);
    const match = /^[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/.exec(rest);
    if (!match) return undefined;
    this.#at += match[0].length;
    return Number.parseFloat(match[0]);
  }

  /** The next arc flag: one character, `0` or `1`. */
  flag(): 0 | 1 | undefined {
    this.#spaces();
    const c = this.#text[this.#at];
    if (c !== '0' && c !== '1') return undefined;
    this.#at += 1;
    return c === '0' ? 0 : 1;
  }

  /** The next command letter, or `undefined` at the end. */
  command(): string | undefined {
    this.#spaces();
    const c = this.#text[this.#at];
    if (c === undefined || !/[A-Za-z]/.test(c)) return undefined;
    this.#at += 1;
    return c;
  }

  /** Whether a number follows (so an implicit command may repeat). */
  hasNumber(): boolean {
    this.#spaces();
    return /[0-9.+-]/.test(this.#text[this.#at] ?? '');
  }

  #spaces(): void {
    while (this.#at < this.#text.length && /[\s,]/.test(this.#text[this.#at] as string)) this.#at++;
  }
}

/** A `d` attribute as contours (SVG user space, y down; the walk mirrors it). */
export function pathContours(d: string): Contour[] {
  const data = new PathData(d);
  const out: Contour[] = [];
  let segments: Segment[] = [];
  let start: Point = [0, 0];
  let at: Point = [0, 0];
  // The last control point of a C or Q, for the S and T shorthands.
  let lastCubic: Point | undefined;
  let lastQuadratic: Point | undefined;
  let closed = false;

  const flush = () => {
    if (segments.length > 0) out.push({ start, segments, closed });
    segments = [];
    closed = false;
  };

  let command = data.command();
  while (command !== undefined) {
    const relative = command === command.toLowerCase();
    const letter = command.toUpperCase();
    const at_ = (x: number, y: number): Point => (relative ? [at[0] + x, at[1] + y] : [x, y]);
    /** The numbers a command takes, `undefined` at the end of the data. */
    const numbers = (count: number) => {
      const out: number[] = [];
      for (let i = 0; i < count; i++) {
        const value = data.next();
        if (value === undefined) return undefined;
        out.push(value);
      }
      return out;
    };
    switch (letter) {
      case 'Z': {
        if (at[0] !== start[0] || at[1] !== start[1]) segments.push({ type: 'line', to: start });
        closed = true;
        at = start;
        lastCubic = undefined;
        lastQuadratic = undefined;
        flush();
        break;
      }
      case 'M': {
        const n = numbers(2);
        if (!n) return out;
        flush();
        start = at_(n[0] as number, n[1] as number);
        at = start;
        lastCubic = undefined;
        lastQuadratic = undefined;
        break;
      }
      case 'L': {
        const n = numbers(2);
        if (!n) return out;
        at = at_(n[0] as number, n[1] as number);
        segments.push({ type: 'line', to: at });
        lastCubic = undefined;
        lastQuadratic = undefined;
        break;
      }
      case 'H': {
        const x = data.next();
        if (x === undefined) return out;
        at = relative ? [at[0] + x, at[1]] : [x, at[1]];
        segments.push({ type: 'line', to: at });
        lastCubic = undefined;
        lastQuadratic = undefined;
        break;
      }
      case 'V': {
        const y = data.next();
        if (y === undefined) return out;
        at = relative ? [at[0], at[1] + y] : [at[0], y];
        segments.push({ type: 'line', to: at });
        lastCubic = undefined;
        lastQuadratic = undefined;
        break;
      }
      case 'C': {
        const n = numbers(6);
        if (!n) return out;
        const c1 = at_(n[0] as number, n[1] as number);
        const c2 = at_(n[2] as number, n[3] as number);
        at = at_(n[4] as number, n[5] as number);
        segments.push({ type: 'cubic', c1, c2, to: at });
        lastCubic = c2;
        lastQuadratic = undefined;
        break;
      }
      case 'S': {
        const n = numbers(4);
        if (!n) return out;
        // The first control point mirrors the last one of the previous C.
        const c1: Point = lastCubic
          ? [2 * at[0] - lastCubic[0], 2 * at[1] - lastCubic[1]]
          : [at[0], at[1]];
        const c2 = at_(n[0] as number, n[1] as number);
        at = at_(n[2] as number, n[3] as number);
        segments.push({ type: 'cubic', c1, c2, to: at });
        lastCubic = c2;
        lastQuadratic = undefined;
        break;
      }
      case 'Q': {
        const n = numbers(4);
        if (!n) return out;
        const q = at_(n[0] as number, n[1] as number);
        at = at_(n[2] as number, n[3] as number);
        segments.push({ type: 'quadratic', control: q, to: at });
        lastQuadratic = q;
        lastCubic = undefined;
        break;
      }
      case 'T': {
        const n = numbers(2);
        if (!n) return out;
        const q: Point = lastQuadratic
          ? [2 * at[0] - lastQuadratic[0], 2 * at[1] - lastQuadratic[1]]
          : [at[0], at[1]];
        at = at_(n[0] as number, n[1] as number);
        segments.push({ type: 'quadratic', control: q, to: at });
        lastQuadratic = q;
        lastCubic = undefined;
        break;
      }
      case 'A': {
        const rx = data.next();
        const ry = data.next();
        const rotation = data.next();
        const large = data.flag();
        const clockwise = data.flag();
        const x = data.next();
        const y = data.next();
        if (
          rx === undefined ||
          ry === undefined ||
          rotation === undefined ||
          large === undefined ||
          clockwise === undefined ||
          x === undefined ||
          y === undefined
        ) {
          return out;
        }
        const to = at_(x, y);
        const segment = arcSegment(at, to, rx, ry, rotation, large === 1, clockwise === 1);
        segments.push(segment);
        at = to;
        lastCubic = undefined;
        lastQuadratic = undefined;
        break;
      }
      default:
        // An unknown command: nothing more can be read.
        return out;
    }
    // A command repeats while numbers follow it; after a move they are lines.
    const repeated = letter === 'M' ? (relative ? 'l' : 'L') : command;
    command = letter !== 'Z' && data.hasNumber() ? repeated : data.command();
  }
  flush();
  return out;
}

/**
 * One `A` command as the segment it draws (SVG 1.1 F.6.5, F.6.6): the
 * endpoint parameterisation becomes the centre one, the radii grow when they
 * are too small for the endpoints to be on the curve, and the turn follows the
 * large-arc and sweep flags. The result is in SVG's coordinates (y down), so
 * `sweep` is positive for the sweep flag: the walk's mirror in y reverses it.
 */
export function arcSegment(
  from: Point,
  to: Point,
  rx: number,
  ry: number,
  rotationDeg: number,
  large: boolean,
  clockwise: boolean,
): Segment {
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) {
    return { type: 'line', to };
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  // F.6.6: radii too small to reach the endpoints are scaled up to fit.
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    const k = Math.sqrt(lambda);
    rx *= k;
    ry *= k;
  }
  const denominator = rx * rx * yp * yp + ry * ry * xp * xp;
  const root =
    denominator === 0 ? 0 : Math.sqrt(Math.max(0, (rx * rx * ry * ry - denominator) / denominator));
  const sign = large === clockwise ? -1 : 1;
  const cxp = sign * root * ((rx * yp) / ry);
  const cyp = -sign * root * ((ry * xp) / rx);
  const center: Point = [
    cos * cxp - sin * cyp + (from[0] + to[0]) / 2,
    sin * cxp + cos * cyp + (from[1] + to[1]) / 2,
  ];
  const angle = (x: number, y: number) => Math.atan2((y - center[1]) / ry, (x - center[0]) / rx);
  // F.6.5: the sweep flag says which way round the parameter turns; the large-arc
  // flag has already chosen the centre.
  let delta = angle(to[0], to[1]) - angle(from[0], from[1]);
  if (clockwise && delta < 0) delta += TAU;
  else if (!clockwise && delta > 0) delta -= TAU;
  // Equal radii: a circular arc, which a transform can keep circular.
  if (Math.abs(rx - ry) <= 1e-12 * Math.max(rx, ry)) {
    return { type: 'arc', center, sweep: delta, to };
  }
  return { type: 'ellipse', center, rx, ry, rotation: phi, sweep: delta, to };
}

// The page ---------------------------------------------------------------------

/** A length in a file: its number, and how many millimetres that number is. */
function lengthOf(text: string | undefined): { value: number; mm: number; unit: DrawingUnit } {
  const match = /^\s*([+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)/.exec(text ?? '');
  const value = Number.parseFloat(match?.[1] ?? '0');
  const name = (match?.[2] ?? '').toLowerCase();
  const factors: Record<string, number> = {
    ...UNIT_MM,
    pt: 25.4 / 72,
    pc: 25.4 / 6,
    // A percentage says nothing about the real size; take it as user units.
    '%': 1,
  };
  // A number with no unit is in pixels (SVG's default); so is one we can't read.
  const mm = factors[name] ?? UNIT_MM.px;
  const size = Number.isFinite(value) ? value : 0;
  return { value: size, mm: size * mm, unit: unitName(name) };
}

const unitName = (name: string): DrawingUnit =>
  name === 'mm' || name === 'cm' || name === 'm' || name === 'in' || name === 'ft' || name === 'px'
    ? name
    : // No suffix at all means pixels; anything else we can't place.
      name === ''
      ? 'px'
      : 'unitless';

/**
 * Millimetres per user unit of an SVG, and the unit the file is in. A
 * `viewBox` is read for its width alone: it says how many user units the
 * page's width is, so a file whose `width` is in millimetres and whose
 * `viewBox` counts the same units gets one millimetre per unit (which is what
 * `writeSvg` writes), while a pixel drawing with a viewBox gets the viewport
 * scale.
 */
function pageScale(root: XmlNode): { scale: number; unit: DrawingUnit } {
  const width = lengthOf(root.attributes.width);
  const height = lengthOf(root.attributes.height);
  const page = width.mm > 0 ? width : height;
  const declared = width.mm > 0 ? width.unit : height.mm > 0 ? height.unit : undefined;
  const viewBox = (root.attributes.viewBox ?? '')
    .split(/[\s,]+/)
    .map(Number)
    .filter((v) => Number.isFinite(v));
  const unitsAcross =
    viewBox.length === 4 && (viewBox[2] as number) > 0 ? (viewBox[2] as number) : 0;
  const scale =
    unitsAcross > 0 && page.mm > 0 ? page.mm / unitsAcross : page.mm > 0 ? page.mm : UNIT_MM.px;
  return { scale, unit: declared ?? 'px' };
}

// Transforms -------------------------------------------------------------------

const FUNCTIONS = /([a-zA-Z]+)\s*\(([^)]*)\)/g;

/** An element's `transform` attribute as a matrix (the identity when it has none). */
export function transformOf(text: string | undefined): Matrix {
  if (!text?.includes('(')) return IDENTITY;
  let out = IDENTITY;
  FUNCTIONS.lastIndex = 0;
  for (let match = FUNCTIONS.exec(text); match; match = FUNCTIONS.exec(text)) {
    const name = match[1] as string;
    const n = (match[2] ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const [a = 0, b = 0] = n;
    const matrix = (): Matrix => {
      switch (name) {
        case 'matrix':
          return [a, b, n[2] ?? 0, n[3] ?? 1, n[4] ?? 0, n[5] ?? 0];
        case 'translate':
          return [1, 0, 0, 1, a, b];
        case 'scale':
          return [a, 0, 0, n.length > 1 ? b : a, 0, 0];
        case 'rotate': {
          const angle = (a * Math.PI) / 180;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const turn: Matrix = [cos, sin, -sin, cos, 0, 0];
          if (n.length < 3) return turn;
          // About a point: translate there, turn, translate back.
          return multiply(multiply([1, 0, 0, 1, n[1] as number, n[2] as number], turn), [
            1,
            0,
            0,
            1,
            -(n[1] as number),
            -(n[2] as number),
          ]);
        }
        case 'skewX':
          return [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
        case 'skewY':
          return [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
        default:
          return IDENTITY;
      }
    };
    out = multiply(out, matrix());
  }
  return out;
}
