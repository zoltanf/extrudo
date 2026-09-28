import type { DocumentStore, ModelStore } from '@extrudo/core';
import { type BodyMesh, Recomputer, type SpawnKernel, spawnBrowserKernel } from '@extrudo/kernel';
import { useEffect, useState } from 'react';

/**
 * One kernel per open project, recomputing the document as it changes and
 * filling the model store (P2-01, ADR-0024). Created in an effect, like the
 * autosaver, so strict mode's second mount gets a fresh one. Feature dialogs
 * preview through it (P2-05).
 */
export function useRecompute(
  store: DocumentStore,
  model: ModelStore<BodyMesh>,
  spawn: SpawnKernel = spawnBrowserKernel,
): Recomputer | undefined {
  const [recomputer, setRecomputer] = useState<Recomputer>();
  useEffect(() => {
    const r = new Recomputer({ spawn, document: store, model });
    r.start();
    setRecomputer(r);
    return () => {
      r.dispose();
      model.getState().reset();
    };
  }, [store, model, spawn]);
  return recomputer;
}
