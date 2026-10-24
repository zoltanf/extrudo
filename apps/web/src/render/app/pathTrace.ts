/**
 * The picture's path tracer (ADR-0101 §6.2): the progressive loop around
 * three-gpu-pathtracer's `renderSample()`. Standard and High trace the same
 * scene Draft rasterises; the loop renders one tile per animation frame, so
 * the main thread stays responsive, reports `samples / target` as progress and
 * stops the moment Cancel is pressed. The library is the authority on how
 * samples grow: one `renderSample()` adds `1 / (tiles.x · tiles.y)`, and
 * changing `tiles` does not reset what is accumulated.
 */
import type { RenderQuality } from '@extrudo/core';

/** How many samples Standard and High gather (the Blender script's numbers). */
export const SAMPLES: Record<Exclude<RenderQuality, 'draft'>, number> = {
  standard: 128,
  high: 512,
};

/**
 * The denoise pass's settings (DenoiseMaterial's own defaults): a blur of radius `kSigma · sigma`
 * pixels that leaves out neighbours whose colour differs by more than `threshold` (0..1, on
 * display values).
 */
export const DENOISE = { sigma: 5, kSigma: 1, threshold: 0.03 };

/** How deep a path goes. */
export const BOUNCES = 5;

/** One frame's work should stay under this; tiles are raised until it does. */
export const FRAME_BUDGET_MS = 50;

/** The most tiles per axis: more splits a frame thinner but the BVH overhead grows. */
const MAX_TILES = 8;

/** 2×2 up to 1920×1080, 3×3 up to 4K, 4×4 above (pure). */
export function chooseTiles(width: number, height: number): [number, number] {
  const side = Math.max(width, height);
  if (side <= 1920) return [2, 2];
  if (side <= 3840) return [3, 3];
  return [4, 4];
}

/** The next tiling when a tile took `ms`: one more per axis above the budget, at most 8×8 (pure). */
export function adaptTiles(tiles: [number, number], ms: number): [number, number] {
  if (ms <= FRAME_BUDGET_MS) return tiles;
  return [Math.min(tiles[0] + 1, MAX_TILES), Math.min(tiles[1] + 1, MAX_TILES)];
}

/** 0.1 … 0.95 as `samples / target` (pure; the phases around it are the renderer's). */
export function traceFraction(samples: number, target: number): number {
  const done = target > 0 ? Math.min(1, Math.max(0, samples / target)) : 1;
  return 0.1 + 0.85 * done;
}

/** What the loop needs of the tracer: a seam for tests. */
export interface TracerLike {
  samples: number;
  tiles: { set(x: number, y: number): void };
  renderSample(): void;
  readonly isCompiling: boolean;
}

export interface TraceOptions {
  target: number;
  width: number;
  height: number;
  onProgress(fraction: number): void;
  cancelled(): boolean;
  /** requestAnimationFrame by default; tests inject one that runs at once. */
  frame?(callback: () => void): void;
  now?(): number;
}

/** Runs renderSample per frame until `samples >= target` (resolves true) or cancelled (false). */
export function tracePicture(tracer: TracerLike, options: TraceOptions): Promise<boolean> {
  const frame = options.frame ?? ((callback) => requestAnimationFrame(callback));
  const now = options.now ?? (() => performance.now());
  let tiles = chooseTiles(options.width, options.height);
  tracer.tiles.set(tiles[0], tiles[1]);
  return new Promise<boolean>((resolve) => {
    const step = () => {
      if (options.cancelled()) {
        resolve(false);
        return;
      }
      if (tracer.samples >= options.target) {
        options.onProgress(traceFraction(tracer.samples, options.target));
        resolve(true);
        return;
      }
      if (!tracer.isCompiling) {
        const start = now();
        tracer.renderSample();
        const ms = now() - start;
        if (ms > FRAME_BUDGET_MS) {
          tiles = adaptTiles(tiles, ms);
          tracer.tiles.set(tiles[0], tiles[1]);
        }
      }
      options.onProgress(traceFraction(tracer.samples, options.target));
      frame(step);
    };
    frame(step);
  });
}
