/**
 * PDF writer (P6-24 S0, ADR-0143's amendment): our own, in the tradition of
 * `writeSvg` and `writeDxf`. PDF 1.4, one page per sheet at its true size,
 * vector paths with a width, dash and fill, content streams deflated through
 * fflate. Coordinates are millimetres with y up and the origin at the page's
 * lower left, as PDF's own user space but scaled by one `cm` per page.
 *
 * Text is the caller's glyph outlines, filled, plus an invisible copy of its
 * string (render mode 3) in Helvetica, a base-14 font no reader needs
 * embedded, stretched with `Tz` to the outlines' width so selecting and
 * searching land on the drawn text. The string is written in WinAnsiEncoding;
 * a character outside it goes in as `?` (the outlines still draw it).
 *
 * Nothing here shapes text: `@extrudo/io` is MIT and must not import the
 * sketch package that holds the font parser, so outlines come in as contours.
 */
import { zlibSync } from 'fflate';
import { type Contour, ellipseAt, ellipseParam, type Point } from './drawing';
import { num } from './format';

/** Millimetres per PDF point. */
const PT = 25.4 / 72;

export interface PdfStroke {
  /** Line width, mm. */
  width: number;
  /** `#rrggbb`; black when left out. */
  color?: string;
  /** Dash pattern, mm: on, off, on, … */
  dash?: readonly number[];
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
}

export interface PdfFill {
  color: string;
  /** Even-odd makes a region's inner contours holes (as `writeSvg`). Default even-odd. */
  rule?: 'evenodd' | 'nonzero';
}

export type PdfItem =
  | { type: 'path'; contours: readonly Contour[]; stroke?: PdfStroke; fill?: PdfFill }
  | {
      type: 'text';
      /** The string, for the invisible, selectable layer. */
      text: string;
      /** Glyph outlines in page mm, filled even-odd in `color`. */
      outline: readonly Contour[];
      color?: string;
      /** Start of the baseline, page mm. */
      at: Point;
      /** Cap height, mm. */
      height: number;
      /** Length along the baseline the string should cover, mm. */
      width: number;
      /** Baseline direction, radians counter-clockwise. */
      angle?: number;
    };

export interface PdfPage {
  /** Page size, mm. */
  width: number;
  height: number;
  items: readonly PdfItem[];
}

export interface PdfOptions {
  title?: string;
  /** Deflate content streams (default true; false for reading the output in tests). */
  compress?: boolean;
}

