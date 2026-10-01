/**
 * Version history (FR-PRJ-03, P2-14, ADR-0036): save the design as a
 * numbered version with a description, bring an old version back into the
 * design (one undo step, after keeping what is there now as a version),
 * open one as a separate design, or delete versions (P3-13).
 */
import {
  type DocumentId,
  type DocumentStore,
  type ExtrudoDocument,
  newId,
  restoreVersion as restoreVersionCommand,
} from '@extrudo/core';
import type { ProjectStore, VersionSummary } from '@extrudo/storage';
import type { Autosaver } from './autosave';

export interface VersionContext {
  store: DocumentStore;
  autosave: Pick<Autosaver, 'flush' | 'getState'>;
  projects: ProjectStore;
  /** Clock, for tests. */
  now?: () => string;
}

/** "V3". */
export const versionLabel = (v: Pick<VersionSummary, 'number'>) => `V${v.number}`;

/**
 * Saves the design as it is now as its next version. Waits for autosave
 * first, so the two never write at once.
 */
export async function saveVersion(
  ctx: VersionContext,
  description: string,
): Promise<VersionSummary> {
  await ctx.autosave.flush();
  return ctx.projects.saveVersion(ctx.store.getState().doc, description);
}

/** What a version holds that `restoreVersion` brings back (not the ID, name or dates). */
function content(doc: ExtrudoDocument): string {
  const { settings, parameters, features, timelineMarker, bodies, views } = doc;
  return JSON.stringify({ settings, parameters, features, timelineMarker, bodies, views });
}

export interface Restored {
  /** The version brought back. */
  restored: VersionSummary;
  /** The version that now keeps what was there before, unless the newest version already did. */
  kept?: VersionSummary;
}

/**
 * Brings version `number` back into the open design as one undo step
 * ("Restore version"). What the design held before is kept as a version
 * first ("Before restoring V2"), unless the newest version holds it already,
 * so restoring never loses work, even after the undo history is gone. The
 * caller ends an open sketch or dialog first: the step must not join a
 * transaction.
 */
export async function restoreVersion(ctx: VersionContext, number: number): Promise<Restored> {
  const id = ctx.store.getState().doc.id;
  const versions = await ctx.projects.versions(id);
  const restored = versions.find((v) => v.number === number);
  if (!restored) throw new Error(`There is no version ${number} of this design.`);
  const doc = await ctx.projects.loadVersion(id, number);
  const [newest] = versions;
  const current = ctx.store.getState().doc;
  const same =
    newest !== undefined &&
    content(await ctx.projects.loadVersion(id, newest.number)) === content(current);
  const kept = same
    ? undefined
    : await saveVersion(ctx, `Before restoring ${versionLabel(restored)}`);
  ctx.store.getState().dispatch(restoreVersionCommand({ doc }));
  return { restored, ...(kept && { kept }) };
}

/**
 * Saves version `number` as a new design named "<name> V<n>" and returns
 * its ID; the open design is untouched.
 */
export async function openVersionCopy(ctx: VersionContext, number: number): Promise<DocumentId> {
  const current = ctx.store.getState().doc;
  const doc = await ctx.projects.loadVersion(current.id, number);
  const now = ctx.now?.() ?? new Date().toISOString();
  const copy: ExtrudoDocument = {
    ...doc,
    id: newId<DocumentId>(),
    name: `${current.name} ${versionLabel({ number })}`,
    meta: { ...doc.meta, created: now, modified: now },
  };
  await ctx.projects.save(copy);
  return copy.id;
}

/** How many versions "Delete older versions" keeps. */
export const PRUNE_KEEP = 10;

/** The versions beyond the newest `keep` (a newest-first list, as `ProjectStore.versions` gives). */
export function olderVersions(
  versions: readonly VersionSummary[],
  keep = PRUNE_KEEP,
): VersionSummary[] {
  return versions.slice(keep);
}

/** "V3", "V1 and V2", "V1–V5" (numbers in any order). */
export function versionsLabel(numbers: readonly number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const [first] = sorted;
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return '';
  if (sorted.length === 1) return versionLabel({ number: first });
  if (sorted.length === 2)
    return `${versionLabel({ number: first })} and ${versionLabel({ number: last })}`;
  const runs = last - first + 1 === sorted.length;
  return runs
    ? `${versionLabel({ number: first })}–${versionLabel({ number: last })}`
    : `${sorted.length} versions`;
}

/** Deletes versions of the open design for good (not undoable: the dialog asks first). */
export function deleteVersions(ctx: VersionContext, numbers: readonly number[]): Promise<void> {
  return ctx.projects.deleteVersions(ctx.store.getState().doc.id, numbers);
}
