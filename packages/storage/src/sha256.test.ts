import { describe, expect, it } from 'vitest';
import { SHA256_PATTERN, sha256Hex } from './sha256';

/** The reference implementation's answer, for the same bytes. */
async function webCrypto(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('sha256Hex', () => {
  it('hashes the empty input and the published test vector', async () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    // FIPS 180-4: "abc"
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('agrees with Web Crypto around every padding boundary', async () => {
    for (const length of [0, 1, 2, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 4096]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 11) % 256;
      expect(sha256Hex(bytes)).toBe(await webCrypto(bytes));
    }
  });

  it('reads a byte view that starts inside a buffer', async () => {
    const backing = new Uint8Array([0, 1, 2, 3, 250, 251, 252]);
    expect(sha256Hex(backing.subarray(2, 5))).toBe(await webCrypto(backing.subarray(2, 5)));
  });

  it('names hashes the way the document spells them', () => {
    expect(SHA256_PATTERN.test(sha256Hex(new Uint8Array([1, 2, 3])))).toBe(true);
    expect(SHA256_PATTERN.test(sha256Hex(new Uint8Array([1, 2, 3])).toUpperCase())).toBe(false);
    expect(SHA256_PATTERN.test('abc')).toBe(false);
  });
});
