// @vitest-environment jsdom
// The opening notice names the running feature and counts its seconds
// (ADR-0105's amendment of 2026-11-19).
import {
  createDocument,
  createDocumentStore,
  createModelStore,
  type FeatureId,
} from '@extrudo/core';
import type { StopState } from '@extrudo/kernel';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureSeconds, ModelProgress } from './ModelProgress';
import { BUILDING_TEXT, LONG_FEATURE_MS, LONG_FEATURE_TEXT } from './progressRules';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FeatureSeconds', () => {
  it('shows nothing under 3 s, then each whole second, hidden from screen readers', () => {
    const { container } = render(<FeatureSeconds since={Date.now()} />);
    const text = () => container.querySelector('[data-feature-seconds]')?.textContent ?? null;
    act(() => vi.advanceTimersByTime(2999));
    expect(text()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(text()).toBe(' · 3 s');
    expect(container.querySelector('[data-feature-seconds]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(text()).toBe(' · 4 s');
    act(() => vi.advanceTimersByTime(40_000));
    expect(text()).toBe(' · 44 s');
  });

  it('redraws only itself, with one timer while mounted and none after', () => {
    let parentRenders = 0;
    let childRenders = 0;
    function Counted({ since }: { since: number }) {
      childRenders++;
      return <FeatureSeconds since={since} />;
    }
    function Parent() {
      parentRenders++;
      return <Counted since={100_000} />;
    }
    const { unmount } = render(<Parent />);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(10_000));
    // The tick re-renders FeatureSeconds alone: its parents rendered once.
    expect(parentRenders).toBe(1);
    expect(childRenders).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('wakes once per change: at 3 s, then every second', () => {
    const shown: string[] = [];
    render(
      <Profiler
        id="seconds"
        onRender={() =>
          shown.push(document.querySelector('[data-feature-seconds]')?.textContent ?? '')
        }
      >
        <FeatureSeconds since={Date.now()} />
      </Profiler>,
    );
    for (let ms = 0; ms < 10_000; ms += 250) act(() => vi.advanceTimersByTime(250));
    // The mount, then one commit per wake at 3, 4, … 10 s: none in between.
    expect(shown).toEqual(['', ...[3, 4, 5, 6, 7, 8, 9, 10].map((n) => ` · ${n} s`)]);
  });
});

describe('ModelProgress while a design opens', () => {
  function setup(name: string) {
    const id = 'f1' as FeatureId;
    const store = createDocumentStore({
      ...createDocument({ name: 'Notice' }),
      features: [{ id, type: 'box', name, suppressed: false, inputs: {} }],
      timelineMarker: 1,
    });
    const model = createModelStore();
    model.getState().computing();
    const view = render(<ModelProgress model={model} store={store} collapsed={false} />);
    return { ...view, model, id };
  }

  it('says "Computing n features" until a feature is reported, then the bar, the name and the seconds', () => {
    const { container, model, id } = setup('Rectangular Pattern1');
    const notice = () => container.querySelector('[data-model-progress="preparing"]');
    expect(notice()?.textContent).toContain('Computing 1 feature');
    expect(container.querySelector('progress')).toBeNull();
    act(() => model.getState().setProgress({ done: 0, total: 1, feature: id, since: Date.now() }));
    expect(container.querySelector('progress')).not.toBeNull();
    expect(container.querySelector('[data-progress-line]')?.textContent).toBe(
      'Rectangular Pattern1 · 1 of 1',
    );
    act(() => vi.advanceTimersByTime(13_000));
    expect(container.querySelector('[data-progress-line]')?.textContent).toBe(
      'Rectangular Pattern1 · 1 of 1 · 13 s',
    );
    // The live region never carries the count: it sits in an aria-hidden span.
    expect(notice()?.getAttribute('aria-live')).toBe('polite');
    expect(
      container.querySelector('[data-feature-seconds]')?.closest('[aria-hidden]'),
    ).not.toBeNull();
  });

  it('cuts a long name short and keeps the count', () => {
    const long = 'A feature whose name runs on for sixty characters in total';
    expect(long.length).toBeGreaterThanOrEqual(58);
    const name = long.padEnd(60, '.');
    const { container, model, id } = setup(name);
    act(() => model.getState().setProgress({ done: 0, total: 1, feature: id, since: Date.now() }));
    const line = container.querySelector('[data-progress-line]');
    const feature = container.querySelector('[data-progress-feature]');
    expect(line?.className).toContain('max-w-64');
    expect(feature?.className).toContain('truncate');
    expect(feature?.className).toContain('min-w-0');
    expect(feature?.textContent).toBe(name);
    expect(line?.lastElementChild?.textContent).toBe(' · 1 of 1');
  });

  it('runs no timer while no notice shows', () => {
    const { model, id } = setup('Box1');
    act(() => model.getState().setProgress({ done: 0, total: 1, feature: id, since: Date.now() }));
    act(() => model.getState().computed({ features: {}, bodies: {} }));
    act(() => vi.advanceTimersByTime(5000));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Stop while a design opens (ADR-0155)', () => {
  /** A stop store the test moves by hand, like the Recomputer's. */
  function stops(initial: Partial<StopState> = {}) {
    let state: StopState = {
      stopped: [],
      opening: true,
      stoppable: false,
      stopping: false,
      ...initial,
    };
    const listeners = new Set<() => void>();
    return {
      get: () => state,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      set(next: Partial<StopState>) {
        state = { ...state, ...next };
        for (const l of listeners) l();
      },
    };
  }

  function setup(options: { canCancel?: boolean } = {}) {
    const id = 'f1' as FeatureId;
    const store = createDocumentStore({
      ...createDocument({ name: 'Notice' }),
      features: [{ id, type: 'box', name: 'Pattern1', suppressed: false, inputs: {} }],
      timelineMarker: 1,
    });
    const model = createModelStore();
    model.getState().computing();
    const s = stops();
    const run = vi.fn();
    const view = render(
      <>
        <button type="button" data-timeline-item="chip" data-feature-id={id}>
          Pattern1
        </button>
        <ModelProgress
          model={model}
          store={store}
          collapsed={false}
          stop={{ stops: s, run }}
          cancel={{ can: () => options.canCancel ?? false, run: vi.fn() }}
        />
      </>,
    );
    return { ...view, model, id, s, run, store };
  }
  const stopButton = () => screen.queryByRole('button', { name: /^Stop/ });

  it('offers Stop, named for screen readers, only while a feature can be stopped', () => {
    const { model, id, s, run } = setup();
    act(() => model.getState().setProgress({ done: 0, total: 1, feature: id, since: Date.now() }));
    expect(stopButton()).toBeNull();
    act(() => s.set({ stoppable: true }));
    const button = stopButton();
    expect(button?.getAttribute('aria-label')).toBe(
      'Stop: open the design without this feature for now',
    );
    expect(button?.textContent).toBe('Stop');
    // The notice ignores the pointer; the button alone takes it, and the keyboard reaches it.
    expect(button?.className).toContain('pointer-events-auto');
    expect(button?.tabIndex).toBe(0);
    act(() => button?.click());
    expect(run).toHaveBeenCalledTimes(1);
    act(() => s.set({ stoppable: false, stopping: true }));
    expect(stopButton()).toBeNull();
  });

  it('never shows Stop and Cancel together: after the first result it is Cancel alone', () => {
    const { model, id, s, store } = setup({ canCancel: true });
    act(() => model.getState().setProgress({ done: 0, total: 1, feature: id, since: Date.now() }));
    act(() => s.set({ stoppable: true }));
    expect(stopButton()).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Cancel/ })).toBeNull();
    // A result, then an edit's long update: not opening any more.
    act(() => model.getState().computed({ features: {}, bodies: {}, doc: store.getState().doc }));
    act(() => s.set({ opening: false, stoppable: false }));
    act(() => model.getState().computing());
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('button', { name: /^Cancel/ })).not.toBeNull();
    expect(stopButton()).toBeNull();
    // A Try again shows as at open: Stop, no Cancel.
    act(() => s.set({ opening: true, stoppable: true }));
    expect(stopButton()).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Cancel/ })).toBeNull();
  });

  it('hands the focus to the stopped feature’s chip when the button goes', () => {
    const { model, id, s } = setup();
    act(() => model.getState().setProgress({ done: 0, total: 1, feature: id, since: Date.now() }));
    act(() => s.set({ stoppable: true }));
    stopButton()?.focus();
    expect(document.activeElement).toBe(stopButton());
    act(() => s.set({ stoppable: false, stopping: true }));
    expect(document.activeElement?.getAttribute('data-feature-id')).toBe(id);
  });
});

