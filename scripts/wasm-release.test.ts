// The download check of the WASM releases (`scripts/wasm-release.mjs`): a
// tarball is unpacked only when it has the SHA-256 GitHub reports for it.
import { describe, expect, it } from 'vitest';
import { checkDigest, sha256Digest } from './wasm-release.mjs';

const bytes = new TextEncoder().encode('a release tarball');
const good = sha256Digest(bytes);

describe('checkDigest', () => {
  it('passes the bytes the release says', () => {
    expect(good).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() => checkDigest(bytes, good, 'x.tar.gz')).not.toThrow();
  });

  it('refuses other bytes', () => {
    const other = new TextEncoder().encode('a release tarbalm');
    expect(() => checkDigest(other, good, 'x.tar.gz')).toThrow(
      /SHA-256 is sha256:[0-9a-f]{64}, the release says/,
    );
  });

  it('refuses a download it cannot check', () => {
    for (const digest of [
      undefined,
      null,
      '',
      'sha256:abc',
      `md5:${'0'.repeat(64)}`,
      good.toUpperCase(),
    ])
      expect(() => checkDigest(bytes, digest, 'x.tar.gz')).toThrow(/no SHA-256 digest/);
  });
});
