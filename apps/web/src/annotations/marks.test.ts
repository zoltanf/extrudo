import { describe, expect, it } from 'vitest';
import type { View } from '../viewport/camera';
import { drawMarks, markPositions } from './marks';

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

describe('drawMarks', () => {
  it('draws one badge and its number per mark, at the badge position, with its leader', () => {
    const calls: { name: string; args: unknown[]; fill?: unknown }[] = [];
    const ctx = new Proxy(
      { fillStyle: '' as unknown },
      {
        get(target, name) {
          if (name in target) return target[name as 'fillStyle'];
          return (...args: unknown[]) =>
            calls.push({ name: String(name), args, fill: target.fillStyle });
        },
        set(target, name, value) {
          (target as Record<string, unknown>)[name as string] = value;
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    drawMarks(
      ctx,
      [
        { at: [0, 0, 0], number: 1, look: 'solid' },
        { at: [-20, -20, 0], number: 7, look: 'hollow' },
      ],
      view,
      'orthographic',
      500,
    );
    const texts = calls.filter((c) => c.name === 'fillText');
    expect(texts.map((c) => c.args[0])).toEqual(['1', '7']);
    expect(texts[0]?.args.slice(1)).toEqual([278, 222.5]);
    // Each mark: the anchor dot and the badge (two arcs), and one leader line to the badge.
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(4);
    expect(calls.filter((c) => c.name === 'lineTo').map((c) => c.args)).toEqual([
      [278, 222],
      [178, 322],
    ]);
  });
});
