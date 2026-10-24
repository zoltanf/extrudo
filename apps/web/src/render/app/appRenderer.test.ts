/** The app's picture renderer (ADR-0101 §6): its refusals, without WebGL (a fake renderer and drawing). */
import { describe, expect, it, vi } from 'vitest';
import type { AppRenderJob } from '../../platform/render';
import { createAppRenderer } from './appRenderer';

const job: AppRenderJob = {
  project: 'Box',
  bodies: [],
  preset: 'studio',
  width: 1920,
  height: 1080,
  quality: 'draft',
};
const fakeRenderer = (maxTextureSize = 4096) => ({
  capabilities: { maxTextureSize },
  dispose: vi.fn(),
});

describe('createAppRenderer', () => {
  it('refuses a size above the GPU limit, naming it', async () => {
    const draw = vi.fn();
    const renderer = createAppRenderer({ makeRenderer: () => fakeRenderer(1024), draw });
    const result = await renderer.render(job, () => {});
    expect(result).toEqual({
      ok: false,
      message: "This size is too large for this computer's graphics: up to 1024 × 1024.",
    });
    expect(draw).not.toHaveBeenCalled();
  });

  it('refuses a second render while one runs, and cancels', async () => {
    let finish: (png: Uint8Array) => void = () => {};
    const made = vi.fn(() => fakeRenderer());
    const renderer = createAppRenderer({
      makeRenderer: made,
      draw: () => new Promise((resolve) => (finish = resolve)),
    });
    const progress = vi.fn();
    const first = renderer.render(job, progress);
    expect(await renderer.render(job, () => {})).toEqual({
      ok: false,
      message: 'A render is already running.',
    });
    finish(Uint8Array.from([1, 2, 3]));
    expect(await first).toEqual({ ok: true, png: Uint8Array.from([1, 2, 3]) });
    expect(progress).toHaveBeenCalledWith({ phase: 'starting', fraction: 0 });

    const second = renderer.render(job, () => {});
    renderer.cancel();
    finish(Uint8Array.from([4]));
    expect(await second).toMatchObject({ ok: false, cancelled: true });
    // One WebGL renderer for every render, freed by dispose.
    expect(made).toHaveBeenCalledTimes(1);
    const gl = made.mock.results[0]?.value;
    renderer.dispose();
    expect(gl.dispose).toHaveBeenCalled();
  });

  it('turns a failure into a message', async () => {
    const renderer = createAppRenderer({
      makeRenderer: () => fakeRenderer(),
      draw: async () => {
        throw new Error('context lost');
      },
    });
    expect(await renderer.render(job, () => {})).toEqual({ ok: false, message: 'context lost' });
  });

  it('hands a Standard job to the drawing seam like Draft', async () => {
    const draw = vi.fn(async () => Uint8Array.from([1, 2, 3]));
    const renderer = createAppRenderer({ makeRenderer: () => fakeRenderer(), draw });
    const standard = { ...job, quality: 'standard' as const };
    expect(await renderer.render(standard, () => {})).toEqual({
      ok: true,
      png: Uint8Array.from([1, 2, 3]),
    });
    expect(draw).toHaveBeenCalledWith(
      expect.anything(),
      standard,
      expect.any(Function),
      expect.any(Function),
    );
  });
});
