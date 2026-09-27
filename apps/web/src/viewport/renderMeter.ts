/**
 * Render statistics for the status bar: how many frames the viewport drew in
 * the last second, and how long drawing them took. The canvas renders on
 * demand (only when something changes), so an unchanging view draws nothing
 * and reads as idle; the frame time is what grows with a heavier scene.
 */

export interface RenderStats {
  /** Frames drawn in the last second; 0 while the view is idle. */
  fps: number;
  /** Mean time (ms) of `renderer.render` over those frames, or the last frame's when idle. */
  frameMs: number;
}

const WINDOW = 1000;

export interface RenderMeter {
  /** Records a frame drawn at `at` (ms) that took `ms` to render. */
  frame(at: number, ms: number): void;
  /** The stats at `now`, or `undefined` before the first frame. */
  sample(now: number): RenderStats | undefined;
}

export function createRenderMeter(): RenderMeter {
  const frames: { at: number; ms: number }[] = [];
  let last: number | undefined;
  return {
    frame(at, ms) {
      frames.push({ at, ms });
      last = ms;
    },
    sample(now) {
      while (frames.length > 0 && (frames[0]?.at ?? 0) <= now - WINDOW) frames.shift();
      if (last === undefined) return undefined;
      if (frames.length === 0) return { fps: 0, frameMs: last };
      const total = frames.reduce((sum, f) => sum + f.ms, 0);
      return { fps: frames.length, frameMs: total / frames.length };
    },
  };
}

/** "58 fps · 1.4 ms", or "idle · 1.4 ms" while nothing is drawn. */
export function formatRenderStats(stats: RenderStats | undefined): string {
  if (!stats) return 'render —';
  const ms = `${stats.frameMs < 10 ? stats.frameMs.toFixed(1) : Math.round(stats.frameMs)} ms`;
  return `${stats.fps === 0 ? 'idle' : `${stats.fps} fps`} · ${ms}`;
}
