import { describe, expect, it } from 'vitest';
import {
  activeFeatureCount,
  progressDetail,
  progressMode,
  progressTitle,
  UPDATING_AFTER_MS,
} from './progressRules';

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
  it('is hidden once ready or failed', () => {
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
  it('words the notice', () => {
    expect(progressTitle('preparing')).toBe('Preparing your design…');
    expect(progressTitle('updating')).toBe('Updating the model…');
    expect(progressDetail(1)).toBe('Computing 1 feature');
    expect(progressDetail(6)).toBe('Computing 6 features');
  });
});
