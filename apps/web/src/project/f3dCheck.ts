/**
 * The `.f3d` import's body check (ADR-0084): before the design is saved, a
 * throwaway kernel computes the replayed design together with the file's own
 * bodies (`probeDocument`), measures both, and `planBodies` says which replayed
 * bodies are the file's and which file bodies must come in frozen. The kernel
 * is the app's own worker, so the probe sees what the project will compute; it
 * is disposed of when the check ends, and nothing it made is kept (not the
 * model cache either, ADR-0078).
 *
 * Loaded with the importer, lazily, so `@extrudo/f3d` stays out of the app's
 * main chunk.
 */
import type { Design } from '@extrudo/api';
import { type BodyId, createDocumentStore, createModelStore } from '@extrudo/core';
import {
  type BodyLink,
  type BodyMeasure,
  type BodyPlan,
  type BodyStep,
  failedDeletions,
  fileBodies,
  measureProbe,
  planBodies,
  probeDocument,
} from '@extrudo/f3d';
import {
  type BodyMesh,
  Recomputer,
  type RecomputerOptions,
  type SpawnKernel,
} from '@extrudo/kernel';
import { fontBytes, usedFonts } from '../sketch/fonts';
import { spawnProjectKernel } from './spawnKernel';

/**
 * How long the check may take before the import goes ahead without it. The
 * writer and the probe run on untrusted bytes, so the check must never be what
 * hangs an import. On the corpus the probe's median is under 30 ms and its 95th
 * percentile under half a second.
 */
export const CHECK_TIMEOUT_MS = 60_000;

/** The plan, or why the check could not run; `undefined` when there was nothing to check. */
export type BodyCheckResult = BodyPlan | { error: string } | undefined;

/** The check, as `importF3dFile` calls it (a parameter, so its tests can stand in for it). */
export type BodyCheck = (
  replay: Design,
  steps: readonly BodyStep[],
  links: readonly BodyLink[],
) => Promise<BodyCheckResult>;

export interface BodyCheckOptions {
  spawn?: SpawnKernel;
  fonts?: RecomputerOptions['fonts'];
  timeoutMs?: number;
}

/**
 * Checks the replayed design's bodies against the file's own. No kernel starts
 * when the writer wrote no body. A kernel that fails, a probe that fails as a
 * whole or a check that runs past `timeoutMs` comes back as `{ error }`.
 */
export async function checkF3dBodies(
  replay: Design,
  steps: readonly BodyStep[],
  links: readonly BodyLink[],
  options: BodyCheckOptions = {},
): Promise<BodyCheckResult> {
  const probe = probeDocument(replay, steps);
  if (probe.bodies.length === 0) return undefined;
  const document = createDocumentStore(probe.design.toJSON());
  const model = createModelStore<BodyMesh>();
  const recomputer = new Recomputer({
    spawn: options.spawn ?? spawnProjectKernel,
    document,
    model,
    fonts: options.fonts ?? { used: usedFonts, bytes: fontBytes },
    files: {
      bytes: async (id) => {
        const bytes = probe.files.get(id);
        return bytes ? new Uint8Array(bytes).buffer : undefined;
      },
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  const run = async (): Promise<BodyCheckResult> => {
    const state = await new Promise<ReturnType<typeof model.getState>>((resolve) => {
      const settle = (s: ReturnType<typeof model.getState>) => {
        if (s.status === 'failed' || (s.status === 'ready' && s.doc === document.getState().doc))
          resolve(s);
      };
      unsubscribe = model.subscribe(settle);
      recomputer.start();
      settle(model.getState());
    });
    if (state.status === 'failed') return { error: state.error ?? 'the geometry kernel failed' };
    const measure = async (body: BodyId): Promise<BodyMeasure | undefined> => {
      const item = await recomputer
        .inspect([{ kind: 'body', body, index: 0 }])
        .then((r) => r.items[0])
        .catch(() => undefined);
      if (item?.kind !== 'body') return undefined;
      const { min, max } = item.bbox;
      return { volume: item.volume, box: [min[0], min[1], min[2], max[0], max[1], max[2]] };
    };
    const { replayed, measured } = await measureProbe(
      probe,
      { features: state.features, bodies: Object.keys(state.bodies) as BodyId[] },
      measure,
    );
    const plan = planBodies({ replayed, file: fileBodies(steps, links, measured) });
    const dropped = failedDeletions(replay, state.features);
    return dropped.length > 0 ? { ...plan, dropped } : plan;
  };
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const timeout = new Promise<BodyCheckResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ error: `it took longer than ${Math.round(timeoutMs / 1000)} s` }),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([
      run().catch((error: unknown) => ({
        error: error instanceof Error ? error.message : String(error),
      })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
    unsubscribe?.();
    recomputer.dispose();
  }
}
