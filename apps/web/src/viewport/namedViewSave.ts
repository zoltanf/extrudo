/**
 * The save-current-view prompt's open state (ADR-0008's amendment,
 * 2026-10-10): the nav bar's Named views menu opens it anchored on its
 * button, and the "Save Current View…" command (Ctrl+K) opens the same one.
 * Session state: nothing is stored.
 */
import { createStore } from 'zustand/vanilla';

interface NamedViewSaveState {
  open: boolean;
  show(): void;
  close(): void;
}

export const namedViewSaveStore = createStore<NamedViewSaveState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));
