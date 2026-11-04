/**
 * Annotations (P6-23, ADR-0126): numbered notes pinned to geometry, to a point
 * in space or to a sketch, so a person and an agent can say "#3".
 *
 * Every annotation gets the next number from `annotationCounter` (§2), which
 * only grows: deleting #3 never frees "3", and undo puts the counter back with
 * the annotation. Annotations are in no feature's cache key, so editing one
 * recomputes nothing; the kernel resolves `model` anchors after each recompute
 * (`ModelState.annotations`).
 */
import { CommandError, type CommandFactory, type DocumentDraft, defineCommand } from './commands';
import type { AnnotationId, FeatureId, SketchEntityId } from './ids';
import {
  ANNOTATION_REF_KINDS,
  ANNOTATION_TEXT_MAX,
  type Annotation,
  type AnnotationAnchor,
  type ExtrudoDocument,
  type Feature,
} from './schema';
import type { SketchData } from './sketch/schema';

/** Where a new callout sits from its anchor, screen px (ADR-0126 §6). */
export const ANNOTATION_OFFSET: readonly [number, number] = [28, -28];

/** The next number an annotation would get (ADR-0126 §2). */
export function nextAnnotationNumber(doc: Pick<ExtrudoDocument, 'annotationCounter'>): number {
  return (doc.annotationCounter ?? 0) + 1;
}

/** The annotation numbered `number`, if the design has one. */
export function annotationByNumber(
  doc: Pick<ExtrudoDocument, 'annotations'>,
  number: number,
): Annotation | undefined {
  return (doc.annotations ?? []).find((a) => a.number === number);
}

/**
 * The point of a sketch entity an annotation on it follows (ADR-0126 §4): a
 * point's position, a line's midpoint, a circle's, arc's or ellipse's centre,
 * a spline's mean point, a text's anchor. `undefined` if the sketch has no
 * such entity.
 */
export function annotationEntityPoint(
  data: Pick<SketchData, 'entities'>,
  id: SketchEntityId,
): [number, number] | undefined {
  const at = (point: SketchEntityId): [number, number] | undefined => {
    const p = data.entities[point];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  const mean = (points: readonly SketchEntityId[]): [number, number] | undefined => {
    const all = points.map(at);
    if (all.length === 0 || all.some((p) => p === undefined)) return undefined;
    const sum = (all as [number, number][]).reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
    return [sum[0] / all.length, sum[1] / all.length];
  };
  const entity = data.entities[id];
  switch (entity?.type) {
    case undefined:
      return undefined;
    case 'point':
      return [entity.x, entity.y];
    case 'line':
      return mean([entity.start, entity.end]);
    case 'circle':
    case 'arc':
    case 'ellipse':
      return at(entity.center);
    case 'spline':
      return mean(entity.points);
    case 'text':
      return at(entity.anchor);
  }
}

/** The sketch data of a sketch feature, or `undefined` if `id` names none. */
function sketchOf(doc: Pick<ExtrudoDocument, 'features'>, id: FeatureId): SketchData | undefined {
  const feature = doc.features.find((f) => f.id === id) as Feature | undefined;
  const input = feature?.type === 'sketch' ? feature.inputs.sketch : undefined;
  return input?.kind === 'sketchData' ? input.sketch : undefined;
}

/**
 * Why an anchor can't be stored, or `undefined` (ADR-0126 §1): a reference of
 * a kind an annotation doesn't take, an `index:` reference, a sketch the
 * timeline doesn't have, an entity that sketch doesn't have.
 */
export function annotationAnchorProblem(
  doc: Pick<ExtrudoDocument, 'features'>,
  anchor: AnnotationAnchor,
): string | undefined {
  if (anchor.kind === 'model') {
    if (!(ANNOTATION_REF_KINDS as readonly string[]).includes(anchor.ref.kind)) {
      return `An annotation can't sit on a ${anchor.ref.kind}.`;
    }
    if (anchor.ref.id.startsWith('index:')) {
      return "An annotation can't keep an index reference: pick the geometry again.";
    }
    return undefined;
  }
  if (anchor.kind === 'sketch') {
    const data = sketchOf(doc, anchor.sketch);
    if (!data) return `There is no sketch ${anchor.sketch}.`;
    if (anchor.entity !== undefined && !(anchor.entity in data.entities)) {
      return `The sketch has no entity "${anchor.entity}".`;
    }
  }
  return undefined;
}

/** A checked text: trimmed, not empty, at most `ANNOTATION_TEXT_MAX` characters. */
function annotationText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new CommandError("An annotation's text can't be empty.");
  if (trimmed.length > ANNOTATION_TEXT_MAX) {
    throw new CommandError(
      `An annotation's text can be at most ${ANNOTATION_TEXT_MAX} characters.`,
    );
  }
  return trimmed;
}

function checkAnchor(draft: DocumentDraft, anchor: AnnotationAnchor): void {
  const problem = annotationAnchorProblem(draft as ExtrudoDocument, anchor);
  if (problem) throw new CommandError(problem);
}

function indexOf(draft: DocumentDraft, id: AnnotationId): number {
  const at = (draft.annotations ?? []).findIndex((a) => a.id === id);
  if (at < 0) throw new CommandError(`Annotation ${id} doesn't exist.`);
  return at;
}

export interface AddAnnotationPayload {
  /** From `newId()` in the caller. */
  id: AnnotationId;
  text: string;
  anchor: AnnotationAnchor;
  offset?: readonly [number, number];
  hidden?: boolean;
  done?: boolean;
  /**
   * A number past the counter, for a script that rebuilds a design with its
   * numbers (`emitScript`); left out, the next number (ADR-0126 §2).
   */
  number?: number;
}

