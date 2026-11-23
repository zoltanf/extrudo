// @vitest-environment jsdom
/**
 * Counted renders of the timeline's chips (ADR-0156's amendment of 2026-11-19): a
 * kernel step renders the timeline for the chip it computes; the other chips keep
 * their props and don't render.
 */
import {
  createDocument,
  createDocumentStore,
  createModelStore,
  type Feature,
  type FeatureId,
  originPlaneRef,
  sketchInputs,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../design-system';
import type { FeatureActions } from './featureActions';
import type { GroupActions } from './groupActions';
import { createTimelineSelectionStore } from './timelineGroups';

// A chip looks its tool up once per render: counting the lookups counts the chips' renders.
const looked = vi.hoisted(() => ({ n: 0 }));
vi.mock('./tools', async (importOriginal) => {
  const real = await importOriginal<typeof import('./tools')>();
  return {
    ...real,
    toolForFeature: (type: string) => {
      looked.n++;
      return real.toolForFeature(type);
    },
  };
});
const { Timeline } = await import('./Timeline');

afterEach(cleanup);

/** Every action a no-op (the test only watches renders). */
const stub = <T,>(answers: Record<string, unknown> = {}) =>
  new Proxy({}, { get: (_, key) => answers[key as string] ?? (() => undefined) }) as T;

function thirtySketches() {
  const doc = createDocument();
  const features: Feature[] = Array.from({ length: 30 }, (_, i) => ({
    id: `sk${i}` as FeatureId,
    type: 'sketch',
    name: `Sketch${i + 1}`,
    suppressed: false,
    inputs: sketchInputs(originPlaneRef('origin:xy')),
  }));
  return { ...doc, features, timelineMarker: features.length };
}

describe('Timeline renders', () => {
  it('renders the computing chips on a kernel step, not all thirty', () => {
    const store = createDocumentStore(thirtySketches());
    const model = createModelStore<BodyMesh>();
    const selection = createTimelineSelectionStore();
    render(
      <TooltipProvider>
        <Timeline
          store={store}
          actions={stub<FeatureActions>({ canEdit: () => true })}
          groups={stub<GroupActions>()}
          selection={selection}
          model={model}
        />
      </TooltipProvider>,
    );
    expect(looked.n).toBeGreaterThanOrEqual(30);
    const step = (i: number) =>
      act(() =>
        model
          .getState()
          .setProgress({ done: i + 1, total: 30, feature: `sk${i}` as FeatureId, since: 0 }),
      );
    step(0);
    looked.n = 0;
    // Each step moves "computing" from one chip to the next: those two render.
    for (let i = 1; i < 10; i++) step(i);
    expect(looked.n).toBe(9 * 2);
    // A step that changes nothing a chip shows renders none.
    looked.n = 0;
    act(() =>
      model.getState().setProgress({ done: 10, total: 30, feature: 'sk9' as FeatureId, since: 1 }),
    );
    expect(looked.n).toBe(0);
  });

  it('a chip with an error or a warning keeps its props across kernel steps', () => {
    const store = createDocumentStore(thirtySketches());
    const model = createModelStore<BodyMesh>();
    act(() =>
      model.getState().computed({
        features: {
          ['sk20' as FeatureId]: { status: 'error', message: 'It failed.' },
          ['sk21' as FeatureId]: { status: 'warning', message: 'Look at it.' },
        },
        bodies: {},
      }),
    );
    render(
      <TooltipProvider>
        <Timeline
          store={store}
          actions={stub<FeatureActions>({ canEdit: () => true })}
          groups={stub<GroupActions>()}
          selection={createTimelineSelectionStore()}
          model={model}
        />
      </TooltipProvider>,
    );
    const step = (i: number) =>
      act(() =>
        model
          .getState()
          .setProgress({ done: i + 1, total: 30, feature: `sk${i}` as FeatureId, since: 0 }),
      );
    step(0);
    looked.n = 0;
    for (let i = 1; i < 10; i++) step(i);
    // Only the chips whose "computing" changed: not the two with a problem.
    expect(looked.n).toBe(9 * 2);
  });

  it('an edit inside one feature renders that chip only (ADR-0159 §3)', () => {
    const store = createDocumentStore(thirtySketches());
    const selection = createTimelineSelectionStore();
    render(
      <TooltipProvider>
        <Timeline
          store={store}
          actions={stub<FeatureActions>({ canEdit: () => true })}
          groups={stub<GroupActions>()}
          selection={selection}
        />
      </TooltipProvider>,
    );
    // A sketch's data changed (a dragged point): a new feature list, the same IDs.
    const edit = (i: number) =>
      act(() =>
        store.setState((s) => ({
          doc: {
            ...s.doc,
            features: s.doc.features.map((f, j) =>
              j === i ? { ...f, inputs: { ...f.inputs } } : f,
            ),
          },
        })),
      );
    edit(7);
    looked.n = 0;
    for (let k = 0; k < 10; k++) edit(7);
    expect(looked.n).toBe(10);
    // A new order (two features swapped) still reaches every chip.
    looked.n = 0;
    act(() =>
      store.setState((s) => {
        const features = [...s.doc.features];
        [features[3], features[4]] = [features[4] as Feature, features[3] as Feature];
        return { doc: { ...s.doc, features } };
      }),
    );
    expect(looked.n).toBe(30);
  });

  it('a click still picks the chip, with the latest selection', () => {
    const store = createDocumentStore(thirtySketches());
    const selection = createTimelineSelectionStore();
    const view = render(
      <TooltipProvider>
        <Timeline
          store={store}
          actions={stub<FeatureActions>({ canEdit: () => true })}
          groups={stub<GroupActions>()}
          selection={selection}
        />
      </TooltipProvider>,
    );
    const chip = (i: number) =>
      view.container.querySelector(`[data-feature-id="sk${i}"]`) as HTMLElement;
    act(() => chip(3).click());
    expect(selection.getState().chips).toEqual(['sk3']);
    act(() => chip(5).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })));
    expect(selection.getState().chips).toEqual(['sk3', 'sk5']);
    act(() => chip(3).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })));
    expect(selection.getState().chips).toEqual(['sk5']);
  });

  it('clicks pick with the latest selection after an outside pick and kernel steps', () => {
    const store = createDocumentStore(thirtySketches());
    const model = createModelStore<BodyMesh>();
    const selection = createTimelineSelectionStore();
    const view = render(
      <TooltipProvider>
        <Timeline
          store={store}
          actions={stub<FeatureActions>({ canEdit: () => true })}
          groups={stub<GroupActions>()}
          selection={selection}
          model={model}
        />
      </TooltipProvider>,
    );
    const chip = (i: number) =>
      view.container.querySelector(`[data-feature-id="sk${i}"]`) as HTMLElement;
    const click = (i: number, o: MouseEventInit = {}) =>
      act(() => chip(i).dispatchEvent(new MouseEvent('click', { bubbles: true, ...o })));
    const step = (i: number) =>
      act(() =>
        model
          .getState()
          .setProgress({ done: i + 1, total: 30, feature: `sk${i}` as FeatureId, since: 0 }),
      );
    click(2);
    step(4);
    // An outside pick (the marking menu, the view) replaces the chips.
    act(() => selection.getState().pick(['sk6' as FeatureId]));
    step(5);
    click(8, { ctrlKey: true });
    expect(selection.getState().chips).toEqual(['sk6', 'sk8']);
    click(5, { shiftKey: true });
    // A run from the anchor (sk8, the last plain or Ctrl click) to sk5.
    expect([...selection.getState().chips].sort()).toEqual(['sk5', 'sk6', 'sk7', 'sk8']);
    // A rename: the chip's label follows.
    act(() =>
      store.setState((s) => ({
        doc: {
          ...s.doc,
          features: s.doc.features.map((f) => (f.id === 'sk1' ? { ...f, name: 'Renamed' } : f)),
        },
      })),
    );
    expect(chip(1).getAttribute('aria-label')).toBe('Renamed');
    expect(chip(8).getAttribute('data-selected')).toBe('true');
  });
});
