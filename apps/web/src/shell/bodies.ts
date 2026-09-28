/**
 * The bodies the browser lists and the view draws (P2-06, P2-08, ADR-0030):
 * the model's live bodies, which the kernel makes (`<feature>:<n>` IDs),
 * with the document's metadata (`doc.bodies`: name, colour, opacity,
 * visibility).
 *
 * Every live body gets stored metadata as soon as a recompute shows it
 * (`followBodyNames`): its name ("Body3", `newBodyNames`) is amended into
 * the undo step that made the body, so names never shift when another body
 * goes away, and undo and redo take them along. Until then the browser
 * shows the name it will get. Metadata of bodies that no longer exist is
 * kept (a Remove rolled back brings the body back with its name) but not
 * listed.
 */
import {
  type BodyId,
  type BodyMeta,
  type Command,
  CommandError,
  type DocumentStore,
  type ExtrudoDocument,
  type FeatureId,
  insertFeature,
  type ModelStore,
  nameBodies,
  newBodyNames,
  newId,
  nextFeatureName,
  removeBodiesFeatureOf,
  type SessionStore,
  updateBody,
} from '@extrudo/core';

export interface BodyEntry {
  id: BodyId;
  meta: BodyMeta;
  /** Whether `meta` is stored in the document (false: the name it is about to get). */
  stored: boolean;
}

/** Body IDs in timeline order: the feature that made each, then its number. */
export function sortBodyIds(
  doc: Pick<ExtrudoDocument, 'features'>,
  ids: readonly BodyId[],
): BodyId[] {
  const order = new Map(doc.features.map((f, i) => [f.id as string, i]));
  const key = (id: BodyId) => {
    const at = id.lastIndexOf(':');
    const feature = at < 0 ? id : id.slice(0, at);
    const n = at < 0 ? 0 : Number(id.slice(at + 1)) || 0;
    return [order.get(feature) ?? Number.MAX_SAFE_INTEGER, n] as const;
  };
  return [...ids].sort((a, b) => {
    const [fa, na] = key(a);
    const [fb, nb] = key(b);
    return fa - fb || na - nb || a.localeCompare(b);
  });
}

/** The live bodies in timeline order, with their metadata (or the name they will get). */
export function bodyEntries(
  doc: Pick<ExtrudoDocument, 'bodies' | 'features'>,
  live: Readonly<Record<BodyId, unknown>>,
): BodyEntry[] {
  const ids = sortBodyIds(doc, Object.keys(live) as BodyId[]);
  const names = newBodyNames(
    doc,
    ids.filter((id) => !doc.bodies[id]),
  );
  return ids.map((id) => {
    const stored = doc.bodies[id];
    if (stored) return { id, meta: stored, stored: true };
    return { id, meta: { name: names[id] as string, visible: true }, stored: false };
  });
}

/** The metadata of every live body (names about to be stored included), for the view. */
export function bodyMetaOf(entries: readonly BodyEntry[]): Record<BodyId, BodyMeta> {
  return Object.fromEntries(entries.map((e) => [e.id, e.meta])) as Record<BodyId, BodyMeta>;
}

/**
 * Stores metadata for live bodies that have none, whenever a recompute of
 * the current document shows some (ADR-0030): one `nameBodies` command,
 * amended into the latest undo step (the one that made the bodies). A
 * result for an older document is skipped: the recompute of the current
 * one follows. Returns the unsubscribe function.
 */
export function followBodyNames(store: DocumentStore, model: ModelStore<unknown>): () => void {
  const check = () => {
    const { doc: source, bodies, status } = model.getState();
    const { doc } = store.getState();
    if (status !== 'ready' || source !== doc) return;
    const missing = bodyEntries(doc, bodies).filter((e) => !e.stored);
    if (missing.length === 0) return;
    store
      .getState()
      .amend(nameBodies({ bodies: Object.fromEntries(missing.map((e) => [e.id, e.meta])) }));
  };
  check();
  return model.subscribe(check);
}

/** Colour swatches for bodies (ADR-0030); `undefined` is the theme's `body-default`. */
export const BODY_COLORS: readonly { value: string | undefined; label: string }[] = [
  { value: undefined, label: 'Default' },
  { value: '#5b7cff', label: 'Blue' },
  { value: '#22b3c2', label: 'Teal' },
  { value: '#2fbf8f', label: 'Green' },
  { value: '#f2b21b', label: 'Amber' },
  { value: '#ff7a66', label: 'Coral' },
  { value: '#f0609a', label: 'Pink' },
  { value: '#8f75ff', label: 'Violet' },
  { value: '#e9ebf0', label: 'White' },
  { value: '#3b404c', label: 'Charcoal' },
];

