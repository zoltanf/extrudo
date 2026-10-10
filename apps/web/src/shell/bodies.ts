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
  addComponent,
  type BodyId,
  type BodyMeta,
  type BodyOrigins,
  bodyDisplay,
  type Command,
  CommandError,
  type Component,
  type ComponentId,
  componentOfBody,
  type DocumentStore,
  type ExtrudoDocument,
  effectiveBodyDisplay,
  type FeatureId,
  insertFeature,
  type ModelState,
  type ModelStore,
  nameBodies,
  newBodyNames,
  newId,
  nextFeatureName,
  removeBodiesFeatureOf,
  type SessionStore,
  setBodyComponent,
  updateBody,
} from '@extrudo/core';

/** How a body is shown (ADR-0030's amendment, 2026-10-09): shown, ghost or hidden. */
export type BodyDisplay = 'shown' | 'ghost' | 'hidden';

/** The body row's eye cycles through the states in this order (ADR-0030's amendment). */
export function nextBodyDisplay(display: BodyDisplay): BodyDisplay {
  return display === 'shown' ? 'ghost' : display === 'ghost' ? 'hidden' : 'shown';
}

/** The body eye's label: what a click does next (the visible next state). */
export function bodyEyeLabel(display: BodyDisplay): string {
  return display === 'shown' ? 'Show as ghost' : display === 'ghost' ? 'Hide' : 'Show';
}

export interface BodyEntry {
  id: BodyId;
  meta: BodyMeta;
  /** Whether `meta` is stored in the document (false: the name it is about to get). */
  stored: boolean;
  /**
   * The body is a mesh, not a solid (P4-06, ADR-0066 §3): triangles from an
   * imported file, which the view draws and the browser tags "Mesh". It comes
   * from the body's mesh (`BodyMesh.mesh`), so it follows what the kernel
   * computed.
   */
  mesh?: boolean;
  /**
   * Listed from the model cache before the first recompute has finished
   * (ADR-0078): the body is expected, not computed yet. Its row has no
   * selection, menu or appearance, only the eye.
   */
  pending?: boolean;
  /**
   * The component the body belongs to (ADR-0081 §2's rule: stored metadata, else its
   * source's, else the making feature's stamp); absent: loose.
   */
  component?: ComponentId;
  /**
   * How the body is drawn (ADR-0081 §6): its own state, overridden by a hidden or
   * ghost component. `meta` keeps the body's own state underneath.
   */
  display: BodyDisplay;
}

/** The document pieces entries need: bodies, features and the components. */
type EntryDoc = Pick<ExtrudoDocument, 'bodies' | 'features'> &
  Partial<Pick<ExtrudoDocument, 'components'>>;

const componentById = (doc: EntryDoc, id: ComponentId | undefined): Component | undefined =>
  id === undefined ? undefined : doc.components?.find((c) => c.id === id);

/**
 * The bodies the last finished recompute made (the model cache's IDs), as rows
 * the browser can list before the kernel has answered (ADR-0078). The name
 * and look come from the stored `doc.bodies` metadata; an ID with none is
 * skipped (it never got a name, so there is nothing true to show).
 */
export function pendingBodyEntries(doc: EntryDoc, ids: readonly string[]): BodyEntry[] {
  const known = (ids as readonly BodyId[]).filter((id) => doc.bodies[id]);
  return sortBodyIds(doc, known).map((id) => {
    const meta = doc.bodies[id] as BodyMeta;
    return {
      id,
      meta,
      stored: true,
      pending: true,
      ...(meta.component !== undefined && { component: meta.component }),
      display: effectiveBodyDisplay(meta, componentById(doc, meta.component)),
    };
  });
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
  doc: EntryDoc,
  live: Readonly<Record<BodyId, unknown>>,
  origins?: BodyOrigins,
): BodyEntry[] {
  const ids = sortBodyIds(doc, Object.keys(live) as BodyId[]);
  const names = newBodyNames(
    doc,
    ids.filter((id) => !doc.bodies[id]),
  );
  return ids.map((id) => {
    const stored = doc.bodies[id];
    const mesh = (live[id] as { mesh?: boolean } | undefined)?.mesh === true;
    const component = componentOfBody(doc, id, origins);
    const meta: BodyMeta = stored ?? { name: names[id] as string, visible: true };
    return {
      id,
      meta,
      stored: stored !== undefined,
      ...(mesh && { mesh: true }),
      ...(component !== undefined && { component }),
      display: effectiveBodyDisplay(meta, componentById(doc, component)),
    };
  });
}

/**
 * The metadata of every live body (names about to be stored included), for the view, with
 * a hidden or ghost component's state applied (`BodyEntry.display`, ADR-0081 §6).
 */
export function bodyMetaOf(entries: readonly BodyEntry[]): Record<BodyId, BodyMeta> {
  return Object.fromEntries(
    entries.map((e) => {
      if (bodyDisplay(e.meta) === e.display) return [e.id, e.meta];
      const { ghost: _ghost, ...rest } = e.meta;
      const meta: BodyMeta =
        e.display === 'ghost'
          ? { ...rest, visible: false, ghost: true }
          : { ...rest, visible: e.display === 'shown' };
      return [e.id, meta];
    }),
  ) as Record<BodyId, BodyMeta>;
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
    const state = model.getState();
    const { doc: source, bodies, status, imports } = state;
    const { doc } = store.getState();
    if (status !== 'ready' || source !== doc) return;
    // The kernel's `origins`: the pieces a body was broken into follow it (ADR-0081 §2).
    const missing = bodyEntries(doc, bodies, state.origins).filter((e) => !e.stored);
    if (missing.length === 0) return;
    const colors = importedColors(imports);
    store.getState().amend(
      nameBodies({
        bodies: Object.fromEntries(
          missing.map((e) => {
            const color = colors.get(e.id);
            const meta: BodyMeta = {
              ...e.meta,
              ...(color !== undefined && { color }),
              ...(e.component !== undefined && { component: e.component }),
            };
            return [e.id, meta];
          }),
        ),
      }),
    );
  };
  check();
  return model.subscribe(check);
}

