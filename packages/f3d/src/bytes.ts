/**
 * Little-endian reading over a byte range, with the primitives Fusion's design
 * streams are written in: integers, doubles, length-prefixed ASCII and UTF-16
 * strings, and references to other records.
 */

/** A file that is not the shape this reader expects. */
export class F3dFormatError extends Error {
  override name = 'F3dFormatError';
}

/**
 * A reference to another record. `segment` is set when the target is in another
 * segment of the same design; `external` when it names another document.
 */
export interface Ref {
  id: number;
  segment?: number;
  external?: true;
}

const ascii = new TextDecoder('latin1');
const utf16 = new TextDecoder('utf-16le');

export class Reader {
  readonly bytes: Uint8Array;
  readonly end: number;
  readonly #view: DataView;
  pos: number;

  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.end = end;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = start;
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  #need(n: number): void {
    if (n < 0 || this.pos + n > this.end)
      throw new F3dFormatError(`Read past the end at ${this.pos} (+${n}, end ${this.end}).`);
  }

  u8(): number {
    this.#need(1);
    return this.bytes[this.pos++] as number;
  }

  /** A byte that must be 0 or 1. */
  bool(): boolean {
    const at = this.pos;
    const v = this.u8();
    if (v > 1) throw new F3dFormatError(`Expected a boolean at ${at}, found ${v}.`);
    return v === 1;
  }

  u16(): number {
    this.#need(2);
    const v = this.#view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.#need(4);
    const v = this.#view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.#need(4);
    const v = this.#view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** A u64 that must fit a JS number exactly (record ids, counts, offsets). */
  u64(): number {
    this.#need(8);
    const lo = this.#view.getUint32(this.pos, true);
    const hi = this.#view.getUint32(this.pos + 4, true);
    this.pos += 8;
    if (hi > 0x1fffff) throw new F3dFormatError(`u64 too large at ${this.pos - 8}.`);
    return hi * 0x100000000 + lo;
  }

  /** A raw u64, for tags and flags that may use the high bits. */
  u64big(): bigint {
    this.#need(8);
    const v = this.#view.getBigUint64(this.pos, true);
    this.pos += 8;
    return v;
  }

  f64(): number {
    this.#need(8);
    const v = this.#view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  take(n: number): Uint8Array {
    this.#need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  skip(n: number): void {
    this.#need(n);
    this.pos += n;
  }

  /** `n` bytes that must all be zero. */
  zeros(n: number): void {
    const at = this.pos;
    const b = this.take(n);
    for (let i = 0; i < n; i++)
      if (b[i] !== 0) throw new F3dFormatError(`Expected ${n} zero bytes at ${at}.`);
  }

  /** u32 byte length + ASCII. */
  str8(max = 1 << 20): string {
    const at = this.pos;
    const n = this.u32();
    if (n > max) throw new F3dFormatError(`String length ${n} at ${at} is too long.`);
    return ascii.decode(this.take(n));
  }

  /** u32 code-unit count + UTF-16LE. */
  wstr(max = 1 << 20): string {
    const at = this.pos;
    const n = this.u32();
    if (n > max) throw new F3dFormatError(`String length ${n} at ${at} is too long.`);
    return utf16.decode(this.take(2 * n));
  }

  peekU8(offset = 0): number | undefined {
    const at = this.pos + offset;
    return at < this.end ? this.bytes[at] : undefined;
  }

  peekU32(offset = 0): number | undefined {
    const at = this.pos + offset;
    return at + 4 <= this.end ? this.#view.getUint32(at, true) : undefined;
  }

  /**
   * A reference member: a presence byte (0 ends it), the target id, then where
   * the target lives. One file generation writes the target's type GUID
   * (LP-ASCII, 36 characters) between the id and the flags; the length prefix
   * tells it apart from the flag bytes, so the form is read from the bytes.
   */
  ref(): Ref | null {
    if (!this.bool()) return null;
    const id = this.u64();
    if (this.peekU32() === 36) this.str8(36);
    const crossDocument = this.bool();
    if (!crossDocument) {
      if (this.bool()) return { id, segment: this.u32() };
      return { id };
    }
    const segment = this.u32();
    this.wstr(256); // the asset GUID
    if (!this.bool()) {
      this.str8(64); // the target's type GUID
      this.wstr(1024); // the link name
      if (this.bool()) {
        this.wstr(256); // the property-key GUID
        this.wstr(4096); // the version URN
      }
    }
    return { id, segment, external: true };
  }

  /** A reference that must be present and local to this segment. */
  localRef(): number {
    const at = this.pos;
    const r = this.ref();
    if (!r || r.segment !== undefined || r.external)
      throw new F3dFormatError(`Expected a local reference at ${at}.`);
    return r.id;
  }

  /** u32 count + that many references. */
  refList(max = 1 << 20): (Ref | null)[] {
    const at = this.pos;
    const n = this.u32();
    if (n > max || n > this.remaining) throw new F3dFormatError(`Bad list length ${n} at ${at}.`);
    const out: (Ref | null)[] = [];
    for (let i = 0; i < n; i++) out.push(this.ref());
    return out;
  }
}
