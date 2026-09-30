/**
 * A recompute's first new error becomes a notification (P3-13, ADR-0041's
 * open item): the timeline chip and the status bar show errors in place,
 * but a message that appears while you look elsewhere (a parameter change
 * breaking a feature further down) was easy to miss and gone once fixed.
 * Now the first feature that newly fails, in timeline order, goes into the
 * notification history, quietly (no toast over the view; the bell's badge
 * turns red), with an Edit action while the feature still fails.
 *
 * "New" means a feature that had no error in the last result of this
 * session, or had another message. Only results for the current document
 * count (the model store says which document it computed). A recompute that
 * fails as a whole (the kernel stopped) is noted too, once per message.
 */
import type {
  DocumentStore,
  ExtrudoDocument,
  FeatureId,
  FeatureStatus,
  ModelStore,
} from '@extrudo/core';
import type { ToastOptions } from '../design-system';

export interface NewError {
  feature: FeatureId;
  /** "Extrude2: The cut doesn't touch any body. …" */
  text: string;
}

/**
 * The first feature (timeline order) whose error is new in `next` compared
 * with `previous`, or undefined. A whole failed recompute is not a feature
 * error; the watcher words that apart.
 */
export function firstNewError(
  previous: Readonly<Record<FeatureId, FeatureStatus>> | undefined,
  next: Readonly<Record<FeatureId, FeatureStatus>>,
  doc: Pick<ExtrudoDocument, 'features'>,
): NewError | undefined {
  for (const feature of doc.features) {
    const now = next[feature.id];
    if (now?.status !== 'error') continue;
    const was = previous?.[feature.id];
    if (was?.status === 'error' && was.message === now.message) continue;
    const message = now.message ?? 'It has an error.';
    return { feature: feature.id, text: `${feature.name}: ${message}` };
  }
  return undefined;
}

export interface RecomputeErrorWatch<TBody> {
  store: DocumentStore;
  model: ModelStore<TBody>;
  notify(tone: 'error', text: string, options?: ToastOptions): void;
  /** Opens the feature's dialog or sketch; `false` if it can't be edited. */
  edit(id: FeatureId): boolean;
  /** Whether `edit` can open this feature now. */
  canEdit(id: FeatureId): boolean;
}

/** Watches the model store; returns the unsubscribe. */
export function watchRecomputeErrors<TBody>(watch: RecomputeErrorWatch<TBody>): () => void {
  const { store, model, notify } = watch;
  let previous: Record<FeatureId, FeatureStatus> | undefined;
  let failed: string | undefined;
  const failing = (id: FeatureId) => model.getState().features[id]?.status === 'error';
  const check = (s: ReturnType<typeof model.getState>) => {
    const doc = store.getState().doc;
    // A failed recompute doesn't say which document it was for: it is news either way.
    if (s.status === 'failed') {
      if (s.error && s.error !== failed)
        notify('error', `The model couldn't be computed: ${s.error}`, { quiet: true });
      failed = s.error;
      return;
    }
    if (s.status !== 'ready' || s.doc !== doc) return;
    failed = undefined;
    const found = firstNewError(previous, s.features, doc);
    previous = s.features;
    if (!found) return;
    const { feature } = found;
    notify('error', found.text, {
      quiet: true,
      action: {
        label: 'Edit',
        run: () => void watch.edit(feature),
        // While the feature still fails and can be opened.
        available: () => failing(feature) && watch.canEdit(feature),
      },
    });
  };
  check(model.getState());
  return model.subscribe((s, before) => {
    if (s.features !== before.features || s.status !== before.status || s.doc !== before.doc) {
      check(s);
    }
  });
}
