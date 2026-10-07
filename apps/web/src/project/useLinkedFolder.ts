/**
 * The linked folder as an open project sees it (P4-09, ADR-0065 §3): one
 * `LinkedProject` per open design, kept beside the project page rather than
 * the shell, because it owns autosave. Where the browser has no folder to link
 * (`platform.folders`), nothing here exists and the app behaves as it did.
 */
import type { DocumentStore } from '@extrudo/core';
import type { ProjectId } from '@extrudo/storage';
import { useEffect, useMemo, useState } from 'react';
import type { ToastOptions } from '../design-system';
import type { Platform } from '../platform';
import type { Autosaver } from './autosave';
import { createLinkedProject, type LinkedProject } from './linkedFolder';
import { restoreDocument } from './versions';

export interface LinkedFolderProps {
  id: ProjectId;
  store: DocumentStore;
  autosave?: Autosaver;
  platform: Platform;
  notify(tone: 'info' | 'success' | 'error', text: string, options?: ToastOptions): void;
}

export interface LinkedFolderHandle {
  /**
   * Writes the file for the first time and links the project to it. Absent
   * while no folder is linked, while the link isn't known yet, and once the
   * project is linked: the command is offered only when it can run (ADR-0065
   * §3).
   */
  linkNow?: () => void;
}

export function useLinkedFolder(props: LinkedFolderProps): LinkedFolderHandle {
  const { id, store, autosave, platform, notify } = props;
  const folders = platform.folders;
  /** A folder is linked, and this project is not linked to a file in it. */
  const [canLink, setCanLink] = useState(false);

  const project = useMemo<LinkedProject | undefined>(
    () =>
      folders && autosave
        ? createLinkedProject({
            folders,
            externalFiles: platform.externalFiles,
            projects: platform.projects,
            store,
            autosave,
            notify,
            restore: async (doc, label) => {
              await restoreDocument({ store, autosave, projects: platform.projects }, doc, label);
            },
          })
        : undefined,
    [folders, platform, store, autosave, notify],
  );

  // The link is in the project index, not the document (ADR-0065 §3), so it is
  // read once the project is open; the design itself says nothing about it.
  useEffect(() => {
    if (!folders) return;
    let cancelled = false;
    (async () => {
      const [folder, summary] = await Promise.all([folders.current(), platform.projects.get(id)]);
      if (cancelled) return;
      setCanLink(!!folder && !summary?.linked);
    })().catch(() => {
      if (!cancelled) setCanLink(false);
    });
    return () => {
      cancelled = true;
    };
  }, [folders, platform, id]);

  // A last write when the project closes (ADR-0065 §3): the design may have
  // moved since the last autosave, or the trailing write may still be waiting.
  useEffect(() => {
    if (!project || !autosave) return;
    const unsubscribe = autosave.subscribe((state, previous) => {
      if (state.status === 'saved' && previous.status !== 'saved') void project.afterSave();
    });
    return () => {
      unsubscribe();
      void project.close();
    };
  }, [project, autosave]);

  if (!canLink || !project) return {};
  return {
    linkNow: () => {
      void project.linkNow().then((outcome) => {
        if (outcome.kind === 'written') setCanLink(false);
      });
    },
  };
}
