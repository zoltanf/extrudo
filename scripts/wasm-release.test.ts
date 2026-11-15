// The download checks of the WASM releases (`scripts/wasm-release.mjs`): a
// tarball is unpacked only when it has the SHA-256 pinned for its release in
// `scripts/wasm-pins.json`, and `ensure` refuses a dist/ whose files changed.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkDigest,
  checkManifest,
  DigestMismatch,
  PINS,
  pinFor,
  readPins,
  sha256,
  writeManifest,
} from './wasm-release.mjs';

const bytes = new TextEncoder().encode('a release tarball');
const good = sha256(bytes);
const pins = { occt: { tag: 'occt-0123456789ab', sha256: good } };

describe('checkDigest', () => {
  it('passes the pinned bytes', () => {
    expect(good).toMatch(/^[0-9a-f]{64}$/);
    expect(() =>
      checkDigest(bytes, pinFor(pins, 'occt', 'occt-0123456789ab'), 'x.tar.gz'),
    ).not.toThrow();
  });

  it('refuses other bytes, naming the file and both digests', () => {
    const other = new TextEncoder().encode('a release tarbalm');
    let error: unknown;
    try {
      checkDigest(other, good, 'x.tar.gz');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DigestMismatch);
    const message = (error as Error).message;
    expect(message).toContain('x.tar.gz');
    expect(message).toContain(`expected ${good}`);
    expect(message).toContain(`actual   ${sha256(other)}`);
  });
});

describe('pinFor', () => {
  it('refuses a release without a pin', () => {
    expect(() => pinFor(pins, 'planegcs', 'planegcs-0123456789ab')).toThrow(
      /no SHA-256 for planegcs-0123456789ab/,
    );
    expect(() => pinFor({}, 'occt', 'occt-0123456789ab')).toThrow(/no SHA-256/);
  });

  it('refuses a pin for another tag, or a malformed one', () => {
    expect(() => pinFor(pins, 'occt', 'occt-ba9876543210')).toThrow(
      /no SHA-256 for occt-ba9876543210 \(it pins occt-0123456789ab\)/,
    );
    for (const sha of [undefined, '', 'abc', good.toUpperCase(), `sha256:${good}`])
      expect(() =>
        pinFor({ occt: { tag: 'occt-0123456789ab', sha256: sha } }, 'occt', 'occt-0123456789ab'),
      ).toThrow(/no SHA-256/);
  });

  it('the checked-in pins are well formed', () => {
    const checkedIn = readPins(PINS);
    expect(Object.keys(checkedIn).sort()).toEqual(['occt', 'openscad', 'planegcs']);
    for (const [name, pin] of Object.entries(checkedIn) as [string, { tag: string }][])
      expect(pinFor(checkedIn, name, pin.tag)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('checkManifest', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const dist = () => {
    dir = mkdtempSync(join(tmpdir(), 'wasm-dist-'));
    writeFileSync(join(dir, 'a.wasm'), 'wasm');
    writeFileSync(join(dir, 'a.js'), 'glue');
    writeFileSync(join(dir, '.inputs-hash'), 'hash\n');
    writeManifest(dir);
    return dir;
  };

  it('passes an unchanged dist/ and says when there is no record', () => {
    const d = dist();
    expect(readFileSync(join(d, '.sha256'), 'utf8')).toBe(
      `${sha256(new TextEncoder().encode('glue'))}  a.js\n${sha256(new TextEncoder().encode('wasm'))}  a.wasm\n`,
    );
    expect(checkManifest(d)).toBe(true);
    rmSync(join(d, '.sha256'));
    expect(checkManifest(d)).toBe(false);
  });

  it('refuses a changed, added or missing file', () => {
    const d = dist();
    writeFileSync(join(d, 'a.wasm'), 'wasn');
    expect(() => checkManifest(d)).toThrow(DigestMismatch);
    expect(() => checkManifest(d)).toThrow(/a\.wasm: SHA-256 mismatch/);
    writeFileSync(join(d, 'a.wasm'), 'wasm');
    writeFileSync(join(d, 'b.js'), '');
    expect(() => checkManifest(d)).toThrow(/b\.js is not one the build made/);
    rmSync(join(d, 'b.js'));
    rmSync(join(d, 'a.js'));
    expect(() => checkManifest(d)).toThrow(/a\.js is missing/);
  });
});
