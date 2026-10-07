// The `.extrudo-plugin` file (P6-03, ADR-0077 §1): a zip of the manifest, the
// module and an optional README, refused for the same reasons wherever it is
// read (the app installing it, the kernel running a design's copy).
import { PluginManifestError } from '@extrudo/core';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { PluginFileError, readPluginFile, writePluginFile } from './plugin-file';

const MANIFEST = {
  id: 'tiny',
  name: 'Tiny',
  version: '0.1.0',
  description: 'A box.',
  author: 'Someone',
  license: 'MIT',
  main: 'main.ts',
  commands: [{ id: 'box', label: 'Box' }],
};
const CODE = "export const commands = { box: (design) => design.box({ length: '1 mm' }) };\n";

describe('readPluginFile', () => {
  it('reads back what writePluginFile packed, the same bytes every time', () => {
    const bytes = writePluginFile({ manifest: MANIFEST, code: CODE, readme: '# Tiny\n' });
    expect(writePluginFile({ manifest: MANIFEST, code: CODE, readme: '# Tiny\n' })).toEqual(bytes);
    const file = readPluginFile(bytes);
    expect(file.manifest.id).toBe('tiny');
    expect(file.manifest.features).toEqual([]);
    expect(file.code).toBe(CODE);
    expect(file.language).toBe('ts');
    expect(file.readme).toBe('# Tiny\n');
    expect(file.license).toBeUndefined();
    const js = readPluginFile(
      writePluginFile({ manifest: { ...MANIFEST, main: 'main.js' }, code: CODE }),
    );
    expect(js.language).toBe('js');
  });

  it('refuses a file without plugin.json, or without the module it names', () => {
    expect(() => readPluginFile(zipSync({ 'main.ts': strToU8(CODE) }))).toThrow(
      new PluginFileError('This plugin file has no plugin.json.'),
    );
    const noMain = zipSync({ 'plugin.json': strToU8(JSON.stringify(MANIFEST)) });
    expect(() => readPluginFile(noMain)).toThrow(
      'This plugin file has no main.ts, which its plugin.json names.',
    );
  });

  it('refuses an entry whose path leaves the root, before inflating anything', () => {
    for (const name of ['../evil.js', 'a/../../b', '/etc/passwd', 'a\\b', 'C:/x']) {
      const bytes = zipSync({
        'plugin.json': strToU8(JSON.stringify(MANIFEST)),
        'main.ts': strToU8(CODE),
        [name]: strToU8('x'),
      });
      expect(() => readPluginFile(bytes), name).toThrow(
        `This plugin file has an entry outside its folder: ${name}.`,
      );
    }
  });

  it('refuses a manifest the schema refuses, with its place', () => {
    const bytes = writePluginFile({ manifest: { ...MANIFEST, version: 'one' }, code: CODE });
    expect(() => readPluginFile(bytes)).toThrow(PluginManifestError);
    expect(() => readPluginFile(bytes)).toThrow(
      'plugin.json › version: must be a version like 1.0.0',
    );
  });

  it('refuses what is too large, packed or unpacked, and what is not a zip', () => {
    expect(() => readPluginFile(new Uint8Array(1024 * 1024 + 1))).toThrow(
      'This plugin file is larger than 1 MB.',
    );
    // Zeros deflate to almost nothing: 5 MB of them is a few kB packed.
    const bomb = zipSync({
      'plugin.json': strToU8(JSON.stringify(MANIFEST)),
      'main.ts': strToU8(CODE),
      'padding.bin': new Uint8Array(5 * 1024 * 1024),
    });
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    expect(() => readPluginFile(bomb)).toThrow('This plugin file holds more than 4 MB unpacked.');
    const long = writePluginFile({ manifest: MANIFEST, code: 'x'.repeat(200_001) });
    expect(() => readPluginFile(long)).toThrow('main.ts is longer than 200,000 characters.');
    expect(() => readPluginFile(strToU8('not a zip'))).toThrow(
      "This isn't a plugin file: it isn't a zip archive.",
    );
  });

  it('counts what really inflates, whatever the headers claim', () => {
    const honest = zipSync(
      {
        'plugin.json': strToU8(JSON.stringify(MANIFEST)),
        'main.ts': strToU8(CODE),
        'padding.bin': new Uint8Array(64 * 1024 * 1024),
      },
      { level: 9 },
    );
    const lying = honest.slice();
    const view = new DataView(lying.buffer);
    // Overwrite the uncompressed-size fields of padding.bin: local header +22, central +24.
    let patched = 0;
    for (let at = 0; at + 30 < lying.length; at += 1) {
      const local = view.getUint32(at, true) === 0x04034b50;
      const central = view.getUint32(at, true) === 0x02014b50;
      if (!local && !central) continue;
      const nameAt = at + (local ? 30 : 46);
      const nameLength = view.getUint16(at + (local ? 26 : 28), true);
      const name = new TextDecoder().decode(lying.subarray(nameAt, nameAt + nameLength));
      if (name !== 'padding.bin') continue;
      view.setUint32(at + (local ? 22 : 24), 100, true);
      patched += 1;
    }
    expect(patched).toBe(2);
    expect(lying.byteLength).toBeLessThan(1024 * 1024);
    const start = performance.now();
    expect(() => readPluginFile(lying)).toThrow('This plugin file holds more than 4 MB unpacked.');
    const ms = performance.now() - start;
    console.log(`lying zip refused in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(200);
  });

  it('refuses more than 64 entries and names with control characters', () => {
    const many: Record<string, Uint8Array> = {
      'plugin.json': strToU8(JSON.stringify(MANIFEST)),
      'main.ts': strToU8(CODE),
    };
    for (let i = 0; i < 63; i += 1) many[`f${i}.txt`] = strToU8('x');
    expect(() => readPluginFile(zipSync(many))).toThrow('more than 64 entries');
    const nul = zipSync({
      'plugin.json': strToU8(JSON.stringify(MANIFEST)),
      'main.ts': strToU8(CODE),
      'a\u0000b': strToU8('x'),
    });
    expect(() => readPluginFile(nul)).toThrow('has an entry outside its folder');
  });

  it('caps README.md and LICENSE at 256 kB', () => {
    for (const key of ['readme', 'license'] as const) {
      const big = writePluginFile({
        manifest: MANIFEST,
        code: CODE,
        [key]: 'x'.repeat(256 * 1024 + 1),
      });
      expect(() => readPluginFile(big)).toThrow(/is larger than 256 kB/);
    }
    const fine = writePluginFile({
      manifest: MANIFEST,
      code: CODE,
      readme: 'x'.repeat(256 * 1024),
    });
    expect(readPluginFile(fine).readme?.length).toBe(256 * 1024);
  });
});
