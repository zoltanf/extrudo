import { describe, expect, it } from 'vitest';
import {
  activeFeatureCount,
  featureSeconds,
  LONG_FEATURE_MS,
  longFeatureIn,
  longFeatureMs,
  nextTickIn,
  progressBar,
  progressDetail,
  progressMode,
  progressTitle,
  SECONDS_FROM,
  showsBar,
  showsCancel,
  showsStop,
  UPDATING_AFTER_MS,
  WAITING_AFTER_MS,
  type WaitInput,
} from './progressRules';

const wait = (over: Partial<WaitInput> = {}): WaitInput => ({
  label: 'Reading the pick…',
  others: 0,
  elapsed: WAITING_AFTER_MS + 1,
  quiet: false,
  ...over,
});

describe('progressMode', () => {
  it('is preparing until a recompute has finished, however short it has run', () => {
    expect(progressMode({ status: 'idle', finished: false, elapsed: 0 })).toBe('preparing');
    expect(progressMode({ status: 'computing', finished: false, elapsed: 10 })).toBe('preparing');
  });
  it('is updating only after 800 ms of a later recompute', () => {
    expect(progressMode({ status: 'computing', finished: true, elapsed: 0 })).toBeUndefined();
    expect(
      progressMode({ status: 'computing', finished: true, elapsed: UPDATING_AFTER_MS }),
    ).toBeUndefined();
    expect(
      progressMode({ status: 'computing', finished: true, elapsed: UPDATING_AFTER_MS + 1 }),
    ).toBe('updating');
  });
  it('is waiting only after 300 ms, even once the kernel is ready', () => {
    expect(
      progressMode({ status: 'ready', finished: true, elapsed: 0, wait: wait({ elapsed: 100 }) }),
    ).toBeUndefined();
    expect(
      progressMode({
        status: 'ready',
        finished: true,
        elapsed: 0,
        wait: wait({ elapsed: WAITING_AFTER_MS }),
      }),
    ).toBeUndefined();
    expect(
      progressMode({
        status: 'ready',
        finished: true,
        elapsed: 0,
        wait: wait({ elapsed: WAITING_AFTER_MS + 1 }),
      }),
    ).toBe('waiting');
  });
  it('lets a recompute win over a wait', () => {
    expect(progressMode({ status: 'computing', finished: false, elapsed: 0, wait: wait() })).toBe(
      'preparing',
    );
    expect(
      progressMode({
        status: 'computing',
        finished: true,
        elapsed: UPDATING_AFTER_MS + 1,
        wait: wait(),
      }),
    ).toBe('updating');
  });
  it('is hidden once ready or failed when nothing runs', () => {
    for (const status of ['ready', 'failed'] as const) {
      expect(progressMode({ status, finished: false, elapsed: 5000 })).toBeUndefined();
      expect(progressMode({ status, finished: true, elapsed: 5000 })).toBeUndefined();
    }
  });
});

describe('activeFeatureCount and texts', () => {
  const f = (suppressed: boolean) => ({ suppressed }) as never;
  it('counts features before the marker that are not suppressed', () => {
    expect(
      activeFeatureCount({ features: [f(false), f(true), f(false), f(false)], timelineMarker: 3 }),
    ).toBe(2);
  });
  it('words the title of every mode', () => {
    expect(progressTitle('preparing')).toBe('Preparing your design…');
    expect(progressTitle('updating')).toBe('Updating the model…');
    expect(progressTitle('waiting', wait({ label: 'Measuring…' }))).toBe('Measuring…');
  });
  it('words the detail of every mode', () => {
    expect(progressDetail('preparing', 1)).toBe('Computing 1 feature');
    expect(progressDetail('updating', 6)).toBe('Computing 6 features');
    expect(progressDetail('waiting', wait({ others: 0 }))).toBe('');
    expect(progressDetail('waiting', wait({ others: 1 }))).toBe('and 1 more');
    expect(progressDetail('waiting', wait({ others: 3 }))).toBe('and 3 more');
  });
  it('builds the recompute bar', () => {
    expect(progressBar({ done: 3, total: 7, name: 'Thread1' })).toEqual({
      value: 3,
      max: 7,
      name: 'Thread1',
      position: '4 of 7',
      text: 'Thread1 · 4 of 7',
    });
  });
});