/**
 * A new annotation with the next number; the counter moves to it in the same
 * step, so undo gives both back. Refuses an empty text, an unknown sketch or
 * entity, an `index:` reference. One undo step.
 */
export const addAnnotation = defineCommand<AddAnnotationPayload>(
  'annotation.add',
  'New annotation',
  (draft, { id, text, anchor, offset, hidden, done, number }) => {
    if ((draft.annotations ?? []).some((a) => a.id === id)) {
      throw new CommandError(`Annotation ${id} already exists.`);
    }
    const checked = annotationText(text);
    checkAnchor(draft, anchor);
    const next = nextAnnotationNumber(draft);
    if (number !== undefined && (!Number.isInteger(number) || number < next)) {
      throw new CommandError(`Annotation #${number} can't be given again: the next is #${next}.`);
    }
    const n = number ?? next;
    const annotation: Annotation = {
      id,
      number: n,
      text: checked,
      anchor,
      ...(offset && { offset: [offset[0], offset[1]] }),
      ...(hidden && { hidden: true as const }),
      ...(done && { done: true as const }),
    };
    draft.annotations = [...(draft.annotations ?? []), annotation];
    draft.annotationCounter = n;
  },
);

/**
 * Moves the counter up to `counter`, so no number up to it is given again: a
 * design rebuilt from a script whose last notes had been deleted (`emitScript`).
 * Never lowers it. One undo step.
 */
export const raiseAnnotationCounter = defineCommand<{ counter: number }>(
  'annotation.counter',
  'Annotation numbers',
  (draft, { counter }) => {
    const current = draft.annotationCounter ?? 0;
    if (!Number.isInteger(counter) || counter < current) {
      throw new CommandError(
        `The annotation counter only grows: it is ${current}, so it can't be ${counter}.`,
      );
    }
    if (counter > 0) draft.annotationCounter = counter;
  },
);

export interface AnnotationChanges {
  text?: string;
  offset?: readonly [number, number];
  /** `false` deletes the key. */
  hidden?: boolean;
  /** `false` deletes the key. */
  done?: boolean;
}

/** Changes an annotation's text, offset, hidden or done flag; refuses an empty text. One undo step. */
export const updateAnnotation = defineCommand<{ id: AnnotationId; changes: AnnotationChanges }>(
  'annotation.update',
  'Edit annotation',
  (draft, { id, changes }) => {
    const annotation = (draft.annotations as Annotation[])[indexOf(draft, id)] as Annotation;
    if (changes.text !== undefined) annotation.text = annotationText(changes.text);
    if (changes.offset !== undefined) annotation.offset = [changes.offset[0], changes.offset[1]];
    if (changes.hidden === true) annotation.hidden = true;
    else if (changes.hidden === false) delete annotation.hidden;
    if (changes.done === true) annotation.done = true;
    else if (changes.done === false) delete annotation.done;
  },
);

/** Re-anchors an annotation (dragged onto other geometry, an agent's edit); keeps its number. One undo step. */
export const moveAnnotation = defineCommand<{ id: AnnotationId; anchor: AnnotationAnchor }>(
  'annotation.move',
  'Move annotation',
  (draft, { id, anchor }) => {
    const annotation = (draft.annotations as Annotation[])[indexOf(draft, id)] as Annotation;
    checkAnchor(draft, anchor);
    annotation.anchor = anchor;
  },
);

const deleteAnnotations = defineCommand<{ ids: readonly AnnotationId[] }>(
  'annotation.remove',
  'Delete annotation',
  (draft, { ids }) => {
    for (const id of ids) indexOf(draft, id);
    removeAnnotationsFrom(draft, (a) => ids.includes(a.id));
  },
);

/** Deletes annotations; `annotations` goes when it is empty, the counter stays. One undo step. */
export const removeAnnotation: CommandFactory<{ ids: readonly AnnotationId[] }> = Object.assign(
  (payload: { ids: readonly AnnotationId[] }) => ({
    ...deleteAnnotations(payload),
    label: payload.ids.length === 1 ? 'Delete annotation' : 'Delete annotations',
  }),
  { type: deleteAnnotations.type },
);

/** Drops the annotations `drop` matches, and `annotations` with them when none is left. */
export function removeAnnotationsFrom(
  draft: DocumentDraft,
  drop: (annotation: Annotation) => boolean,
): number {
  const before = draft.annotations?.length ?? 0;
  if (before === 0) return 0;
  const left = (draft.annotations ?? []).filter((a) => !drop(a as Annotation));
  if (left.length === 0) delete draft.annotations;
  else if (left.length < before) draft.annotations = left;
  return before - left.length;
}

/**
 * Before entities of sketch `feature` are removed (ADR-0126 §3): an annotation
 * on one of them loses its `entity` and keeps where it is, its offset turned
 * into the sketch position it was drawn at. Call it while `data` still has
 * the entities.
 */
export function detachAnnotationEntities(
  draft: DocumentDraft,
  feature: FeatureId,
  data: Pick<SketchData, 'entities'>,
  removed: Iterable<SketchEntityId>,
): void {
  if (!draft.annotations) return;
  const gone = new Set(removed);
  for (const annotation of draft.annotations) {
    const { anchor } = annotation;
    if (anchor.kind !== 'sketch' || anchor.sketch !== feature) continue;
    if (anchor.entity === undefined || !gone.has(anchor.entity)) continue;
    const base = annotationEntityPoint(data, anchor.entity) ?? [0, 0];
    anchor.at = [base[0] + anchor.at[0], base[1] + anchor.at[1]];
    delete anchor.entity;
  }
}