describe("a long feature and the model's last step (ADR-0155's amendment of 2026-11-19)", () => {
  function setup() {
    const ids = ['f1', 'f2'] as FeatureId[];
    const store = createDocumentStore({
      ...createDocument({ name: 'Notice' }),
      features: ids.map((id, i) => ({
        id,
        type: 'box',
        name: `Pattern${i + 1}`,
        suppressed: false,
        inputs: {},
      })),
      timelineMarker: 2,
    });
    const model = createModelStore();
    model.getState().computing();
    let state: StopState = { stopped: [], opening: true, stoppable: true, stopping: false };
    const listeners = new Set<() => void>();
    const stops = {
      get: () => state,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const set = (next: Partial<StopState>) =>
      act(() => {
        state = { ...state, ...next };
        for (const l of listeners) l();
      });
    const view = render(
      <ModelProgress
        model={model}
        store={store}
        collapsed={false}
        stop={{ stops, run: vi.fn() }}
      />,
    );
    const report = (feature: FeatureId, more: { building?: boolean; since?: number } = {}) =>
      act(() =>
        model.getState().setProgress({
          done: ids.indexOf(feature),
          total: 2,
          feature,
          since: more.since ?? Date.now(),
          ...(more.building && { building: true }),
        }),
      );
    return { ...view, ids, report, set };
  }
  const stop = () => document.querySelector('[data-model-stop]');
  const sentence = () => document.querySelectorAll('[data-feature-long]');

  afterEach(() => {
    delete window.__extrudoLongFeatureMs;
  });

  it('fills Stop and adds the sentence 30 s after the feature started, not before', () => {
    const { ids, report } = setup();
    report(ids[0] as FeatureId);
    act(() => vi.advanceTimersByTime(LONG_FEATURE_MS - 1));
    expect(stop()?.getAttribute('data-model-stop')).toBe('quiet');
    expect(sentence()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(stop()?.getAttribute('data-model-stop')).toBe('long');
    expect(stop()?.className).toContain('bg-accent');
    expect(sentence()).toHaveLength(1);
    expect(sentence()[0]?.textContent).toBe(LONG_FEATURE_TEXT);
    // In the polite live region, as plain text: read once, not each second (the seconds are hidden).
    expect(sentence()[0]?.closest('[aria-live="polite"]')).not.toBeNull();
    expect(sentence()[0]?.closest('[aria-hidden]')).toBeNull();
    const node = sentence()[0];
    act(() => vi.advanceTimersByTime(10_000));
    expect(sentence()[0]).toBe(node);
    expect(sentence()[0]?.textContent).toBe(LONG_FEATURE_TEXT);
  });

  it('counts from the feature start, not from the notice: a feature 25 s in turns long 5 s later', () => {
    const { ids, report } = setup();
    report(ids[0] as FeatureId, { since: Date.now() - 25_000 });
    act(() => vi.advanceTimersByTime(4_999));
    expect(sentence()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(sentence()).toHaveLength(1);
  });

  it('starts over with the next feature', () => {
    const { ids, report } = setup();
    report(ids[0] as FeatureId);
    act(() => vi.advanceTimersByTime(LONG_FEATURE_MS));
    expect(sentence()).toHaveLength(1);
    report(ids[1] as FeatureId);
    expect(sentence()).toHaveLength(0);
    expect(stop()?.getAttribute('data-model-stop')).toBe('quiet');
  });

  it('runs no timer for it while Stop is not offered, and never while building the model', () => {
    const { ids, report, set } = setup();
    set({ stoppable: false });
    report(ids[0] as FeatureId);
    // The seconds' and the notice's own timers, none for the long feature...
    const without = vi.getTimerCount();
    // ...which adds exactly one while Stop is offered.
    set({ stoppable: true });
    expect(vi.getTimerCount()).toBe(without + 1);
    set({ stoppable: false });
    expect(vi.getTimerCount()).toBe(without);
    act(() => vi.advanceTimersByTime(LONG_FEATURE_MS * 2));
    expect(sentence()).toHaveLength(0);
    set({ stoppable: false });
    report(ids[1] as FeatureId, { building: true, since: Date.now() - LONG_FEATURE_MS * 2 });
    expect(sentence()).toHaveLength(0);
    expect(stop()).toBeNull();
  });

  it('says "Building the model…" past the last feature: no name, no seconds, the bar full', () => {
    const { ids, report, set } = setup();
    report(ids[1] as FeatureId);
    act(() => vi.advanceTimersByTime(5000));
    set({ stoppable: false });
    report(ids[1] as FeatureId, { building: true });
    expect(document.querySelector('[data-progress-building]')?.textContent).toBe(BUILDING_TEXT);
    expect(document.querySelector('[data-progress-line]')).toBeNull();
    expect(document.querySelector('[data-feature-seconds]')).toBeNull();
    const bar = document.querySelector('progress');
    expect(bar?.getAttribute('value')).toBe(bar?.getAttribute('max'));
    expect(stop()).toBeNull();
  });

  it('lets a test lower the threshold, never raise it', () => {
    window.__extrudoLongFeatureMs = 1000;
    const { ids, report } = setup();
    report(ids[0] as FeatureId);
    act(() => vi.advanceTimersByTime(1000));
    expect(sentence()).toHaveLength(1);
    cleanup();
    window.__extrudoLongFeatureMs = 120_000;
    const again = setup();
    again.report(again.ids[0] as FeatureId);
    act(() => vi.advanceTimersByTime(LONG_FEATURE_MS));
    expect(sentence()).toHaveLength(1);
  });
});
