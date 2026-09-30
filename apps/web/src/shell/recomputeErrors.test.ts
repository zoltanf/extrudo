import {
  createDocument,
  createDocumentStore,
  createModelStore,
  type Feature,
  type FeatureId,
  type FeatureStatus,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import type { ToastOptions } from '../design-system';
import { firstNewError, watchRecomputeErrors } from './recomputeErrors';

const feature = (id: string, name: string): Feature => ({
  id: id as FeatureId,
  type: 'extrude',
  name,
  suppressed: false,
  inputs: {},
});

function setup() {
  const doc = {
    ...createDocument({ name: 'Box' }),
    features: [feature('a', 'Sketch1'), feature('b', 'Extrude1'), feature('c', 'Extrude2')],
  };
  doc.timelineMarker = 3;
  const store = createDocumentStore(doc);
  const model = createModelStore<unknown>();
  const sent: { text: string; options?: ToastOptions }[] = [];
  const edited: FeatureId[] = [];
  const stop = watchRecomputeErrors({
    store,
    model,
    notify: (_tone, text, options) => sent.push({ text, ...(options && { options }) }),
    edit: (id) => {
      edited.push(id);
      return true;
    },
    canEdit: () => true,
  });
  const computed = (features: Record<string, FeatureStatus>) =>
    model.getState().computed({
      features: features as Record<FeatureId, FeatureStatus>,
      bodies: {},
      doc: store.getState().doc,
    });
  return { store, model, sent, edited, stop, computed, doc };
}

const ok: FeatureStatus = { status: 'ok' };
const error = (message: string): FeatureStatus => ({ status: 'error', message });

describe('firstNewError (P3-13)', () => {
  it('is the first feature in timeline order that newly fails', () => {
    const { doc } = setup();
    const next = { b: error('B broke.'), c: error('C broke.') } as Record<FeatureId, FeatureStatus>;
    expect(firstNewError(undefined, next, doc)).toEqual({
      feature: 'b',
      text: 'Extrude1: B broke.',
    });
    // B failed before with the same message: C is the new one.
    const before = { b: error('B broke.') } as Record<FeatureId, FeatureStatus>;
    expect(firstNewError(before, next, doc)?.feature).toBe('c');
    // Another message counts as new.
    const other = { b: error('B broke differently.') } as Record<FeatureId, FeatureStatus>;
    expect(firstNewError(before, other, doc)?.text).toBe('Extrude1: B broke differently.');
    expect(firstNewError(next, next, doc)).toBeUndefined();
  });
});

describe('watchRecomputeErrors (P3-13)', () => {
  it('notifies the first new error quietly, once, with an Edit action while it still fails', () => {
    const { sent, edited, computed } = setup();
    computed({ a: ok, b: ok, c: ok });
    expect(sent).toEqual([]);
    computed({ a: ok, b: error('No profile.'), c: error('Needs Extrude1.') });
    expect(sent.map((s) => s.text)).toEqual(['Extrude1: No profile.']);
    const action = sent[0]?.options?.action;
    expect(sent[0]?.options?.quiet).toBe(true);
    expect(action?.label).toBe('Edit');
    expect(action?.available?.()).toBe(true);
    action?.run();
    expect(edited).toEqual(['b']);
    // The same errors again: nothing new.
    computed({ a: ok, b: error('No profile.'), c: error('Needs Extrude1.') });
    expect(sent).toHaveLength(1);
    // Fixed: the action no longer applies.
    computed({ a: ok, b: ok, c: ok });
    expect(action?.available?.()).toBe(false);
    // Broken again later: new again.
    computed({ a: ok, b: error('No profile.'), c: ok });
    expect(sent).toHaveLength(2);
  });

  it('ignores results for another document, and notes a failed recompute once', () => {
    const { sent, model, store, stop } = setup();
    model.getState().computed({
      features: { b: error('Stale.') } as Record<FeatureId, FeatureStatus>,
      bodies: {},
      doc: { ...store.getState().doc, name: 'Older' },
    });
    expect(sent).toEqual([]);
    model.getState().failed('The kernel stopped.');
    model.getState().computing();
    model.getState().failed('The kernel stopped.');
    expect(sent.map((s) => s.text)).toEqual([
      "The model couldn't be computed: The kernel stopped.",
    ]);
    stop();
    model.getState().failed('Again.');
    expect(sent).toHaveLength(1);
  });
});
