import { describe, expect, it } from 'vitest';
import type { CadmpegEnv } from './cadmpeg';
import { cadmpegOverride, createCadmpegService, isCadFile } from './cadmpegService';

function env(over: Partial<CadmpegEnv> = {}): CadmpegEnv {
  return {
    platform: 'linux',
    exists: () => false,
    which: () => undefined,
    run: () => ({ code: 0, output: 'cadmpeg 0.6.7\n' }),
    spawn: () => {
      throw new Error('not in these tests');
    },
    tempDir: '/tmp',
    resourcesPath: undefined,
    devVendorDir: undefined,
    override: undefined,
    prepareDir: () => {},
    writeFile: () => {},
    readFile: () => undefined,
    fileSize: () => undefined,
    removeDir: () => {},
    ...over,
  };
}

describe('the cadmpeg service (P6-19)', () => {
  it('checks the file that crossed the bridge', async () => {
    const service = createCadmpegService(() => env());
    for (const bad of [
      undefined,
      null,
      'a.sldprt',
      { name: 'a.sldprt' },
      { name: 'a.sldprt', bytes: [1, 2] },
      { name: 1, bytes: new Uint8Array() },
    ]) {
      expect(isCadFile(bad)).toBe(false);
      await expect(service.convert(bad)).rejects.toThrow('malformed');
    }
    expect(isCadFile({ name: 'a.sldprt', bytes: new Uint8Array() })).toBe(true);
  });

  it('checks the extension itself, and says when there is no converter', async () => {
    const service = createCadmpegService(() => env());
    expect((await service.convert({ name: 'a.exe', bytes: new Uint8Array() })).ok).toBe(false);
    const result = await service.convert({ name: 'a.ipt', bytes: new Uint8Array() });
    expect(result.ok === false && result.message).toContain("isn't available");
    expect(service.status().found).toBe(false);
  });

  it('reads a fresh environment per call', () => {
    let present: string[] = [];
    const service = createCadmpegService(() =>
      env({ override: '/opt/cadmpeg', exists: (p) => present.includes(p) }),
    );
    expect(service.status().found).toBe(false);
    present = ['/opt/cadmpeg'];
    expect(service.status()).toEqual({ found: true, path: '/opt/cadmpeg', version: '0.6.7' });
  });

  it('takes the preference only as a non-empty string', () => {
    expect(cadmpegOverride('/opt/cadmpeg')).toBe('/opt/cadmpeg');
    expect(cadmpegOverride('')).toBeUndefined();
    expect(cadmpegOverride('  ')).toBeUndefined();
    expect(cadmpegOverride(42)).toBeUndefined();
    expect(cadmpegOverride(['/opt/cadmpeg'])).toBeUndefined();
    expect(cadmpegOverride(undefined)).toBeUndefined();
  });
});
