import type { RenderJob } from '@extrudo/web/platform/render';
import { describe, expect, it } from 'vitest';
import type { BlenderEnv, RenderProcess } from './blender';
import { blenderOverride, createBlenderService, isRenderJob } from './blenderService';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

interface Spawned {
  process: RenderProcess & { exit(code: number | null): void; killed: boolean };
}

function env(over: Partial<BlenderEnv> = {}, spawned: Spawned[] = []): BlenderEnv {
  return {
    platform: 'linux',
    env: {},
    homeDir: '/home/me',
    exists: () => false,
    glob: () => [],
    which: (name) => (name === 'blender' ? '/usr/bin/blender' : undefined),
    flatpakInfo: () => false,
    run: () => ({ code: 0, output: 'Blender 5.2.2 LTS\n' }),
    spawn() {
      const listeners: ((code: number | null) => void)[] = [];
      const process = {
        onStdout: () => {},
        onStderr: () => {},
        on(event: string, listener: (value: never) => void) {
          if (event === 'exit') listeners.push(listener as (code: number | null) => void);
          return undefined;
        },
        kill() {
          this.killed = true;
        },
        killed: false,
        exit: (code: number | null) => {
          for (const l of listeners) l(code);
        },
      };
      spawned.push({ process });
      return process;
    },
    tempDir: '/tmp',
    override: undefined,
    prepareDir: () => {},
    writeFile: () => {},
    readFile: () => PNG,
    removeDir: () => {},
    ...over,
  };
}

const JOB: RenderJob = {
  project: 'Bracket',
  obj: 'o Body1\n',
  mtl: 'newmtl m0\n',
  objects: [{ name: 'Body1', finish: 'matte', color: '#3b82f6' }],
  preset: 'studio',
  width: 1920,
  height: 1080,
  quality: 'standard',
};

describe('isRenderJob', () => {
  it('accepts a whole job, with or without a camera', () => {
    expect(isRenderJob(JOB)).toBe(true);
    expect(isRenderJob({ ...JOB, objects: [] })).toBe(true);
    expect(
      isRenderJob({
        ...JOB,
        camera: {
          projection: 'orthographic',
          position: [0, -200, 0],
          target: [0, 0, 0],
          up: [0, 0, 1],
          size: 100,
        },
      }),
    ).toBe(true);
  });

  it('refuses a malformed one', () => {
    expect(isRenderJob(undefined)).toBe(false);
    expect(isRenderJob('x')).toBe(false);
    expect(isRenderJob({ ...JOB, preset: 'kitchen' })).toBe(false);
    expect(isRenderJob({ ...JOB, quality: 'ultra' })).toBe(false);
    expect(isRenderJob({ ...JOB, width: 100 })).toBe(false);
    expect(isRenderJob({ ...JOB, height: 1080.5 })).toBe(false);
    expect(isRenderJob({ ...JOB, project: 'x'.repeat(201) })).toBe(false);
    expect(isRenderJob({ ...JOB, objects: [{ name: 'A', finish: 'chrome' }] })).toBe(false);
    expect(isRenderJob({ ...JOB, objects: [{ name: 'A', finish: 'matte', color: 'blue' }] })).toBe(
      false,
    );
    expect(isRenderJob({ ...JOB, camera: { projection: 'perspective' } })).toBe(false);
    expect(isRenderJob({ ...JOB, obj: 5 })).toBe(false);
  });
});

describe('blenderOverride', () => {
  it('takes a non-empty string only', () => {
    expect(blenderOverride('/opt/blender')).toBe('/opt/blender');
    expect(blenderOverride('  ')).toBeUndefined();
    expect(blenderOverride(5)).toBeUndefined();
    expect(blenderOverride(undefined)).toBeUndefined();
  });
});

describe('the render channels (P6-15)', () => {
  it('reports the status and refuses a malformed job', async () => {
    const service = createBlenderService(
      () => env(),
      () => {},
    );
    expect(service.status()).toEqual({ state: 'found', version: '5.2', path: '/usr/bin/blender' });
    await expect(service.render({ ...JOB, preset: 'x' })).rejects.toThrow('malformed');
    expect(
      createBlenderService(
        () => env({ which: () => undefined }),
        () => {},
      ).status(),
    ).toEqual({
      state: 'missing',
    });
  });

  it('renders one job at a time and cancels the running one', async () => {
    const spawned: Spawned[] = [];
    const service = createBlenderService(
      () => env({}, spawned),
      () => {},
    );
    const first = service.render(JOB);
    await Promise.resolve();
    expect(spawned).toHaveLength(1);
    expect(await service.render(JOB)).toEqual({
      ok: false,
      message: 'A render is already running.',
    });
    service.cancel();
    expect(spawned[0]?.process.killed).toBe(true);
    spawned[0]?.process.exit(null);
    expect(await first).toEqual({ ok: false, cancelled: true, message: 'Render cancelled.' });
    // The slot is free again.
    const second = service.render(JOB);
    await Promise.resolve();
    spawned[1]?.process.exit(0);
    expect(await second).toEqual({ ok: true, png: PNG });
  });

  it('answers without Blender, or with an old one', async () => {
    const missing = createBlenderService(
      () => env({ which: () => undefined }),
      () => {},
    );
    expect(await missing.render(JOB)).toEqual({ ok: false, message: "Blender wasn't found." });
    const old = createBlenderService(
      () => env({ run: () => ({ code: 0, output: 'Blender 3.6.0\n' }) }),
      () => {},
    );
    expect(await old.render(JOB)).toMatchObject({
      ok: false,
      message: expect.stringContaining('too old'),
    });
  });

  it('cleanup cancels and removes the render directory', async () => {
    const spawned: Spawned[] = [];
    const removed: string[] = [];
    const service = createBlenderService(
      () =>
        env(
          { glob: () => ['extrudo-render-0a1b2c3d'], removeDir: (dir) => void removed.push(dir) },
          spawned,
        ),
      () => {},
    );
    const running = service.render(JOB);
    await Promise.resolve();
    service.cleanup();
    expect(spawned[0]?.process.killed).toBe(true);
    spawned[0]?.process.exit(null);
    await running;
    expect(removed).toContain('/tmp/extrudo-render-0a1b2c3d');
  });
});
