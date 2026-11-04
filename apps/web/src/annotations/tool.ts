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
  annotationEntityPoint,
  type BodyId,
  type DocumentStore,
  type FeatureId,
  nextAnnotationNumber,
  readSketch,
  type SelectionItem,
  type SessionStore,
  type SketchData,
  type SketchEntityId,
  type SketchFrame,
  sketchToWorld,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { pickEntity } from '@extrudo/sketch/inference';
import { readTopology, topologyRef } from '../selection/items';
import { type PlanePointer, SNAP_PIXELS } from '../sketch/tools/host';
import type { ModelSelect, SketchInput } from '../viewport/Viewport';
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
  if (topology) {
    const ref = topologyRef(topology, bodies) as AnnotationRef | undefined;
    // A mesh body's faces have no persistent names: the note follows the body instead.
    if (!ref && bodies[topology.body]) return { kind: 'body', id: topology.body };
    return ref;
  }
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
  /** Whether the tool still runs (model mode, Annotate on): a late kernel answer opens nothing. */
  active(): boolean;
  /** A failure to read the clicked geometry, worded for the person. */
  notify(message: string): void;
}

/** A click this soon after an editor lost focus is the press that took the focus, ms. */
const BLUR_CLICK_MS = 800;

/**
 * Whether a click may start a draft: not while a note is being typed (the press blurred its
 * editor, which committed it), nor for the click whose press did that.
 */
export function mayStartDraft(ui: AnnotationsUiStore): boolean {
  const { draft, editing, blurredAt } = ui.getState();
  if (draft || editing) return false;
  return blurredAt === undefined || performance.now() - blurredAt >= BLUR_CLICK_MS;
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
      if (!mayStartDraft(ui)) return;
      const mine = ++generation;
      modelAnchorFor(deps, item, at)
        .then((anchor) => {
          if (mine !== generation || !anchor || !deps.active()) return;
          ui.getState().setDraft({
            anchor,
            at: [...at] as Vec3,
            number: nextAnnotationNumber(store.getState().doc),
          });
        })
        .catch((error: unknown) =>
          deps.notify(
            `Couldn't place the note: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    },
  };
}

/**
 * The anchor a pick makes (the tool's click, a dragged anchor dot's drop): a `model` anchor on
 * what was hit, through the kernel's name and fingerprint, or a `free` one at the point.
 */
export async function modelAnchorFor(
  { bodies, resolve }: Pick<AnnotateToolDeps, 'bodies' | 'resolve'>,
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

export interface SketchAnnotateDeps {
  store: DocumentStore;
  session: SessionStore;
  ui: AnnotationsUiStore;
  /** The open sketch and the plane it is drawn on. */
  sketch: FeatureId;
  frame: SketchFrame;
}

/**
 * The open sketch's pointer while Annotate runs (ADR-0126 §7): hovering a point, curve or
 * text (projected ones too) highlights it; a click on one drafts a note on it (`entity`, `at`
 * the offset from its reference point), a click on empty plane a note at that sketch position.
 * The draft, its editor and the guards are the 3D tool's.
 */
export function createSketchAnnotateInput(deps: SketchAnnotateDeps): SketchInput {
  const { store, session, ui, sketch, frame } = deps;
  const data = () => {
    const feature = store.getState().doc.features.find((f) => f.id === sketch);
    return feature ? readSketch(feature)?.data : undefined;
  };
  const entityAt = (pointer: PlanePointer): SketchEntityId | undefined => {
    const current = data();
    return current && pickEntity(current, pointer.point, SNAP_PIXELS * pointer.perPixel);
  };
  const clearHover = () => {
    if (session.getState().hover?.kind === 'sketchEntity') session.getState().setHover(undefined);
  };
  return {
    frame,
    cursor: 'default',
    onMove: (pointer) => {
      const id = entityAt(pointer);
      if (id) session.getState().setHover({ kind: 'sketchEntity', id });
      else clearHover();
    },
    onLeave: clearHover,
    onClick: (pointer) => {
      if (!mayStartDraft(ui)) return;
      const current = data();
      const [x, y] = pointer.point;
      const anchor: AnnotationAnchor = current
        ? sketchAnchorFor(current, sketch, pointer.point, entityAt(pointer))
        : { kind: 'sketch', sketch, at: [x, y] };
      const world = sketchToWorld(frame, [x, y]);
      ui.getState().setDraft({
        anchor,
        at: [world[0], world[1], world[2]],
        number: nextAnnotationNumber(store.getState().doc),
      });
    },
  };
}

/**
 * The anchor a click in an open sketch makes (the tool, a dragged anchor dot's drop): on the
 * entity under it (`at` the offset from its reference point), else at that sketch position.
 */
export function sketchAnchorFor(
  data: SketchData,
  sketch: FeatureId,
  point: readonly [number, number],
  entity: SketchEntityId | undefined,
): AnnotationAnchor {
  const base = entity ? annotationEntityPoint(data, entity) : undefined;
  const [x, y] = point;
  return entity && base
    ? { kind: 'sketch', sketch, at: [x - base[0], y - base[1]], entity }
    : { kind: 'sketch', sketch, at: [x, y] };
}
