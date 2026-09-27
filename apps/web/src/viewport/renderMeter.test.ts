import { describe, expect, it } from 'vitest';
import { createRenderMeter, formatRenderStats } from './renderMeter';

describe('render meter', () => {
  it('counts the frames of the last second and averages their time', () => {
    const meter = createRenderMeter();
    expect(meter.sample(0)).toBeUndefined();
    for (let i = 0; i < 60; i++) meter.frame(i * 16, i % 2 === 0 ? 1 : 3);
    expect(meter.sample(960)).toEqual({ fps: 60, frameMs: 2 });
    // Later, only the frames after 440 ms (from 448 ms, every 16 ms) are within the second.
    expect(meter.sample(1440)?.fps).toBe(32);
  });

  it('reads idle, keeping the last frame time, once nothing is drawn', () => {
    const meter = createRenderMeter();
    meter.frame(0, 4);
    meter.frame(10, 6);
    expect(meter.sample(5000)).toEqual({ fps: 0, frameMs: 6 });
  });

  it('formats the stats for the status bar', () => {
    expect(formatRenderStats(undefined)).toBe('render —');
    expect(formatRenderStats({ fps: 58, frameMs: 1.44 })).toBe('58 fps · 1.4 ms');
    expect(formatRenderStats({ fps: 0, frameMs: 23.6 })).toBe('idle · 24 ms');
  });
});