/**
 * The colours STEP imports report for their bodies (P4-12, ADR-0034's
 * amendment). `followBodyNames` gives a body its file's colour only when it
 * first names it: a body with stored metadata (named, recoloured, or simply
 * shown before) keeps what the document says, so a recompute, a re-import
 * or a change of Up never repaints it.
 */
export function importedColors(
  imports: ModelState<unknown>['imports'] | undefined,
): Map<BodyId, string> {
  const out = new Map<BodyId, string>();
  for (const report of Object.values(imports ?? {})) {
    for (const [id, color] of Object.entries(report.colors) as [BodyId, string][]) {
      const parsed = parseBodyColor(color);
      if (parsed) out.set(id, parsed);
    }
  }
  return out;
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

/**
 * A colour typed into Appearance's custom field (P3-17) as the document stores it: `#rrggbb`
 * in lower case. Takes `#rgb` and `#rrggbb`, with or without the `#`, around spaces; anything
 * else is `undefined`.
 */
export function parseBodyColor(text: string): string | undefined {
  const hex = text.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((c) => c + c).join('')}`;
  return undefined;
}

/** Whether a stored colour is one of the swatches (else the custom field shows it). */
export function isSwatch(color: string | undefined): boolean {
  return BODY_COLORS.some((c) => c.value === color);
}

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
  /** Shows or hides bodies; several in one undo step (a folder's eye). Shown clears a ghost. */
  setVisible(ids: readonly BodyId[], visible: boolean): void;
  /**
   * Sets a body's display state (ADR-0030's amendment): shown, ghost (a grey
   * see-through shape that takes no part in anything) or hidden. Several in one
   * undo step; the label is "Show/Ghost/Hide body" (plural for several).
   */
  setDisplay(ids: readonly BodyId[], display: BodyDisplay): void;
  /** A swatch's `#rrggbb`, or `undefined` for the default colour. */
  setColor(id: BodyId, color: string | undefined): void;
  /** 0.1…1; 1 is opaque. */
  setOpacity(id: BodyId, opacity: number): void;
  /** Adds a Remove feature for the bodies; returns its ID, or `undefined` if refused. */
  remove(ids: readonly BodyId[]): FeatureId | undefined;
  /** Opens the export with these bodies (P2-12); absent where there is no export. */
  exportBodies?(ids: readonly BodyId[]): void;
  /** Puts bodies into a component, or (`null`) takes them out of theirs: one undo step. */
  moveToComponent(ids: readonly BodyId[], component: ComponentId | null): void;
  /** Makes a component of the bodies (none: an empty one) and returns its ID. */
  newComponent(ids: readonly BodyId[]): ComponentId | undefined;
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
  /**
   * The `updateBody` call for one display state. Shown deletes a ghost through
   * the command's pair rule; hidden clears it (`clear: ['ghost']`), so a ghost
   * that is hidden (or shown) stops being one.
   */
  const displayChange = (e: BodyEntry, display: BodyDisplay) => {
    const base = changes(e, {});
    if (display === 'shown') return updateBody({ id: e.id, changes: { ...base, visible: true } });
    if (display === 'ghost') {
      return updateBody({ id: e.id, changes: { ...base, visible: false, ghost: true } });
    }
    return updateBody({ id: e.id, changes: { ...base, visible: false }, clear: ['ghost'] });
  };
  const setDisplay = (ids: readonly BodyId[], display: BodyDisplay) => {
    const changed = ids
      .map(entry)
      .filter((e): e is BodyEntry => e !== undefined && bodyDisplay(e.meta) !== display);
    if (changed.length === 0) return;
    if (changed.length === 1) {
      run(displayChange(changed[0] as BodyEntry, display));
      return;
    }
    const verb = { shown: 'Show', ghost: 'Ghost', hidden: 'Hide' }[display];
    store.getState().beginTransaction(`${verb} ${changed.length > 1 ? 'bodies' : 'body'}`);
    for (const e of changed) run(displayChange(e, display));
    store.getState().commitTransaction();
  };

  return {
    rename(id, name) {
      const e = entry(id);
      if (!e) return false;
      if (e.stored && name.trim() === e.meta.name) return true;
      return run(updateBody({ id, changes: changes(e, { name }) }));
    },
    setVisible(ids, visible) {
      // A folder's eye is two-state (ADR-0030's amendment); showing all clears
      // ghosts too, which `setDisplay('shown')` does.
      setDisplay(ids, visible ? 'shown' : 'hidden');
    },
    setDisplay,
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
    moveToComponent(ids, component) {
      if (ids.length === 0) return;
      run(setBodyComponent({ ids, component }));
    },
    newComponent(ids) {
      const id = newId<ComponentId>();
      return run(addComponent({ id, bodies: ids })) ? id : undefined;
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

/**
 * What an empty Bodies folder says (ADR-0078's amendment): "computing" while the first recompute
 * of the page hasn't finished and the design has features to compute, else "none".
 */
export function bodiesEmptyState(input: {
  listed: number;
  finished: boolean;
  activeFeatures: number;
}): 'computing' | 'none' {
  return input.listed === 0 && !input.finished && input.activeFeatures > 0 ? 'computing' : 'none';
}
