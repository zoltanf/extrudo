import { describe, expect, it } from 'vitest';
import type { View } from '../viewport/camera';
import { markPositions } from './marks';

// Looking straight down at the origin, 100 mm tall: 1 mm is size / 100 px.
const view: View = { target: [0, 0, 0], orientation: [0, 0, 0, 1], size: 100 };

describe('markPositions', () => {
  it("puts a badge at the anchor plus the callout's default offset, through the picture's camera", () => {
    const [placed] = markPositions(
      [{ at: [0, 0, 0], number: 1, look: 'solid' }],
      view,
      'orthographic',
      500,
    );
    expect(placed?.anchor[0]).toBeCloseTo(250, 6);
    expect(placed?.anchor[1]).toBeCloseTo(250, 6);
    expect(placed?.badge).toEqual([278, 222]);
  });

  it('mirrors a badge that would leave the picture', () => {
    const [placed] = markPositions(
      [{ at: [49, 49, 0], number: 2, look: 'muted' }],
      view,
      'orthographic',
      500,
    );
    expect(placed?.badge[0]).toBeLessThan(placed?.anchor[0] ?? 0);
    expect(placed?.badge[1]).toBeGreaterThan(placed?.anchor[1] ?? 0);
  });
});
