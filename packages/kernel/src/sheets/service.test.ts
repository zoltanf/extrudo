// KernelService.sheetViews (P6-24 S2, ADR-0143's S2 amendment): views one
// at a time with each result reported, stopped between views by `onView`
// and by `cancelSheetViews`, a recompute let in between two views, and
// nothing held once it ends.
import {
  type ExtrudoDocument,
  primitiveInputs,
  type SheetViewFrame,
  sheetBaseFrame,
  sheetStandardFrom,
  toSheetView,
} from '@extrudo/core';
import { afterAll, describe, expect, it } from 'vitest';
import { loadOcct } from '../occt/load';
import { testDocument, testFeature } from '../recompute/testing';
import { KernelService } from '../service';
import { isSheetViewsCancelled, type SheetViewRequest, type SheetViewResult } from './views';

const service = new KernelService(() => loadOcct(), { engine: { strictLeaks: true } });
const box = (length: string): ExtrudoDocument =>
  testDocument([
    {
      ...testFeature('Box1', 'box'),
      inputs: primitiveInputs('box', { numbers: { length, width: '20 mm', height: '30 mm' } }),
    },
  ]);
const frame = (name: 'front' | 'top' | 'right'): SheetViewFrame => {
  const { direction, up } = sheetStandardFrom(name);
  return sheetBaseFrame(direction, up);
};
const requests: SheetViewRequest[] = (['front', 'top', 'right'] as const).map((name) => ({
  id: name,
  ...frame(name),
}));
const width = (r: SheetViewResult | undefined) => {
  if (!r || 'error' in r) throw new Error('no geometry');
  const b = r.geometry.bounds;
  return b ? b.max[0] - b.min[0] : 0;
};

afterAll(async () => {
  expect(await service.dispose()).toEqual({ liveShapes: 0 });
});

describe('KernelService.sheetViews', () => {
  it('computes the views in order and reports each as it is done', async () => {
    await service.recompute({ doc: box('10 mm') });
    const before = (await service.stats()).liveShapes;
    const heard: [string, number, number][] = [];
    const results = await service.sheetViews(requests, (result, done, total) => {
      heard.push([result.id, done, total]);
      return undefined;
    });
    expect(results.map((r) => r.id)).toEqual(['front', 'top', 'right']);
    expect(heard).toEqual([
      ['front', 1, 3],
      ['top', 2, 3],
      ['right', 3, 3],
    ]);
    expect(width(results[0])).toBeCloseTo(10, 9);
    expect(width(results[2])).toBeCloseTo(20, 9);
    expect((await service.stats()).liveShapes).toBe(before);
    // The front view's x is the world's x.
    expect(toSheetView(frame('front'), [5, 0, 0])).toEqual([5, 0]);
  });

  it('stops before the next view when onView says false', async () => {
    await service.recompute({ doc: box('10 mm') });
    const heard: string[] = [];
    const run = service.sheetViews(requests, (result) => {
      heard.push(result.id);
      return false;
    });
    await expect(run).rejects.toSatisfy(isSheetViewsCancelled);
    expect(heard).toEqual(['front']);
  });

  it('stops every running run at cancelSheetViews, and the next run is not affected', async () => {
    await service.recompute({ doc: box('10 mm') });
    const heard: string[] = [];
    const run = service.sheetViews(requests, async (result) => {
      heard.push(result.id);
      await service.cancelSheetViews();
      return undefined;
    });
    await expect(run).rejects.toSatisfy(isSheetViewsCancelled);
    expect(heard).toEqual(['front']);
    expect(await service.sheetViews(requests.slice(0, 1))).toHaveLength(1);
  });

  it('lets a recompute in between two views: the later view draws the new body', async () => {
    await service.recompute({ doc: box('10 mm') });
    let recomputed: Promise<unknown> | undefined;
    const results = await service.sheetViews(
      [
        { id: 'a', ...frame('front') },
        { id: 'b', ...frame('top') },
      ],
      (result) => {
        // Sent while the run is going; the worker takes it between views.
        if (result.id === 'a') recomputed = service.recompute({ doc: box('14 mm') });
        return undefined;
      },
    );
    await recomputed;
    expect(width(results[0])).toBeCloseTo(10, 9);
    const [again] = await service.sheetViews([{ id: 'c', ...frame('top') }]);
    expect(width(again)).toBeCloseTo(14, 9);
    // The version each result was drawn from tells a stale one.
    const versions = (r: SheetViewResult | undefined) =>
      r && 'versions' in r ? Object.values(r.versions) : [];
    expect(versions(again)).not.toEqual(versions(results[0]));
  });
});
