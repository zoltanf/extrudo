/**
 * A feature (a "parameter scope"): one record per timeline feature, whatever
 * its kind. Its feature-specific members come first; all of them end in the
 * same tail:
 *
 *   u32 n, n references        the ordered reference table (the inputs:
 *                              parameter owners, profile and edge selections…)
 *   u32 state                  the ASM history state after the feature
 *                              (0xffffffff when suppressed)
 *   wstr kind                  "Sketch", "Extrude", "Fillet"… (localized)
 *   u32 ordinal                1-based among features of the same kind
 *   [u32 0, wstr label]        a renamed feature's own name
 *   …                          lanes and the preceding history state
 *
 * The tail is found by its shape rather than at a fixed offset, because the
 * feature-specific part before it differs in length between kinds and
 * versions.
 */
import { F3dFormatError, Reader } from '../bytes';
import type { Segment } from '../segment';

export interface Scope {
  id: number;
  kind: string;
  ordinal: number;
  /** The user's own name for the feature, when it was renamed. */
  label?: string;
  /** Inputs, in order: record ids. */
  refs: number[];
  /** History state after the feature; null when suppressed. */
  state: number | null;
  /** Byte offset (in the BulkStream) where the reference table starts. */
  tableAt: number;
  /** The most-derived level's byte range. */
  start: number;
  end: number;
}

/** UTF-16 letters, spaces and hyphens: a feature-family name. */
function isKindAt(bytes: Uint8Array, at: number, n: number): boolean {
  if (n < 3 || n > 40) return false;
  for (let i = 0; i < n; i++) {
    const lo = bytes[at + 2 * i] as number;
    const hi = bytes[at + 2 * i + 1];
    if (hi !== 0) {
      // localized names (Congé, Esboço, Extrusão) use Latin-1 letters
      if (hi !== 0 || lo < 0xc0) return false;
    }
    const ok =
      (lo >= 0x41 && lo <= 0x5a) ||
      (lo >= 0x61 && lo <= 0x7a) ||
      lo === 0x20 ||
      lo === 0x2d ||
      lo >= 0xc0;
    if (!ok) return false;
  }
  const first = bytes[at] as number;
  return first >= 0x41 && first <= 0x5a;
}

/** Tries to read a reference table ending exactly at `end`. */
function tableEndingAt(
  seg: Segment,
  from: number,
  end: number,
): { at: number; refs: number[] } | undefined {
  // The table is u32 n + n references; references are 11 bytes, or 51 when
  // they carry the target type GUID. Try both widths for n up to 512 and keep
  // the longest table that fits: an empty one also "ends" inside the last
  // reference's zero bytes.
  let best: { at: number; refs: number[] } | undefined;
  for (const width of [11, 51]) {
    for (let n = 0; n <= 512; n++) {
      const at = end - 4 - n * width;
      if (at < from) break;
      const r = new Reader(seg.bulk, at, end);
      if (r.u32() !== n) continue;
      try {
        const refs: number[] = [];
        for (let i = 0; i < n; i++) refs.push(r.localRef());
        if (r.pos === end && refs.every((id) => seg.has(id)) && (!best || n > best.refs.length))
          best = { at, refs };
      } catch {
        // not a table of this width and length
      }
    }
  }
  return best;
}

export function readScope(seg: Segment, id: number): Scope {
  const f = seg.frame(id);
  const b = seg.bulk;
  // Scan backwards for `u32 L` + L UTF-16 letters preceded by a reference
  // table and a u32 state.
  for (let p = f.end - 8; p >= f.start + 6; p--) {
    const n =
      (b[p] as number) |
      ((b[p + 1] as number) << 8) |
      ((b[p + 2] as number) << 16) |
      ((b[p + 3] as number) << 24);
    if (n < 3 || n > 40 || p + 4 + 2 * n > f.end) continue;
    if (!isKindAt(b, p + 4, n)) continue;
    const table = tableEndingAt(seg, f.start, p - 4);
    if (!table) continue;
    const r = new Reader(b, p - 4, f.end);
    const rawState = r.u32();
    const kind = r.wstr(64);
    const ordinal = r.u32();
    let label: string | undefined;
    // A renamed feature: u32 0 and the label.
    if (r.remaining >= 8 && r.peekU32() === 0) {
      const len = r.peekU32(4) as number;
      if (len > 0 && len < 512 && 8 + 2 * len <= r.remaining) {
        r.skip(4);
        label = r.wstr(512);
      }
    }
    return {
      id,
      kind,
      ordinal,
      ...(label !== undefined ? { label } : {}),
      refs: table.refs,
      state: rawState === 0xffffffff ? null : rawState,
      tableAt: table.at,
      start: f.start,
      end: f.end,
    };
  }
  throw new F3dFormatError(`Record ${id}: no feature tail found.`);
}
