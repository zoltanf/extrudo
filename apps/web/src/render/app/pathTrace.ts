/**
 * The picture's path tracer (ADR-0101 §6.2): the progressive loop around
 * three-gpu-pathtracer's `renderSample()`. Standard and High trace the same
 * scene Draft rasterises; the loop renders one tile per animation frame, so
 * the main thread stays responsive, reports `samples / target` as progress and
 * stops the moment Cancel is pressed. A GPU fence after each tile holds the
 * next one back until the GPU has finished it: `renderSample()` only queues
 * commands, so timing the call measures nothing, and queued tiles pile up into
 * GPU work long enough to stall the desktop's compositor (a frozen cursor) or
 * to make the driver reset the context. The library is the authority on how
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
 * The denoise pass's settings: a blur of radius `kSigma · sigma` pixels that leaves out
 * neighbours whose colour differs by more than about `threshold` (0..1, on display values).
 * The library's default threshold (0.03) is below Standard's grain on a lit face (neighbours
 * differ by ~0.1), so it kept the grain; 0.12 removes it and still keeps holes, edges and the
 * wood's stripes; 0.18 starts to blur the stripes.
 */
export const DENOISE = { sigma: 5, kSigma: 1, threshold: 0.12 };

/** How deep a path goes. */
export const BOUNCES = 5;

/** One tile's GPU time should stay under this; tiles are raised until it does. */
export const FRAME_BUDGET_MS = 40;

/** The most tiles per axis: integrated graphics need many; each tile is one draw. */
const MAX_TILES = 16;

/** 2×2 up to 1920×1080, 3×3 up to 4K, 4×4 above (pure). */
export function chooseTiles(width: number, height: number): [number, number] {
  const side = Math.max(width, height);
  if (side <= 1920) return [2, 2];
  if (side <= 3840) return [3, 3];
  return [4, 4];
}

/**
 * The next tiling when a tile took `ms`: above the budget, each axis grows by
 * √(ms / budget) (so the area shrinks in proportion), at least by one, at most 16×16 (pure).
 */
export function adaptTiles(tiles: [number, number], ms: number): [number, number] {
  if (ms <= FRAME_BUDGET_MS) return tiles;
  const factor = Math.sqrt(ms / FRAME_BUDGET_MS);
  const grow = (n: number) => Math.min(MAX_TILES, Math.max(n + 1, Math.ceil(n * factor)));
  return [grow(tiles[0]), grow(tiles[1])];
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

/** A GPU fence: `place()` after a tile's commands, `passed()` once the GPU has run them. */
export interface GpuFence {
  place(): void;
  passed(): boolean;
  dispose(): void;
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
  /**
   * The renderer's fence; without one (tests) a tile's time is the call's own,
   * which on a real GPU is only the time to queue it.
   */
  fence?: GpuFence;
}

/** The most tiles sent in one frame; the batch doubles while the GPU keeps up. */
const MAX_BATCH = 64;

/**
 * Runs the tracer until `samples >= target` (resolves true) or cancelled
 * (false). With a fence, each frame sends a batch of tiles and places one
 * fence after it; the next batch waits until the fence passes. A batch the
 * GPU finished by the next frame doubles (a fast GPU is never held to one
 * tile a frame); one over the budget halves, and at one tile the tiles shrink
 * instead (`adaptTiles`), so a slow GPU never gets more than ~40 ms at once.
 */
export function tracePicture(tracer: TracerLike, options: TraceOptions): Promise<boolean> {
  const frame = options.frame ?? ((callback) => requestAnimationFrame(callback));
  const now = options.now ?? (() => performance.now());
  const fence = options.fence;
  let tiles = chooseTiles(options.width, options.height);
  tracer.tiles.set(tiles[0], tiles[1]);
  /** Tiles per frame. */
  let batch = 1;
  /** When the fence after the last batch was placed; undefined when none is pending. */
  let placed: number | undefined;
  /** Frames polled since then. */
  let polls = 0;
  const grow = (ms: number) => {
    if (ms <= FRAME_BUDGET_MS) return;
    tiles = adaptTiles(tiles, ms);
    tracer.tiles.set(tiles[0], tiles[1]);
  };
  return new Promise<boolean>((resolve) => {
    const finish = (value: boolean) => {
      fence?.dispose();
      resolve(value);
    };
    const step = () => {
      if (options.cancelled()) {
        finish(false);
        return;
      }
      if (placed !== undefined) {
        polls += 1;
        if (!fence?.passed()) {
          frame(step);
          return;
        }
        const ms = now() - placed;
        if (ms > FRAME_BUDGET_MS) {
          if (batch > 1) batch = Math.max(1, Math.floor(batch / 2));
          else grow(ms);
        } else if (polls === 1) {
          batch = Math.min(MAX_BATCH, batch * 2);
        }
        placed = undefined;
      }
      if (tracer.samples >= options.target) {
        options.onProgress(traceFraction(tracer.samples, options.target));
        finish(true);
        return;
      }
      if (!tracer.isCompiling) {
        const start = now();
        for (let i = 0; i < batch && tracer.samples < options.target; i++) tracer.renderSample();
        if (fence) {
          fence.place();
          placed = start;
          polls = 0;
        } else {
          grow(now() - start);
        }
      }
      options.onProgress(traceFraction(tracer.samples, options.target));
      frame(step);
    };
    frame(step);
  });
}
