/**
 * The Annotate tool (P6-23, ADR-0126 §6): while it runs, hovering highlights what a click
 * would pin a note to, and a click opens the editor of a new note there, its number already
 * shown: on geometry (a face, edge, vertex, body, plane, axis, construction point or sketch
 * curve) a `model` note at the clicked point, on nothing a `free` note on the grid plane.
 * Nothing is in the document until the text is committed (one undo step); Esc or an empty
 * text leaves nothing behind. The tool stays on until Esc.
 */
import {
  type AnnotationAnchor,
  type BodyId,
  type DocumentStore,
  nextAnnotationNumber,
  type SelectionItem,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { readTopology, topologyRef } from '../selection/items';
import type { ModelSelect } from '../viewport/Viewport';
import {
  type AnnotationRef,
  fingerprintedAnchor,
  type ResolveAnnotation,
  type Vec3,
} from './anchor';
import type { AnnotationsUiStore } from './ui';

export const ANNOTATE_TOOL = 'annotate';

/** The reference a picked item stands for, if an annotation can sit on it. */
export function annotationRefOf(
  item: SelectionItem,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
): AnnotationRef | undefined {
  const topology = readTopology(item);
  if (topology) return topologyRef(topology, bodies) as AnnotationRef | undefined;
  if (item.kind === 'plane' || item.kind === 'axis' || item.kind === 'point') {
    return { kind: item.kind, id: item.id };
  }
  if (item.kind === 'sketchEntity' && item.id.includes('/')) {
    return { kind: 'sketchEntity', id: item.id };
  }
  return undefined;
}

export interface AnnotateToolDeps {
  store: DocumentStore;
  ui: AnnotationsUiStore;
  /** The model view's own selection, whose hover the tool keeps. */
  base: ModelSelect;
  bodies(): Readonly<Record<BodyId, BodyMesh>>;
  /** The kernel's `resolveAnnotation`, for the reference's fingerprint; absent without one. */
  resolve: ResolveAnnotation | undefined;
}

/** The view's model selection while the tool runs: hover as usual, a click drafts a note. */
export function createAnnotateSelect(deps: AnnotateToolDeps): ModelSelect {
  const { store, ui, base } = deps;
  let generation = 0;
  return {
    onHover: base.onHover,
    onBox: () => {},
    onClick: (item, _toggle, at) => {
      if (!at) return;
      // A click while a note is being typed only ends that one (its editor commits on blur).
      if (ui.getState().draft || ui.getState().editing) return;
      const mine = ++generation;
      void anchorFor(deps, item, at).then((anchor) => {
        if (mine !== generation || !anchor) return;
        ui.getState().setDraft({
          anchor,
          at: [...at] as Vec3,
          number: nextAnnotationNumber(store.getState().doc),
        });
      });
    },
  };
}

async function anchorFor(
  { bodies, resolve }: AnnotateToolDeps,
  item: SelectionItem | undefined,
  at: readonly [number, number, number],
): Promise<AnnotationAnchor | undefined> {
  const ref = item && annotationRefOf(item, bodies());
  if (!ref) return { kind: 'free', at: [at[0], at[1], at[2]] };
  const stored = resolve ? await fingerprintedAnchor(resolve, ref, at) : undefined;
  // The kernel couldn't say (no recompute yet): the name alone, which still resolves.
  if (!stored || stored === 'detached') return { kind: 'model', ref, at: [at[0], at[1], at[2]] };
  return stored;
}
