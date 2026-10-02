import { useEffect } from 'react';
import { useStore } from 'zustand';
import { type Push, showUpdateReady } from '../platform/updateNotice';
import { appUpdates } from '../platform/updates';
import { saveEverything } from '../project/autosave';

/**
 * Tells the person, through the page's toasts, that a new version is waiting
 * (ADR-0054). Every page with toasts calls it (home, a project): the toast
 * appears when the update arrives, or when the page opens with one waiting.
 */
export function useUpdateNotice(push: Push): void {
  const waiting = useStore(appUpdates.store, (s) => s.waiting);
  useEffect(() => {
    if (waiting) showUpdateReady({ updates: appUpdates, saveEverything, push });
  }, [waiting, push]);
}
