/** What the UI thread and the profile worker (`regionsWorker.ts`, ADR-0154) say to each other. */
import type { SketchData } from '@extrudo/core';
import type { FlatRegions } from './flatRegions';

export type RegionsRequest =
  | { type: 'font'; id: string; bytes: ArrayBuffer }
  | {
      type: 'job';
      job: number;
      data: SketchData;
      /** A fill of more vertices than this could never be kept: it isn't built. */
      maxFillVertices: number;
      /** Waits this long before answering: e2e tests only. */
      delay?: number;
    };

export type RegionsReply =
  | {
      job: number;
      regions: FlatRegions;
      /** The most vertices its fill takes (`fillCost`), built or not. */
      vertices: number;
      fill?: { positions: Float32Array; starts: Uint32Array };
    }
  | { job: number; refused: string }
  | { job: number; error: string };