/** Opacity presets; 1 (opaque) is stored as no opacity at all. */
export const BODY_OPACITIES: readonly { value: number; label: string }[] = [
  { value: 1, label: 'Opaque' },
  { value: 0.75, label: '75 %' },
  { value: 0.5, label: '50 %' },
  { value: 0.25, label: '25 %' },
];

/**
 * What the browser does to bodies (P2-08): rename, show or hide, colour,
 * opacity, remove (a Remove feature at the timeline marker). Each is one
 * command, so one undo step; a refused one says why through `notify`.
 * Removing waits until an open sketch is finished, like deleting a feature.
 */
export interface BodyActions {
  /** `false` (and a message) if the name is refused. */
  rename(id: BodyId, name: string): boolean;
  /** Shows or hides bodies; several in one undo step (a folder's eye). */
  setVisible(ids: readonly BodyId[], visible: boolean): void;
  /** A swatch's `#rrggbb`, or `undefined` for the default colour. */
  setColor(id: BodyId, color: string | undefined): void;
  /** 0.1…1; 1 is opaque. */
  setOpacity(id: BodyId, opacity: number): void;
  /** Adds a Remove feature for the bodies; returns its ID, or `undefined` if refused. */
  remove(ids: readonly BodyId[]): FeatureId | undefined;
}

export function createBodyActions(
  stores: { store: DocumentStore; session: SessionStore },
  entries: () => readonly BodyEntry[],
  notify: (tone: 'info' | 'error', text: string) => void,
): BodyActions {
  const { store, session } = stores;
  const run = (command: Command<unknown>): boolean => {
    try {
      store.getState().dispatch(command);
      return true;
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      notify('error', error.message);
      return false;
    }
  };
  const entry = (id: BodyId) => entries().find((e) => e.id === id);
  /** Changes for a body, with its name while it isn't stored yet (`updateBody` then creates it). */
  const changes = (e: BodyEntry, more: Partial<BodyMeta>) =>
    e.stored ? more : { name: e.meta.name, ...more };

  return {
    rename(id, name) {
      const e = entry(id);
      if (!e) return false;
      if (e.stored && name.trim() === e.meta.name) return true;
      return run(updateBody({ id, changes: changes(e, { name }) }));
    },
    setVisible(ids, visible) {
      const changed = ids
        .map(entry)
        .filter((e): e is BodyEntry => e !== undefined && e.meta.visible !== visible);
      if (changed.length === 0) return;
      const update = (e: BodyEntry) => updateBody({ id: e.id, changes: changes(e, { visible }) });
      if (changed.length === 1) {
        run(update(changed[0] as BodyEntry));
        return;
      }
      store.getState().beginTransaction(visible ? 'Show bodies' : 'Hide bodies');
      for (const e of changed) run(update(e));
      store.getState().commitTransaction();
    },
    setColor(id, color) {
      const e = entry(id);
      if (!e || e.meta.color === color) return;
      run(
        color === undefined
          ? updateBody({ id, changes: changes(e, {}), clear: ['color'] })
          : updateBody({ id, changes: changes(e, { color }) }),
      );
    },
    setOpacity(id, opacity) {
      const e = entry(id);
      if (!e || (e.meta.opacity ?? 1) === opacity) return;
      run(
        opacity >= 1
          ? updateBody({ id, changes: changes(e, {}), clear: ['opacity'] })
          : updateBody({ id, changes: changes(e, { opacity }) }),
      );
    },
    remove(ids) {
      if (ids.length === 0) return undefined;
      if (session.getState().mode === 'sketch') {
        notify('info', 'Finish the sketch first.');
        return undefined;
      }
      const doc = store.getState().doc;
      const id = newId<FeatureId>();
      const feature = removeBodiesFeatureOf(id, nextFeatureName(doc, 'Remove'), ids);
      if (!run(insertFeature({ feature }))) return undefined;
      // The removed bodies leave the selection and the hover.
      const gone = new Set<string>(ids);
      const s = session.getState();
      const kept = s.selection.filter((item) => !(item.kind === 'body' && gone.has(item.id)));
      if (kept.length !== s.selection.length) s.select(kept, 'replace');
      if (s.hover?.kind === 'body' && gone.has(s.hover.id)) s.setHover(undefined);
      return id;
    },
  };
}
