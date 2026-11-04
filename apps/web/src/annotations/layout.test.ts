import { describe, expect, it } from 'vitest';
import { boxOffset, calloutBox, leaderEnd } from './layout';

const view = { width: 800, height: 600 };
const size = { width: 120, height: 40 };

describe('calloutBox', () => {
  it('puts a default callout above and to the right', () => {
    expect(calloutBox([100, 300], size, undefined, view)).toEqual({
      left: 128,
      top: 232,
      width: 120,
      height: 40,
    });
  });

  it('mirrors a default callout to the left or below when it would leave the view', () => {
    expect(calloutBox([750, 300], size, undefined, view).left).toBe(750 - 28 - 120);
    expect(calloutBox([100, 20], size, undefined, view).top).toBe(48);
  });

  it('keeps a stored offset where it is, and boxOffset gives it back', () => {
    const box = calloutBox([750, 20], size, [10, -5], view);
    expect(box).toEqual({ left: 760, top: -25, width: 120, height: 40 });
    expect(boxOffset([750, 20], box)).toEqual([10, -5]);
  });
});

describe('leaderEnd', () => {
  const box = { left: 128, top: 232, width: 120, height: 40 };
  it('meets the nearest corner or side', () => {
    expect(leaderEnd([100, 300], box)).toEqual([128, 272]);
    expect(leaderEnd([180, 300], box)).toEqual([180, 272]);
    expect(leaderEnd([130, 260], box)).toEqual([128, 260]);
  });
});
