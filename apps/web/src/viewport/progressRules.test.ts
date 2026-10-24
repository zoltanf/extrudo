import { describe, expect, it } from 'vitest';
import {
  activeFeatureCount,
  progressBar,
  progressDetail,
  progressMode,
  progressTitle,
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
      text: 'Thread1 · 4 of 7',
    });
  });
});
