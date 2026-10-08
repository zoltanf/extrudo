import type { DocumentId, ModelStore } from '@extrudo/core';
import { useEffect, useState } from 'react';
import type { Platform } from '../platform';
import { followModelCache } from './modelCache';

/**
 * The project's model cache (ADR-0078): reads the body IDs the last finished
 * recompute left (undefined until read, or with none) and, from then on,
 * writes them back after a recompute that changed them. Derived data: any
 * failure is ignored (the writer logs), and nothing here touches the document.
 */
export function useModelCache(
  id: DocumentId,
  model: ModelStore<unknown>,
  platform: Platform,
): readonly string[] | undefined {
  const [pending, setPending] = useState<readonly string[]>();
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const projects = platform.projects;
    projects
      .readModelCache(id)
      .catch(() => undefined)
      .then((cache) => {
        if (cancelled) return;
        if (cache) setPending(cache.bodies);
        stop = followModelCache(
          model,
          (bodies) => projects.writeModelCache(id, { version: 1, bodies }),
          cache?.bodies,
        );
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [id, model, platform]);
  return pending;
}
