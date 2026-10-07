import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { Platform } from '../platform';
import { type Push, showUpdateReady } from '../platform/updateNotice';
import { createUpdateStore } from '../platform/updates';
import { saveEverything } from '../project/autosave';

/** A store that never has an update, for a platform without `updates`. */
const NONE = createUpdateStore();

/**
 * Tells the person, through the page's toasts, that a new version is waiting
 * (ADR-0054). Every page with toasts calls it (home, a project): the toast
 * appears when the update arrives, or when the page opens with one waiting.
 * The updates are the platform's (P6-01 slice 4): the web's service worker or
 * the desktop's updater; a platform without `updates` shows nothing.
 */
export function useUpdateNotice(push: Push, platform: Pick<Platform, 'updates'>): void {
  const updates = platform.updates;
  const waiting = useStore(updates?.store ?? NONE, (s) => s.waiting);
  useEffect(() => {
    if (waiting && updates) showUpdateReady({ updates, saveEverything, push });
  }, [waiting, push, updates]);
}
