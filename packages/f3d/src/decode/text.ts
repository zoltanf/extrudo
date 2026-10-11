/**
 * Sketch text (`F0B1AFA3…`, versions 3 and 4). A leading block lists the
 * four lines of the text's box (u32 n, n × (reference, u32);
 * `EA3B930A…`, a sketch-line subclass: a
 * reference to the text, then start and displacement as a line's); then the
 * property block (`txt_tag`, `txt_tag_base`) and the members: f64 angle of
 * the baseline from the sketch's x axis, a byte, four bytes, 12 zero bytes,
 * f32 1, wstr font family ("Arial", "Arial Narrow", "DIN Condensed"…), f64
 * height (cm), two bytes, the box corner the baseline starts from (2 f64),
 * zeros (and in version 4 three more bytes), wstr text, the box lines again,
 * a trailer and the owner backlink. The box runs from the corner along the
 * baseline for the text's width and up (90° anticlockwise) for its height.
 *
 * An extrude takes text through a text-profile operand (`92F9A5F4…`), which
 * names its sketch by record number as a sketch-profile operand does.
 *
 * Older files (2018–19) have another record (`E0618268…`, version 0): a
 * presence byte and the property block (`textex_tag`, `txt_tag_base`); a
 * byte, an f64, 12 zero bytes, f32 1; wstr font; a byte; f64 height (cm, the
 * capitals'), and a reference to its parameter when it has one; u32
 * horizontal alignment (1 left, 3 centre) and three zero bytes; wstr text
 * (lines split by `\n`); a byte, the vertical alignment (1 top, 3 middle),
 * u32 weight (500, 750) or other fields; then a 4 × 4 row-major matrix from
 * the text's frame into the sketch's (cm), its origin the lower left corner
 * of the text's box; a trailer and the owner backlink. The box is four sketch
 * lines (`16DEFC4D…`, a line subclass: start and displacement in the base
 * level) that a link record (`8B369926…`, a constraint subclass) lists with
 * the text. Checked against the B-rep of the text's cut: (3, 3) centred in
 * its box, (3, 1) with the capitals' top on the box's.
 */
import { F3dFormatError, Reader } from '../bytes';
import { readPrologue, readProps, type Segment } from '../segment';
import type { RecordDecoder } from './common';
import { ownerAtEnd } from './sketch-geometry';

export const SKETCH_TEXT = 'F0B1AFA3-3BAF-42D0-B2F3-94B95662F2A9';
export const SKETCH_TEXT_OLD = 'E0618268-3A06-450E-9E94-7CF4C2E66802';
/** Links an older text with the four lines of its box (a constraint subclass). */
export const OLD_TEXT_BOX = '8B369926-123F-4F9D-878E-6D4C076128D3';
/** An older text's box line (a sketch-line subclass). */
const BOX_LINE = '16DEFC4D-1816-4FB0-8E39-9BDA23954248';
export const TEXT_PROFILE_OPERAND = '92F9A5F4-09AA-4B1B-9EE6-DF574D1D183C';

export interface SketchText {
  id: number;
  text: string;
  font: string;
  /** Text height, cm. */
  height: number;
  /** The baseline's angle from the sketch's x axis, radians. */
  angle: number;
  /** The box corner where the baseline starts, sketch frame, cm. */
  at: [number, number];
  /** The box's length along the baseline, cm. */
  width: number;
  /**
   * An older text (`E0618268…`): `at` is its box's corner and `angle` its
   * frame's (`width` 0), `height` the capitals'; `mirrored` when the frame
   * turns over (the text reads backwards in the sketch); the alignment codes;
   * the box's size along and across the baseline (cm), when found.
   */
  old?: { mirrored: boolean; horizontal: number; vertical: number; box?: [number, number] };
  owner?: number;
}

export const sketchText: RecordDecoder<SketchText> = {
  name: 'sketch text',
  decode: (seg, id) => {
    const r = seg.reader(id);
    if (!r.bool()) throw new F3dFormatError(`Sketch text #${id}: no box.`);
    const n = r.u32();
    if (n > 16) throw new F3dFormatError(`Sketch text #${id}: ${n} box lines.`);
    const box: number[] = [];
    for (let i = 0; i < n; i++) {
      const ref = r.ref();
      if (ref) box.push(ref.id);
      r.u32();
    }
    readProps(r);
    const angle = r.f64();
    r.skip(5);
    r.zeros(12);
    r.skip(4);
    const font = r.wstr(200);
    const height = r.f64();
    r.skip(2);
    const at: [number, number] = [r.f64(), r.f64()];
    const text = textAfter(r, n);
    if (text === undefined) throw new F3dFormatError(`Sketch text #${id}: no text.`);
    const base = [Math.cos(angle), Math.sin(angle)] as const;
    let width = 0;
    for (const line of box) {
      const d = displacement(seg, line);
      if (d) width = Math.max(width, Math.abs(d[0] * base[0] + d[1] * base[1]));
    }
    const owner = ownerAtEnd(seg, r);
    return {
      id,
      text,
      font,
      height,
      angle,
      at,
      width,
      ...(owner !== undefined ? { owner } : {}),
    };
  },
};

/**
 * The text: a wide string a few bytes on (zeros, and in version 4 three
 * more bytes), followed by the box-line count again.
 */