export function writePdf(pages: readonly PdfPage[], options: PdfOptions = {}): Uint8Array {
  const compress = options.compress ?? true;
  // Object numbers: 1 catalog, 2 page tree, 3 font, 4 info, then a page and its content per page.
  const objects: (string | Uint8Array)[][] = [];
  const pageRef = (i: number) => `${5 + 2 * i} 0 R`;
  objects[1] = ['<< /Type /Catalog /Pages 2 0 R >>'];
  objects[2] = [
    `<< /Type /Pages /Kids [${pages.map((_, i) => pageRef(i)).join(' ')}] /Count ${pages.length} >>`,
  ];
  objects[3] = [
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  objects[4] = [
    `<< /Producer (Extrudo)${options.title ? ` /Title ${textString(options.title)}` : ''} >>`,
  ];
  pages.forEach((page, i) => {
    const w = num(page.width / PT, 3);
    const h = num(page.height / PT, 3);
    objects[5 + 2 * i] = [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`,
    ];
    const content = ascii(pageContent(page));
    const data = compress ? zlibSync(content, { level: 9 }) : content;
    objects[6 + 2 * i] = [
      `<< /Length ${data.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`,
      data,
      '\nendstream',
    ];
  });

  const chunks: Uint8Array[] = [];
  let size = 0;
  const put = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? ascii(part) : part;
    chunks.push(bytes);
    size += bytes.length;
  };
  // The binary comment line tells transfer tools the file is binary.
  put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = size;
    put(`${n} 0 obj\n`);
    for (const part of objects[n] ?? []) put(part);
    put('\nendobj\n');
  }
  const xref = size;
  put(`xref\n0 ${objects.length}\n0000000000 65535 f \n`);
  for (let n = 1; n < objects.length; n++)
    put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  put(
    `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );

  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function pageContent(page: PdfPage): string {
  const ops: string[] = [`${num(1 / PT, 6)} 0 0 ${num(1 / PT, 6)} 0 0 cm`];
  for (const item of page.items) {
    if (item.type === 'path') {
      const path = pathOps(item.contours);
      if (!path || (!item.stroke && !item.fill)) continue;
      ops.push('q');
      if (item.fill) ops.push(`${rgb(item.fill.color)} rg`);
      if (item.stroke) {
        const s = item.stroke;
        ops.push(`${rgb(s.color ?? '#000000')} RG`, `${num(s.width)} w`);
        ops.push(`${CAP[s.cap ?? 'round']} J`, `${JOIN[s.join ?? 'round']} j`);
        if (s.dash?.length) ops.push(`[${s.dash.map((d) => num(d)).join(' ')}] 0 d`);
      }
      const evenOdd = item.fill?.rule !== 'nonzero';
      const paint = item.fill ? (item.stroke ? 'B' : 'f') : 'S';
      ops.push(path, item.fill && evenOdd ? `${paint}*` : paint, 'Q');
    } else {
      const path = pathOps(item.outline);
      if (path) ops.push('q', `${rgb(item.color ?? '#000000')} rg`, path, 'f*', 'Q');
      const encoded = winAnsi(item.text);
      if (encoded.length === 0 || item.height <= 0) continue;
      // Helvetica's cap height is 718/1000 em.
      const size = item.height / 0.718;
      const natural = (helveticaWidth(encoded) / 1000) * size;
      const stretch = natural > 0 && item.width > 0 ? (100 * item.width) / natural : 100;
      const c = Math.cos(item.angle ?? 0);
      const s = Math.sin(item.angle ?? 0);
      ops.push(
        'BT',
        '3 Tr',
        `/F1 ${num(size)} Tf`,
        `${num(stretch, 3)} Tz`,
        `${num(c, 6)} ${num(s, 6)} ${num(-s, 6)} ${num(c, 6)} ${num(item.at[0])} ${num(item.at[1])} Tm`,
        `<${hex(encoded)}> Tj`,
        'ET',
      );
    }
  }
  return ops.join('\n');
}

const CAP = { butt: 0, round: 1, square: 2 } as const;
const JOIN = { miter: 0, round: 1, bevel: 2 } as const;

const pt = (p: Point) => `${num(p[0])} ${num(p[1])}`;

/** Path construction operators; arcs and ellipses as cubic Béziers of a quarter turn or less. */
function pathOps(contours: readonly Contour[]): string {
  const out: string[] = [];
  for (const contour of contours) {
    out.push(`${pt(contour.start)} m`);
    let at = contour.start;
    for (const segment of contour.segments) {
      switch (segment.type) {
        case 'line':
          out.push(`${pt(segment.to)} l`);
          break;
        case 'arc': {
          const { center, sweep } = segment;
          const r = Math.hypot(at[0] - center[0], at[1] - center[1]);
          const a0 = Math.atan2(at[1] - center[1], at[0] - center[0]);
          out.push(
            ...ellipticBeziers({ center, rx: r, ry: r, rotation: 0 }, a0, sweep, segment.to),
          );
          break;
        }
        case 'ellipse':
          out.push(
            ...ellipticBeziers(segment, ellipseParam(segment, at), segment.sweep, segment.to),
          );
          break;
        case 'quadratic': {
          const { control: q, to } = segment;
          const c1: Point = [at[0] + (2 / 3) * (q[0] - at[0]), at[1] + (2 / 3) * (q[1] - at[1])];
          const c2: Point = [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])];
          out.push(`${pt(c1)} ${pt(c2)} ${pt(to)} c`);
          break;
        }
        case 'cubic':
          out.push(`${pt(segment.c1)} ${pt(segment.c2)} ${pt(segment.to)} c`);
          break;
      }
      at = segment.to;
    }
    if (contour.closed) out.push('h');
  }
  return out.join(' ');
}

/** An elliptical arc from parameter `t0` over `sweep`, ending exactly at `end`. */
function ellipticBeziers(
  e: { center: Point; rx: number; ry: number; rotation: number },
  t0: number,
  sweep: number,
  end: Point,
): string[] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  // Derivative of the ellipse at t, per radian.
  const tangent = (t: number): Point => {
    const x = -e.rx * Math.sin(t);
    const y = e.ry * Math.cos(t);
    return [x * cos - y * sin, x * sin + y * cos];
  };
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = t0 + step * i;
    const b = a + step;
    const p0 = ellipseAt(e, a);
    const p3 = i === n - 1 ? end : ellipseAt(e, b);
    const d0 = tangent(a);
    const d3 = tangent(b);
    const c1: Point = [p0[0] + k * d0[0], p0[1] + k * d0[1]];
    const c2: Point = [p3[0] - k * d3[0], p3[1] - k * d3[1]];
    out.push(`${pt(c1)} ${pt(c2)} ${pt(p3)} c`);
  }
  return out;
}

function rgb(color: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return '0 0 0';
  return [m[1], m[2], m[3]].map((h) => num(Number.parseInt(h as string, 16) / 255, 3)).join(' ');
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const hex = (bytes: readonly number[]) =>
  bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

/** A PDF text string: UTF-16BE with its byte-order mark, in hex. */
function textString(text: string): string {
  let out = '<FEFF';
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).padStart(4, '0');
  return `${out}>`;
}

/** WinAnsiEncoding's codes 0x80–0x9F, by Unicode code point. */
const WIN_ANSI_HIGH: Record<number, number> = {
  8364: 0x80,
  8218: 0x82,
  402: 0x83,
  8222: 0x84,
  8230: 0x85,
  8224: 0x86,
  8225: 0x87,
  710: 0x88,
  8240: 0x89,
  352: 0x8a,
  8249: 0x8b,
  338: 0x8c,
  381: 0x8e,
  8216: 0x91,
  8217: 0x92,
  8220: 0x93,
  8221: 0x94,
  8226: 0x95,
  8211: 0x96,
  8212: 0x97,
  732: 0x98,
  8482: 0x99,
  353: 0x9a,
  8250: 0x9b,
  339: 0x9c,
  382: 0x9e,
  376: 0x9f,
};

/** The string's WinAnsiEncoding bytes; a character it lacks becomes `?`. Line breaks become spaces. */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (code === 0x0a || code === 0x09) out.push(0x20);
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else out.push(WIN_ANSI_HIGH[code] ?? 0x3f);
  }
  return out;
}

/**
 * Helvetica's advance widths (1/1000 em) from Adobe's core-font metrics, for
 * codes 0x20–0x7E and 0xA0–0xFF of WinAnsiEncoding; 0x80–0x9F use 556 (most
 * are; a wrong one only shifts the selection box, the stretch fixes the total).
 */
const HELVETICA_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_LATIN1 = [
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333,
  333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667,
  1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778,
  722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556,
  278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556,
  500,
];

function helveticaWidth(codes: readonly number[]): number {
  let width = 0;
  for (const code of codes) {
    if (code >= 0x20 && code <= 0x7e) width += HELVETICA_ASCII[code - 0x20] ?? 556;
    else if (code >= 0xa0) width += HELVETICA_LATIN1[code - 0xa0] ?? 556;
    else width += 556;
  }
  return width;
}
