/** What the UI thread and the profile worker (`regionsWorker.ts`, ADR-0154) say to each other. */
import type { SketchData } from '@extrudo/core';
import type { WireRegions } from './flatRegions';

export type RegionsRequest =
  | { type: 'font'; id: string; bytes: ArrayBuffer }
  | {
      type: 'job';
      job: number;
      data: SketchData;
      /** What the budget has left for this sketch: arrays that don't fit aren't sent or built. */
      maxBytes: number;
      /** Waits this long before answering: e2e tests only. */
      delay?: number;
    };

export type RegionsReply =
  /** The worker has begun the job: its deadline runs from now (a new worker's start-up doesn't count). */
  | { job: number; started: true }
  /**
   * The regions, first: picking needs no fill. `regions` is absent when it doesn't fit
   * `maxBytes`; `fill` says whether a fill follows.
   */
  | {
      job: number;
      regions?: WireRegions;
      regionBytes: number;
      /** How many regions there are. */
      count: number;
      /** The most vertices its fill takes (`fillCost`), built or not. */
      vertices: number;
      fill: boolean;
    }
  /** The fill, after the regions; `null` when it couldn't be built. */
  | { job: number; fill: { positions: Float32Array; starts: Uint32Array } | null }
  | { job: number; refused: string }
  | { job: number; error: string };
