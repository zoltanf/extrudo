/**
 * The annotations' view state (ADR-0126 §6): which note is being edited in place, or the
 * draft the Annotate tool is making. Not in the document and not undoable; one per open
 * design, shared by the overlay, the tool and the browser folder.
 */
import type { AnnotationAnchor, AnnotationId } from '@extrudo/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Vec3 } from './anchor';

/** A note the Annotate tool placed but nobody has typed yet: it isn't in the document. */
export interface AnnotationDraft {
  anchor: AnnotationAnchor;
  /** Where it is drawn, world mm. */
  at: Vec3;
  /** The number it will get (the counter's next). */
  number: number;
}

export interface AnnotationsUi {
  /** The annotation edited in place, if any. */
  editing: AnnotationId | undefined;
  /** The Annotate tool's draft, its editor open; committing adds it in one step. */
  draft: AnnotationDraft | undefined;
  /**
   * When an editor last closed because it lost focus (performance.now()): the press that took
   * the focus commits it, and its click must not start the next draft at once.
   */
  blurredAt: number | undefined;
  edit(id: AnnotationId | undefined): void;
  setDraft(draft: AnnotationDraft | undefined): void;
  noteBlur(): void;
}

export type AnnotationsUiStore = StoreApi<AnnotationsUi>;

export function createAnnotationsUi(): AnnotationsUiStore {
  return createStore<AnnotationsUi>()((set) => ({
    editing: undefined,
    draft: undefined,
    blurredAt: undefined,
    edit: (editing) => set({ editing, draft: undefined }),
    setDraft: (draft) => set({ draft, editing: undefined }),
    noteBlur: () => set({ blurredAt: performance.now() }),
  }));
}
