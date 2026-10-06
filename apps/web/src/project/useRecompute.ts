import type { DocumentStore, ModelStore } from '@extrudo/core';
import { type BodyMesh, Recomputer, type SpawnKernel } from '@extrudo/kernel';
import { useEffect, useState } from 'react';
import { appNotifications } from '../design-system';
import { fileMediaType, fileName } from '../features/import';
import { attachmentBytes, fontBytes, usedFonts } from '../sketch/fonts';
import { spawnProjectKernel } from './spawnKernel';

/** What a replaced kernel worker says in the notification history (P4-12 H4). */
export const RECYCLED_TEXT = 'The geometry kernel was restarted to free memory.';

/**
 * One kernel per open project, recomputing the document as it changes and
 * filling the model store (P2-01, ADR-0024). Created in an effect, like the
 * autosaver, so strict mode's second mount gets a fresh one. Feature dialogs
 * preview through it (P2-05). The document's text fonts and the files its
 * imports name go to the worker before the recompute that needs them (P4-03,
 * ADR-0058 §4; P4-06, ADR-0066 §0). A worker whose heap has grown past its
 * limit is replaced between recomputes (P4-12 H4), which the notification
 * history records, quietly: the view carries on showing the model throughout,
 * and the new worker is sent the fonts and files again (`Recomputer`'s restart
 * path, which mesh bodies need as well for manifold-3d, and scripts for their
 * runner). The worker is the app's own entry (`kernelWorker.ts`), which adds
 * the script runner to the kernel (P5-02, ADR-0070 §2).
 */
export function useRecompute(
  store: DocumentStore,
  model: ModelStore<BodyMesh>,
  spawn: SpawnKernel = spawnProjectKernel,
): Recomputer | undefined {
  const [recomputer, setRecomputer] = useState<Recomputer>();
  useEffect(() => {
    const r = new Recomputer({
      spawn,
      document: store,
      model,
      fonts: { used: usedFonts, bytes: fontBytes },
      files: { bytes: attachmentBytes, mediaType: fileMediaType, fileName },
      onRecycle: () => {
        appNotifications.getState().push('info', RECYCLED_TEXT, { quiet: true });
      },
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