describe("the bar and the feature's seconds (ADR-0105's amendment of 2026-11-19)", () => {
  it('draws the bar while a design opens and while it updates, once a feature is reported', () => {
    expect(showsBar('preparing', true)).toBe(true);
    expect(showsBar('updating', true)).toBe(true);
    expect(showsBar('preparing', false)).toBe(false);
    expect(showsBar('updating', false)).toBe(false);
    expect(showsBar('waiting', true)).toBe(false);
  });
  it('counts whole seconds from SECONDS_FROM on', () => {
    expect(SECONDS_FROM).toBe(3);
    expect(featureSeconds(10_000, 10_000)).toBeUndefined();
    expect(featureSeconds(10_000, 12_999)).toBeUndefined();
    expect(featureSeconds(10_000, 13_000)).toBe(3);
    expect(featureSeconds(10_000, 13_999)).toBe(3);
    expect(featureSeconds(10_000, 52_400)).toBe(42);
    // A clock that went back never shows a count.
    expect(featureSeconds(10_000, 9_000)).toBeUndefined();
  });
  it('wakes once per change: first at SECONDS_FROM, then on each whole second', () => {
    expect(nextTickIn(10_000, 10_000)).toBe(3000);
    expect(nextTickIn(10_000, 11_250)).toBe(1750);
    expect(nextTickIn(10_000, 13_000)).toBe(1000);
    expect(nextTickIn(10_000, 13_400)).toBe(600);
    expect(nextTickIn(10_000, 9_000)).toBe(3000);
  });
});

describe('Stop while a design opens (ADR-0155)', () => {
  it('shows while preparing as soon as a feature can be stopped', () => {
    expect(showsStop('preparing', { stoppable: true, long: false })).toBe(true);
    expect(showsStop('preparing', { stoppable: false, long: false })).toBe(false);
    expect(showsStop('waiting', { stoppable: true, long: true })).toBe(false);
  });
  it('in an update only once the feature has taken long, beside Cancel (ADR-0161)', () => {
    expect(showsStop('updating', { stoppable: true, long: false })).toBe(false);
    expect(showsStop('updating', { stoppable: true, long: true })).toBe(true);
    expect(showsStop('updating', { stoppable: false, long: true })).toBe(false);
    // Opening never offers Cancel, so the two meet only in a long update.
    expect(showsCancel('preparing', () => true)).toBe(false);
    expect(
      showsStop('updating', { stoppable: true, long: true }) && showsCancel('updating', () => true),
    ).toBe(true);
  });
  it('at once and alone while a pressed Cancel waits for the running feature (ADR-0161)', () => {
    expect(showsStop('updating', { stoppable: true, long: false, cancelling: true })).toBe(true);
    expect(showsStop('updating', { stoppable: false, long: false, cancelling: true })).toBe(false);
    expect(showsStop('waiting', { stoppable: true, long: false, cancelling: true })).toBe(false);
  });
  it('a Try again or a Stop after the first result shows as preparing, at once', () => {
    const base = { status: 'computing' as const, finished: true, elapsed: 0 };
    expect(progressMode(base)).toBeUndefined();
    expect(progressMode({ ...base, opening: true })).toBe('preparing');
    expect(progressMode({ ...base, status: 'ready', opening: true })).toBeUndefined();
  });
});

describe("the long-feature threshold (ADR-0155's amendment of 2026-11-19)", () => {
  it('is 30 s; a test may only lower it', () => {
    expect(LONG_FEATURE_MS).toBe(30_000);
    expect(longFeatureMs(undefined)).toBe(LONG_FEATURE_MS);
    expect(longFeatureMs(2000)).toBe(2000);
    expect(longFeatureMs(60_000)).toBe(LONG_FEATURE_MS);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '100', null]) {
      expect(longFeatureMs(bad)).toBe(LONG_FEATURE_MS);
    }
  });
  it('counts from the feature start', () => {
    expect(longFeatureIn(10_000, 10_000, 30_000)).toBe(30_000);
    expect(longFeatureIn(10_000, 35_000, 30_000)).toBe(5_000);
    expect(longFeatureIn(10_000, 40_000, 30_000)).toBe(0);
    expect(longFeatureIn(10_000, 99_000, 30_000)).toBe(0);
  });
});

describe('showsCancel (ADR-0111)', () => {
  it('shows only while updating, when the document can go back', () => {
    expect(showsCancel('updating', () => true)).toBe(true);
    expect(showsCancel('updating', () => false)).toBe(false);
    expect(showsCancel('preparing', () => true)).toBe(false);
    expect(showsCancel('waiting', () => true)).toBe(false);
  });
});
