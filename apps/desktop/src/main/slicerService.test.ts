import { describe, expect, it, vi } from 'vitest';
import { createSlicerService, slicerOverrides } from './slicerService';
import type { SlicerEnv } from './slicers';

const env = (over: Partial<SlicerEnv> = {}): SlicerEnv => ({
  platform: 'linux',
  env: {},
  exists: () => false,
  glob: () => [],
  which: (name) => (name === 'prusa-slicer' ? '/usr/bin/prusa-slicer' : undefined),
  flatpakInfo: () => false,
  spawn: () => {
    throw new Error('no spawn');
  },
  tempDir: '/tmp',
  overrides: {},
  prepareDir: () => {},
  writeFile: () => {},
  removeDir: () => {},
  ...over,
});

describe('the slicer channels (P6-02)', () => {
  it('lists the installed slicers as id and path only', () => {
    expect(createSlicerService(() => env()).list()).toEqual([
      { id: 'prusaslicer', path: '/usr/bin/prusa-slicer' },
    ]);
  });

  it('refuses a malformed request', async () => {
    const service = createSlicerService(() => env());
    const file = { name: 'a.3mf', bytes: new Uint8Array(1), format: '3mf' };
    await expect(service.open({ ...file, format: 'exe' }, 'prusaslicer')).rejects.toThrow(
      'malformed',
    );
    await expect(service.open(file, 'slic3r')).rejects.toThrow('malformed');
    await expect(service.open('x', 'cura')).rejects.toThrow('malformed');
  });

  it('answers false for a slicer that is not installed or can not start', async () => {
    const service = createSlicerService(() => env());
    const file = { name: 'a.3mf', bytes: new Uint8Array(1), format: '3mf' };
    expect(await service.open(file, 'cura')).toBe(false);
    expect(await service.open(file, 'prusaslicer')).toBe(false);
  });

  it('cleans up through the environment', () => {
    const removeDir = vi.fn();
    createSlicerService(() => env({ removeDir })).cleanup();
    expect(removeDir).toHaveBeenCalledWith('/tmp/extrudo-slicer');
  });

  it('reads only string overrides under a slicer id', () => {
    expect(slicerOverrides({ cura: '/c', prusaslicer: 3, other: '/x', orcaslicer: '' })).toEqual({
      cura: '/c',
    });
    expect(slicerOverrides(null)).toEqual({});
    expect(slicerOverrides(['/a'])).toEqual({});
  });
});
