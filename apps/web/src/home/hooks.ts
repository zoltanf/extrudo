import type { ProjectId, ProjectSummary } from '@extrudo/storage';
import { useCallback, useEffect, useState } from 'react';
import type { Persistence, Platform } from '../platform';
import { allSaved } from '../project/autosave';

/** The project list, refreshed on demand. `undefined` while loading. */
export function useProjects(platform: Platform) {
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [error, setError] = useState<unknown>();
  const refresh = useCallback(async () => {
    try {
      // A project closed a moment ago may still be saving.
      await allSaved();
      setProjects(await platform.projects.list());
    } catch (e) {
      setError(e);
    }
  }, [platform]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { projects, error, refresh };
}

/**
 * Whether storage is persistent, asking the browser once if it isn't
 * (FR-PRJ-05). `undefined` until known.
 */
export function usePersistence(platform: Platform): Persistence | undefined {
  const [persistence, setPersistence] = useState<Persistence>();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let state = await platform.storage.persistence();
      if (state === 'best-effort') state = await platform.storage.requestPersistence();
      if (!cancelled) setPersistence(state);
    })().catch(() => {
      if (!cancelled) setPersistence('unsupported');
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);
  return persistence;
}

/** An object URL for a project's thumbnail, revoked when it changes. */
export function useThumbnailUrl(platform: Platform, id: ProjectId, version: string, has: boolean) {
  const [url, setUrl] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` (the modified time) refetches the thumbnail after a save
  useEffect(() => {
    if (!has) {
      setUrl(undefined);
      return;
    }
    let cancelled = false;
    let created: string | undefined;
    platform.projects
      .thumbnail(id)
      .then((blob) => {
        if (cancelled || !blob) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [platform, id, version, has]);
  return url;
}
