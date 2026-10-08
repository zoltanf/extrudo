/**
 * The model cache's writer (ADR-0078): after a recompute finishes, the live
 * body IDs go to storage when they differ from what was last written for this
 * project. The cache is derived and safe to lose, so a failed write is only
 * logged. Pure over the model store and a `write` function.
 */
import type { BodyId, ModelStore } from '@extrudo/core';
import { sortBodyIds } from '../shell/bodies';

/** The body IDs in browser order (timeline order, then number). */
export function cacheBodyIds(
  doc: Parameters<typeof sortBodyIds>[0],
  bodies: Readonly<Record<string, unknown>>,
): string[] {
  return sortBodyIds(doc, Object.keys(bodies) as BodyId[]);
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Watches `model` and calls `write(ids)` after a finished recompute whose
 * live body list differs from the last one written. `known` is what storage
 * already holds (read at open), so an unchanged design never rewrites it.
 * Returns the unsubscribe function.
 */
export function followModelCache(
  model: ModelStore<unknown>,
  write: (ids: string[]) => Promise<void>,
  known?: readonly string[],
): () => void {
  let last: readonly string[] | undefined = known;
  const check = () => {
    const { status, doc, bodies } = model.getState();
    if (status !== 'ready' || !doc) return;
    const ids = cacheBodyIds(doc, bodies);
    if (last && same(last, ids)) return;
    last = ids;
    write(ids).catch((error: unknown) => console.warn('Model cache not written:', error));
  };
  check();
  return model.subscribe(check);
}
