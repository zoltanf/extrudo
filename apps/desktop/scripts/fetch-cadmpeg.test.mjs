// The cadmpeg pin and the fetch script's pure parts (P6-19, ADR-0115 §3). No
// network: the download itself is checked by hand and by the desktop workflow.
import { describe, expect, it } from 'vitest';
import { binaryName, downloadUrl, hostTriple, readPin } from './fetch-cadmpeg.mjs';

const TRIPLES = [
  'aarch64-apple-darwin',
  'aarch64-unknown-linux-gnu',
  'x86_64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
];

describe('cadmpeg.json', () => {
  const pin = readPin();

  it('pins exactly the five release targets', () => {
    expect(Object.keys(pin.archives).sort()).toEqual(TRIPLES);
  });

  it('holds a lowercase hex SHA-256 and the release file name for each', () => {
    for (const [triple, archive] of Object.entries(pin.archives)) {
      expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(archive.file).toBe(
        `cadmpeg-${triple}.${triple.includes('windows') ? 'zip' : 'tar.xz'}`,
      );
    }
  });
});

describe('fetch-cadmpeg', () => {
  it('maps the host to a triple', () => {
    expect(hostTriple('linux', 'x64')).toBe('x86_64-unknown-linux-gnu');
    expect(hostTriple('linux', 'arm64')).toBe('aarch64-unknown-linux-gnu');
    expect(hostTriple('darwin', 'x64')).toBe('x86_64-apple-darwin');
    expect(hostTriple('darwin', 'arm64')).toBe('aarch64-apple-darwin');
    expect(hostTriple('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
    expect(hostTriple('win32', 'arm64')).toBeUndefined();
    expect(hostTriple('freebsd', 'x64')).toBeUndefined();
  });

  it('builds the release download URL', () => {
    const pin = {
      version: '1.2.3',
      repository: 'https://example.org/cadmpeg',
      archives: { 'x86_64-apple-darwin': { file: 'a.tar.xz', sha256: '0'.repeat(64) } },
    };
    expect(downloadUrl(pin, 'x86_64-apple-darwin')).toBe(
      'https://example.org/cadmpeg/releases/download/v1.2.3/a.tar.xz',
    );
    expect(() => downloadUrl(pin, 'x86_64-pc-windows-msvc')).toThrow(/no cadmpeg archive/);
  });

  it('names the binary per OS', () => {
    expect(binaryName('x86_64-pc-windows-msvc')).toBe('cadmpeg.exe');
    expect(binaryName('aarch64-apple-darwin')).toBe('cadmpeg');
  });
});
