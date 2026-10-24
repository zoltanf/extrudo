/** The path tracer's loop (ADR-0101 §6.2): the tiling, the fraction and the per-frame loop, with a fake tracer. */
import { describe, expect, it, vi } from 'vitest';
import {
  adaptTiles,
  chooseTiles,
  DENOISE,
  FRAME_BUDGET_MS,
  traceFraction,
  tracePicture,
} from './pathTrace';

describe('DENOISE', () => {
  it('keeps its settings in range: a radius of a few pixels, a threshold below an edge', () => {
    expect(DENOISE.sigma).toBeGreaterThan(0);
    expect(DENOISE.sigma * DENOISE.kSigma).toBeLessThanOrEqual(8);
    expect(DENOISE.threshold).toBeGreaterThan(0);
    expect(DENOISE.threshold).toBeLessThan(0.2);
  });
});

describe('chooseTiles', () => {
  it('splits 1080p 2×2, 4K 3×3 and above 4×4', () => {
    expect(chooseTiles(1280, 720)).toEqual([2, 2]);
    expect(chooseTiles(1920, 1080)).toEqual([2, 2]);
    expect(chooseTiles(3840, 2160)).toEqual([3, 3]);
    expect(chooseTiles(8192, 8192)).toEqual([4, 4]);
  });
});

describe('adaptTiles', () => {
  it('keeps the tiling under budget and raises both axes by one above it', () => {
    expect(adaptTiles([2, 2], FRAME_BUDGET_MS)).toEqual([2, 2]);
    expect(adaptTiles([2, 2], 80)).toEqual([3, 3]);
    expect(adaptTiles([3, 3], 500)).toEqual([4, 4]);
  });

  it('never goes past 8×8', () => {
    expect(adaptTiles([8, 8], 500)).toEqual([8, 8]);
    expect(adaptTiles([8, 8], 1)).toEqual([8, 8]);
  });
});

describe('traceFraction', () => {
  it('maps the samples onto 0.1 … 0.95', () => {
    expect(traceFraction(0, 128)).toBeCloseTo(0.1, 9);
    expect(traceFraction(128, 128)).toBeCloseTo(0.95, 9);
    expect(traceFraction(64, 128)).toBeCloseTo(0.525, 9);
    expect(traceFraction(256, 128)).toBeCloseTo(0.95, 9);
  });
});

/** A tracer that grows `samples` by one tile per `renderSample`, like the library. */
function fakeTracer(tiles: [number, number] = [2, 2]) {
  const sets: [number, number][] = [];
  let compiling = false;
  const tracer = {
    samples: 0,
    calls: 0,
    sets,
    tiles: {
      set(x: number, y: number) {
        sets.push([x, y]);
      },
    },
    renderSample() {
      tracer.calls += 1;
      tracer.samples += 1 / (tiles[0] * tiles[1]);
    },
    get isCompiling(): boolean {
      return compiling;
    },
    setCompiling(value: boolean) {
      compiling = value;
    },
  };
  return tracer;
}

const atOnce = (callback: () => void) => callback();

describe('tracePicture', () => {
  it('samples until the target, reporting a climbing fraction', async () => {
    const tracer = fakeTracer([2, 2]);
    const fractions: number[] = [];
    const done = await tracePicture(tracer, {
      target: 4,
      width: 1280,
      height: 720,
      onProgress: (f) => fractions.push(f),
      cancelled: () => false,
      frame: atOnce,
    });
    expect(done).toBe(true);
    // 4 samples at 1/4 per call.
    expect(tracer.calls).toBe(16);
    expect(tracer.samples).toBeCloseTo(4, 9);
    expect(fractions.length).toBeGreaterThan(0);
    expect(fractions[0] as number).toBeGreaterThan(0.1);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i] as number).toBeGreaterThanOrEqual(fractions[i - 1] as number);
    }
    expect(fractions.at(-1)).toBeCloseTo(0.95, 9);
    expect(tracer.sets[0]).toEqual([2, 2]);
  });

  it('raises the tiles when a sample goes over the budget', async () => {
    const tracer = fakeTracer([2, 2]);
    let clock = 0;
    const done = await tracePicture(tracer, {
      target: 1,
      width: 1280,
      height: 720,
      onProgress: () => {},
      cancelled: () => false,
      frame: atOnce,
      now: () => {
        const value = clock;
        clock += 80;
        return value;
      },
    });
    expect(done).toBe(true);
    expect(tracer.sets[0]).toEqual([2, 2]);
    expect(tracer.sets.some(([x]) => x > 2)).toBe(true);
    expect(Math.max(...tracer.sets.flat())).toBeLessThanOrEqual(8);
  });

  it('stops at once when cancelled, without sampling', async () => {
    const tracer = fakeTracer();
    const renderSample = vi.spyOn(tracer, 'renderSample');
    const done = await tracePicture(tracer, {
      target: 4,
      width: 1280,
      height: 720,
      onProgress: () => {},
      cancelled: () => true,
      frame: atOnce,
    });
    expect(done).toBe(false);
    expect(renderSample).not.toHaveBeenCalled();
  });

  it('does not sample while the shader compiles', async () => {
    const tracer = fakeTracer([2, 2]);
    const compiling: boolean[] = [];
    let frames = 0;
    const original = tracer.renderSample.bind(tracer);
    tracer.renderSample = () => {
      compiling.push(tracer.isCompiling);
      original();
    };
    const done = await tracePicture(tracer, {
      target: 1,
      width: 1280,
      height: 720,
      onProgress: () => {},
      cancelled: () => false,
      frame: (callback) => {
        frames += 1;
        tracer.setCompiling(frames <= 2);
        callback();
      },
    });
    expect(done).toBe(true);
    expect(tracer.calls).toBeGreaterThan(0);
    expect(compiling.every((value) => !value)).toBe(true);
  });
});
