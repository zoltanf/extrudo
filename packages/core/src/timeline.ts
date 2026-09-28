/**
 * Timeline v2 (P2-11, ADR-0033): which features a feature builds on, moving
 * a feature in the timeline (FR-TL-04), and replacing references a feature
 * lost or the kernel guessed ("fix references", FR-TL-05).
 *
 * A feature builds on another when one of its stored references names it:
 * a profile or sketch line (`<sketch>/<id>`), a body (`<feature>:<n>`), or
 * a face, edge or vertex whose persistent name (ADR-0005) mentions the
 * feature that made it (`extrude:<feature>:cap:end`). Expressions don't
 * order features: parameters are one namespace evaluated apart from the
 * timeline (ADR-0004), whatever the marker or the order.
 */
import { CommandError, type DocumentDraft, defineCommand } from './commands';
import type { FeatureId } from './ids';
import type { ExtrudoDocument, Feature, GeomRef, GeomRefKind } from './schema';

/** Characters that separate the plain IDs inside a reference or a persistent name. */
const SEPARATORS = /[^A-Za-z0-9_.~-]+/;

/** Where a feature stores a reference. */
export interface StoredRef {
  /** The input that holds it. */
  input: string;
  ref: GeomRef;
  /** Set for the source of a sketch's projection (P2-09): its projection ID. */
  projection?: string;
}

/** Every reference a feature stores: its `ref` inputs, then its sketch's projection sources. */
export function storedRefs(feature: Pick<Feature, 'inputs'>): StoredRef[] {
  const out: StoredRef[] = [];
  for (const [input, value] of Object.entries(feature.inputs)) {
    if (value.kind === 'ref') for (const ref of value.refs) out.push({ input, ref });
  }
  for (const [input, value] of Object.entries(feature.inputs)) {
    if (value.kind !== 'sketchData') continue;
    for (const [projection, record] of Object.entries(value.sketch.projections ?? {})) {
      out.push({ input, ref: record.ref, projection });
    }
  }
  return out;
}

/**
 * The features a feature builds on, in no particular order: those whose ID
 * appears in one of its stored references (see the module comment). `ids`
 * are the document's feature IDs; the feature itself is left out.
 */
export function referencedFeatures(
  feature: Pick<Feature, 'id' | 'inputs'>,
  ids: ReadonlySet<string>,
): FeatureId[] {
  const found = new Set<FeatureId>();
  for (const { ref } of storedRefs(feature)) {
    for (const token of ref.id.split(SEPARATORS)) {
      if (token !== feature.id && ids.has(token)) found.add(token as FeatureId);
    }
  }
  return [...found];
}

/** The features each feature builds on, by feature ID. */
export function timelineDependencies(
  doc: Pick<ExtrudoDocument, 'features'>,
): Map<FeatureId, FeatureId[]> {
  const ids = new Set<string>(doc.features.map((f) => f.id));
  return new Map(doc.features.map((f) => [f.id, referencedFeatures(f, ids)]));
}

/**
 * Why feature `id` can't move to `index` (its position in the timeline
 * after the move), or `undefined` if it can: it would come before a
 * feature it builds on, or after one that builds on it.
 */
export function moveProblem(
  doc: Pick<ExtrudoDocument, 'features'>,
  id: FeatureId,
  index: number,
): string | undefined {
  const from = doc.features.findIndex((f) => f.id === id);
  const feature = doc.features[from];
  if (!feature) return `Feature ${id} doesn't exist.`;
  if (!Number.isInteger(index) || index < 0 || index >= doc.features.length) {
    return `Can't move ${feature.name} to position ${index}.`;
  }
  const order = doc.features.filter((f) => f.id !== id);
  order.splice(index, 0, feature);
  const at = new Map(order.map((f, i) => [f.id, i]));
  const dependencies = timelineDependencies(doc);
  // What it builds on, nearest first: the message names the one it would pass.
  const needs = (dependencies.get(id) ?? [])
    .filter((d) => (at.get(d) ?? -1) > index)
    .sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
  const need = doc.features.find((f) => f.id === needs[0]);
  if (need) {
    return `Can't move ${feature.name} before ${need.name}: ${feature.name} uses ${need.name}.`;
  }
  const users = order
    .slice(0, index)
    .filter((f) => dependencies.get(f.id)?.includes(id))
    .reverse();
  const user = users[0];
  if (user) {
    return `Can't move ${feature.name} after ${user.name}: ${user.name} uses ${feature.name}.`;
  }
  return undefined;
}

