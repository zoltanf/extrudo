/**
 * Where annotations are (ADR-0126 §4): a new anchor's reference stored with the kernel's
 * fingerprint, and the world point each annotation is drawn at. Pure, shared by the overlay,
 * the Annotate tool, the browser folder and the agent tools.
 */
import {
  type Annotation,
  type AnnotationAnchor,
  type AnnotationId,
  type AnnotationReport,
  annotationEntityPoint,
  type ExtrudoDocument,
  type FeatureId,
  isFeatureVisible,
  readSketch,
  type SketchFrame,
  type SketchReport,
  sketchToWorld,
} from '@extrudo/core';

export type Vec3 = [number, number, number];
export type AnnotationRef = Extract<AnnotationAnchor, { kind: 'model' }>['ref'];

/** What resolves a reference at the marker: the kernel's `resolveAnnotation`. */
export type ResolveAnnotation = (annotation: Annotation) => Promise<AnnotationReport | undefined>;

/**
 * A `model` anchor on `ref`, its name and fingerprint as the kernel has them now (the
 * agent tools and the Annotate tool store this). `at` defaults to the fingerprint's point.
 * `undefined` when the kernel can't say (no recompute yet); `detached` when nothing resolves.
 */
export async function fingerprintedAnchor(
  resolve: ResolveAnnotation,
  ref: AnnotationRef,
  at?: readonly number[],
): Promise<AnnotationAnchor | 'detached' | undefined> {
  const report = await resolve({
    id: 'probe' as AnnotationId,
    number: 1,
    text: 'probe',
    anchor: { kind: 'model', ref, at: [0, 0, 0] },
  });
  if (!report) return undefined;
  const found = report.resolved?.ref;
  if (report.status === 'detached' || !found?.fingerprint) return 'detached';
  const point = at ?? found.fingerprint.at;
  return {
    kind: 'model',
    ref: found as AnnotationRef,
    at: [point[0] as number, point[1] as number, point[2] as number],
  };
}

/** The sketch open for editing and the plane it is drawn on. */
export interface OpenSketch {
  id: FeatureId;
  frame: SketchFrame;
}

/**
 * Where the notes are now: `placeAnnotations` over the model store's reports, with the open
 * sketch (if any). The one call the overlay's helpers (browser rows, look at) share, so a note
 * the view draws is one they can find.
 */
export function placedNow(
  doc: Pick<ExtrudoDocument, 'annotations' | 'features'>,
  model: {
    annotations: Readonly<Record<string, AnnotationReport | undefined>>;
    sketches: Readonly<Record<string, SketchReport | undefined>>;
  },
  open?: OpenSketch,
): PlacedAnnotation[] {
  return placeAnnotations(doc, model.annotations, model.sketches, open);
}

/** How an annotation is drawn: its world point and status, or nothing (a sketch not shown). */
export interface PlacedAnnotation {
  annotation: Annotation;
  at: Vec3;
  /** `pending`: on geometry the model hasn't reported yet; free and sketch notes are `ok`. */
  status: AnnotationReport['status'] | 'pending';
}

/**
 * The world point of each annotation the model view draws (ADR-0126 §4): a `model` one at
 * its report's point (at `anchor.at` while detached or not reported), a `free` one at its
 * point, a `sketch` one through its sketch's frame while the sketch feature is visible
 * (with `entity`, offset from the entity's reference point; at `at` itself if the entity
 * is gone).
 */
export function placeAnnotations(
  doc: Pick<ExtrudoDocument, 'annotations' | 'features'>,
  reports: Readonly<Record<string, AnnotationReport | undefined>>,
  sketches: Readonly<Record<string, SketchReport | undefined>>,
  /**
   * The sketch open for editing and the plane it is drawn on (ADR-0126 §7): its notes are
   * drawn through that frame, shown or not, from the document as it is during a drag.
   */
  open?: OpenSketch,
): PlacedAnnotation[] {
  const out: PlacedAnnotation[] = [];
  for (const annotation of doc.annotations ?? []) {
    const { anchor } = annotation;
    if (anchor.kind === 'free') {
      out.push({ annotation, at: [...anchor.at], status: 'ok' });
    } else if (anchor.kind === 'model') {
      const report = reports[annotation.id];
      const at = report?.status !== 'detached' && report?.at ? report.at : anchor.at;
      out.push({ annotation, at: [...at] as Vec3, status: report?.status ?? 'pending' });
    } else {
      const placed = sketchPoint(doc, sketches, anchor.sketch, anchor.at, anchor.entity, open);
      if (placed) out.push({ annotation, at: placed, status: 'ok' });
    }
  }
  return out;
}

function sketchPoint(
  doc: Pick<ExtrudoDocument, 'features'>,
  sketches: Readonly<Record<string, SketchReport | undefined>>,
  id: FeatureId,
  at: readonly [number, number],
  entity: string | undefined,
  open: { id: FeatureId; frame: SketchFrame } | undefined,
): Vec3 | undefined {
  const feature = doc.features.find((f) => f.id === id);
  const editing = open?.id === id;
  const frame = editing ? open.frame : sketches[id]?.frame;
  if (!feature || !frame || (!editing && !isFeatureVisible(feature))) return undefined;
  const data = readSketch(feature)?.data;
  const base =
    entity !== undefined && data ? annotationEntityPoint(data, entity as never) : undefined;
  const local: [number, number] = base ? [base[0] + at[0], base[1] + at[1]] : [at[0], at[1]];
  const world = sketchToWorld(frame, local);
  return [world[0], world[1], world[2]];
}
