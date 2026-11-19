// @vitest-environment jsdom
// The opening notice names the running feature and counts its seconds
// (ADR-0105's amendment of 2026-11-19).
import {
  createDocument,
  createDocumentStore,
  createModelStore,
  type FeatureId,
} from '@extrudo/core';
import { act, cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureSeconds, ModelProgress } from './ModelProgress';

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