function textAfter(r: Reader, lines: number): string | undefined {
  const from = r.pos;
  for (let skip = 8; skip <= 12; skip++) {
    r.pos = from + skip;
    const n = r.peekU32();
    if (n === undefined || n < 1 || n > 4096 || r.remaining < 8 + 2 * n) continue;
    if (r.peekU32(4 + 2 * n) !== lines) continue;
    return r.wstr();
  }
  r.pos = from;
  return undefined;
}

/** A box line's displacement (sketch frame, cm). */
function displacement(seg: Segment, id: number): [number, number] | undefined {
  try {
    const r = new Reader(seg.bulk, seg.frame(id).start, seg.frame(id).end);
    readPrologue(r);
    r.ref();
    r.skip(24);
    return [r.f64(), r.f64()];
  } catch {
    return undefined;
  }
}

/** An older sketch text (`E0618268…`, see the module comment). */
export const sketchTextOld: RecordDecoder<SketchText> = {
  name: 'sketch text (old)',
  decode: (seg, id) => {
    const r = seg.reader(id);
    const end = seg.frame(id).end;
    r.u8();
    readProps(r);
    r.u8();
    r.f64();
    r.zeros(12);
    r.skip(4);
    const font = r.wstr(200);
    r.u8();
    const height = r.f64();
    if (r.peekU8() === 1) r.ref();
    const horizontal = r.u32();
    const text = wideStringNear(r, end);
    if (text === undefined) throw new F3dFormatError(`Sketch text #${id}: no text.`);
    const vertical = r.u8();
    const m = matrixNear(r, end);
    if (!m) throw new F3dFormatError(`Sketch text #${id}: no frame.`);
    const owner = ownerAtEnd(seg, r);
    return {
      id,
      text,
      font,
      height,
      angle: Math.atan2(m[4] as number, m[0] as number),
      at: [m[3] as number, m[7] as number],
      width: 0,
      old: {
        mirrored: (m[0] as number) * (m[5] as number) - (m[1] as number) * (m[4] as number) < 0,
        horizontal,
        vertical,
      },
      ...(owner !== undefined ? { owner } : {}),
    };
  },
};

/** A wide string starting within a few bytes (printable characters and line breaks). */
function wideStringNear(r: Reader, end: number): string | undefined {
  const from = r.pos;
  for (let skip = 0; skip < 16; skip++) {
    r.pos = from + skip;
    const n = r.peekU32();
    if (n === undefined || n < 1 || n > 4096 || r.pos + 4 + 2 * n > end) continue;
    r.skip(4);
    let text = '';
    for (let i = 0; i < n; i++) {
      const c = r.u16();
      if (c < 9 || (c > 13 && c < 32)) break;
      text += String.fromCharCode(c);
    }
    if (text.length === n) return text;
  }
  r.pos = from;
  return undefined;
}

/** A rigid 4 × 4 matrix (last row 0 0 0 1, unit rows) starting within 40 bytes. */
function matrixNear(r: Reader, end: number): number[] | undefined {
  const from = r.pos;
  for (let skip = 0; skip < 40 && from + skip + 128 <= end; skip++) {
    r.pos = from + skip;
    const m = Array.from({ length: 16 }, () => r.f64());
    const unit = (i: number) =>
      Math.abs(Math.hypot(m[4 * i] as number, m[4 * i + 1] as number, m[4 * i + 2] as number) - 1) <
      1e-6;
    const last = Math.abs((m[15] as number) - 1) < 1e-9;
    const flat = Math.abs(m[12] as number) + Math.abs(m[13] as number) + Math.abs(m[14] as number);
    if (last && flat < 1e-12 && unit(0) && unit(1) && unit(2)) return m;
  }
  r.pos = from;
  return undefined;
}

/**
 * The boxes of older texts: text record → its box lines' end points (sketch
 * frame, cm), from the link records.
 */
export function oldTextBoxes(
  seg: Segment,
  refsOf: (id: number) => number[],
): Map<number, [number, number][]> {
  const out = new Map<number, [number, number][]>();
  for (const id of seg.idsOf(OLD_TEXT_BOX)) {
    const refs = [...new Set(refsOf(id))];
    const text = refs.find((r) => seg.typeOf(r)?.guid === SKETCH_TEXT_OLD);
    if (text === undefined) continue;
    const points: [number, number][] = [];
    for (const line of refs) {
      if (seg.typeOf(line)?.guid !== BOX_LINE) continue;
      try {
        const b = seg.baseReader(line);
        const p: [number, number, number] = [b.f64(), b.f64(), b.f64()];
        const d: [number, number] = [b.f64(), b.f64()];
        points.push([p[0], p[1]], [p[0] + d[0], p[1] + d[1]]);
      } catch {
        // a line this reader does not follow
      }
    }
    if (points.length) out.set(text, points);
  }
  return out;
}

/** A box's size along and across an older text's baseline, from its corner points. */
export function boxSize(t: SketchText, points: [number, number][]): [number, number] {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  const flip = t.old?.mirrored ? -1 : 1;
  let w = 0;
  let h = 0;
  for (const [x, y] of points) {
    const dx = x - t.at[0];
    const dy = y - t.at[1];
    w = Math.max(w, dx * c + dy * s);
    h = Math.max(h, flip * (-dx * s + dy * c));
  }
  return [w, h];
}
