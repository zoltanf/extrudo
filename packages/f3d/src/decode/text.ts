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
 */
import { F3dFormatError, Reader } from '../bytes';
import { readPrologue, readProps, type Segment } from '../segment';
import type { RecordDecoder } from './common';
import { ownerAtEnd } from './sketch-geometry';

export const SKETCH_TEXT = 'F0B1AFA3-3BAF-42D0-B2F3-94B95662F2A9';
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
