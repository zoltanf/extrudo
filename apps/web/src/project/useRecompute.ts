import type { DocumentStore, ModelStore } from '@extrudo/core';
import { type BodyMesh, Recomputer, type SpawnKernel, spawnBrowserKernel } from '@extrudo/kernel';
import { useEffect, useState } from 'react';
import { fontBytes, usedFonts } from '../sketch/fonts';

/**
 * One kernel per open project, recomputing the document as it changes and
 * filling the model store (P2-01, ADR-0024). Created in an effect, like the
 * autosaver, so strict mode's second mount gets a fresh one. Feature dialogs
 * preview through it (P2-05). The document's text fonts go to the worker
 * before the recompute that needs them (P4-03, ADR-0058 §4).
 */
export function useRecompute(
  store: DocumentStore,
  model: ModelStore<BodyMesh>,
  spawn: SpawnKernel = spawnBrowserKernel,
): Recomputer | undefined {
  const [recomputer, setRecomputer] = useState<Recomputer>();
  useEffect(() => {
    const r = new Recomputer({
      spawn,
      document: store,
      model,
      fonts: { used: usedFonts, bytes: fontBytes },
    });
    r.start();
    setRecomputer(r);
    return () => {
      r.dispose();
      model.getState().reset();
    };
  }, [store, model, spawn]);
  return recomputer;
}
