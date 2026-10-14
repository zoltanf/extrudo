/**
 * The `.f3d` body check's runner (ADR-0084) with a real kernel in-process: a
 * replayed box against a STEP of the same box (editable) and of a different
 * one (frozen, the box taken out), no kernel when nothing was written, a
 * kernel that can't start and a check that runs too long. No samples: the
 * STEP comes from the kernel.
 */
import { Design } from '@extrudo/api';
import type { BodyId } from '@extrudo/core';
import type { BodyLink, BodyStep } from '@extrudo/f3d';
import type { KernelApi, KernelConnection } from '@extrudo/kernel';
import { Kernel } from '@extrudo/kernel';
import { KernelService, kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkF3dBodies } from './f3dCheck';

const noFonts = { used: () => [], bytes: async () => undefined };

/** The kernel in this process, behind the worker's connection. */
function inProcess(onTerminate?: () => void): KernelConnection {
  const service = new KernelService(() => loadOcct());
  const api = new Proxy(service, {
    get: (target, key) => {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as KernelApi;
  return { api, terminate: () => onTerminate?.(), onFatal: () => {} };
}

let kernel: Kernel;
let replay: Design;
let link: BodyLink;
let same: string;
let other: string;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  replay = Design.create({ name: 'Box' });
  replay.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
  // The replayed box as STEP: what a file body that matches it would write.
  const engine = new RecomputeEngine(kernel, kernelFeatures());
  try {
    const result = await engine.recompute({ doc: replay.toJSON() });
    if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
    const id = result.bodies[0]?.id as BodyId;
    const shape = engine.latestBody(id);
    if (!shape) throw new Error('no box');
    same = kernel.writeStep([{ shape, name: 'body' }]);
    link = { record: 1, name: 'Body1', hint: id };
  } finally {
    engine.clear();
  }
  const tall = kernel.box([10, 10, 20], [0, 0, 0]);
  try {
    other = kernel.writeStep([{ shape: tall, name: 'body' }]);
  } finally {
    kernel.release(tall);
  }
}, 60_000);

const step = (text: string): BodyStep[] => [{ record: 1, name: 'Body1', step: text }];

describe('checkF3dBodies', () => {
  it('keeps a replayed body that matches the file body editable', async () => {
    let terminated = false;
    const plan = await checkF3dBodies(replay, step(same), [link], {
      spawn: () => inProcess(() => (terminated = true)),
      fonts: noFonts,
    });
    expect(plan && !('error' in plan) && plan.outcomes.map((o) => o.outcome)).toEqual(['editable']);
    expect(terminated).toBe(true);
  }, 60_000);

  it('freezes a file body the replay made differently and takes the replayed one out', async () => {
    const plan = await checkF3dBodies(replay, step(other), [link], {
      spawn: () => inProcess(),
      fonts: noFonts,
    });
    if (!plan || 'error' in plan) throw new Error(`no plan: ${JSON.stringify(plan)}`);
    expect(plan.frozen).toEqual([{ record: 1, name: 'Body1', counterpart: link.hint }]);
    expect(plan.remove).toEqual([link.hint]);
  }, 60_000);

  it('starts no kernel when the writer wrote no body', async () => {
    let spawned = false;
    const result = await checkF3dBodies(
      replay,
      [{ record: 1, name: 'Body1', reason: 'spline surfaces' }],
      [link],
      {
        spawn: () => {
          spawned = true;
          return inProcess();
        },
      },
    );
    expect(result).toBeUndefined();
    expect(spawned).toBe(false);
  });

  it('says why when the kernel cannot start', async () => {
    const result = await checkF3dBodies(replay, step(same), [link], {
      spawn: () => {
        throw new Error('no WebAssembly');
      },
      fonts: noFonts,
    });
    expect(result).toMatchObject({ error: expect.stringMatching(/no WebAssembly/) });
  }, 30_000);

  it('gives up after the timeout and shuts the kernel down', async () => {
    let terminated = false;
    const stuck = (): KernelConnection => ({
      api: new Proxy({} as KernelApi, {
        get: () => () => new Promise(() => {}),
      }),
      terminate: () => {
        terminated = true;
      },
      onFatal: () => {},
    });
    const result = await checkF3dBodies(replay, step(same), [link], {
      spawn: stuck,
      fonts: noFonts,
      timeoutMs: 50,
    });
    expect(result).toMatchObject({ error: expect.stringMatching(/took longer/) });
    expect(terminated).toBe(true);
  });
});
