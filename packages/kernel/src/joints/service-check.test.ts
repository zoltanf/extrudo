// KernelService.checkJoint (P6-05 J3, ADR-0081 §4): the check on the last
// finished recompute's bodies, stopped by `cancelCheck` and by a recompute,
// and nothing held once it ends.
import type { BodyId } from '@extrudo/core';
import { afterAll, describe, expect, it } from 'vitest';
import { loadOcct } from '../occt/load';
import { KernelService } from '../service';
import { isCheckCancelled, type JointCheckRequest } from './check';
import { HINGE, hingeDocument } from './testing';

const service = new KernelService(() => loadOcct(), { engine: { strictLeaks: true } });
const doc = hingeDocument();
const request = (max: number): JointCheckRequest => ({
  joint: HINGE,
  moving: ['LeafPlate:0' as BodyId],
  others: ['BasePlate:0' as BodyId],
  range: { min: 0, max },
  minGap: 0.2,
});

afterAll(async () => {
  expect(await service.dispose()).toEqual({ liveShapes: 0 });
});

describe('KernelService.checkJoint', { timeout: 120_000 }, () => {
  it('checks the last recompute and reports progress', async () => {
    await service.recompute({ doc });
    const before = (await service.stats()).liveShapes;
    const progress: number[] = [];
    const check = await service.checkJoint(request(90), (done) => {
      progress.push(done);
    });
    expect(check.collisions).toEqual([]);
    expect(check.tightest?.gap).toBeCloseTo(0.3, 3);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(Math.max(...progress));
    expect((await service.stats()).liveShapes).toBe(before);
  });

  it('cancelCheck stops it', async () => {
    const running = service.checkJoint(request(180));
    await service.cancelCheck();
    const error = await running.catch((e: unknown) => e);
    expect(isCheckCancelled(error)).toBe(true);
  });

  it('a recompute stops it, and a newer check', async () => {
    const first = service.checkJoint(request(180));
    const recompute = service.recompute({ doc });
    expect(isCheckCancelled(await first.catch((e: unknown) => e))).toBe(true);
    await recompute;
    const second = service.checkJoint(request(180));
    const third = service.checkJoint(request(90));
    expect(isCheckCancelled(await second.catch((e: unknown) => e))).toBe(true);
    expect((await third).collisions).toEqual([]);
  });

  it('refuses a body that is gone', async () => {
    await expect(
      service.checkJoint({ ...request(90), others: ['Nothing:0' as BodyId] }),
    ).rejects.toThrow(/no longer in the model/);
  });
});