/**
 * Moves a feature to `index` (its position afterwards), FR-TL-04: one undo
 * step, refused with `moveProblem`'s message when it would break a
 * reference. The rollback marker stays between the same other features;
 * the moved feature is active if it lands among active features, rolled
 * back among rolled-back ones, and, landing right at the marker, keeps its
 * state unless `active` says otherwise.
 */
export const moveFeature = defineCommand<{ id: FeatureId; index: number; active?: boolean }>(
  'feature.move',
  'Move feature',
  (draft, { id, index, active }) => {
    const problem = moveProblem(draft as ExtrudoDocument, id, index);
    if (problem) throw new CommandError(problem);
    const from = draft.features.findIndex((f) => f.id === id);
    const wasActive = from < draft.timelineMarker;
    // Active features other than this one: they stay a prefix of the others.
    const before = draft.timelineMarker - (wasActive ? 1 : 0);
    const isActive = index < before ? true : index > before ? false : (active ?? wasActive);
    if (index === from && isActive === wasActive) return;
    const [feature] = draft.features.splice(from, 1);
    if (!feature) return;
    draft.features.splice(index, 0, feature);
    draft.timelineMarker = before + (isActive ? 1 : 0);
  },
);

/** A reference to replace, named as stored (kind and ID), and what replaces it. */
export interface ReferenceReplacement {
  from: { kind: GeomRefKind; id: string };
  /** `null` removes it (from a `ref` input; a sketch's plane and projections can't lose theirs). */
  to: GeomRef | null;
}

/**
 * Replaces or removes references of a feature in every input that stores
 * them, as one undo step (FR-TL-05: keeping the kernel's closest match, or
 * a fix picked by hand). Refused if the feature stores none of them, if a
 * sketch would lose its plane or a projection its source, or if a new
 * reference names the feature itself or one after it.
 */
export const replaceReferences = defineCommand<{
  id: FeatureId;
  replace: readonly ReferenceReplacement[];
}>('feature.references', 'Fix references', (draft, { id, replace }) => {
  const index = draft.features.findIndex((f) => f.id === id);
  const feature = draft.features[index];
  if (!feature) throw new CommandError(`Feature ${id} doesn't exist.`);
  checkNewReferences(
    draft,
    index,
    replace.flatMap((r) => (r.to ? [r.to] : [])),
  );
  const match = (ref: GeomRef) =>
    replace.find((r) => r.from.kind === ref.kind && r.from.id === ref.id);
  let changed = 0;
  for (const [name, input] of Object.entries(feature.inputs)) {
    if (input.kind === 'ref') {
      const refs: GeomRef[] = [];
      for (const ref of input.refs) {
        const r = match(ref);
        if (!r) refs.push(ref);
        else {
          changed++;
          const to = r.to;
          if (to && !refs.some((x) => x.kind === to.kind && x.id === to.id)) refs.push(to);
        }
      }
      if (feature.type === 'sketch' && name === 'plane' && refs.length !== 1) {
        throw new CommandError(`${feature.name} needs a plane or a flat face to lie on.`);
      }
      input.refs = refs;
    } else if (input.kind === 'sketchData') {
      for (const record of Object.values(input.sketch.projections ?? {})) {
        const r = match(record.ref);
        if (!r) continue;
        if (!r.to) {
          throw new CommandError(
            'A projection keeps its source: delete its curves to remove it instead.',
          );
        }
        record.ref = r.to;
        changed++;
      }
    }
  }
  if (changed === 0) throw new CommandError(`${feature.name} has none of those references.`);
});

/**
 * Refuses new references that name the feature at `index` itself or a
 * feature after it: a feature can only use what comes before it.
 */
export function checkNewReferences(
  draft: DocumentDraft,
  index: number,
  refs: readonly GeomRef[],
): void {
  const feature = draft.features[index];
  if (!feature) return;
  const later = new Map(draft.features.slice(index).map((f) => [f.id as string, f.name]));
  for (const ref of refs) {
    for (const token of ref.id.split(SEPARATORS)) {
      const name = later.get(token);
      if (name === undefined) continue;
      throw new CommandError(
        token === feature.id
          ? `${feature.name} can't use its own geometry.`
          : `${feature.name} can't use geometry of ${name}, which comes after it in the timeline.`,
      );
    }
  }
}
