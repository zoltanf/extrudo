import type { FeatureId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { featureProblem } from './featureStatus';

const id = 'f1' as FeatureId;
const live = { id, suppressed: false };

describe('featureProblem', () => {
  it('shows warnings and errors of active features only', () => {
    const statuses = { f1: { status: 'error' as const, message: 'Profile lost' } };
    expect(featureProblem(live, 0, 1, statuses)).toEqual({
      status: 'error',
      message: 'Profile lost',
    });
    // Rolled back, suppressed: no verdict shown, even if a stale one is stored.
    expect(featureProblem(live, 1, 1, statuses)).toBeUndefined();
    expect(featureProblem({ id, suppressed: true }, 0, 1, statuses)).toBeUndefined();
  });

  it('shows nothing for ok or unknown features', () => {
    expect(featureProblem(live, 0, 1, { f1: { status: 'ok' } })).toBeUndefined();
    expect(featureProblem(live, 0, 1, {})).toBeUndefined();
    expect(featureProblem(live, 0, 1, { f1: { status: 'warning' } })).toEqual({
      status: 'warning',
      message: undefined,
    });
  });
});
