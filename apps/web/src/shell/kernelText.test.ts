import { describe, expect, it } from 'vitest';
import { kernelText } from './kernelText';

describe('kernelText', () => {
  it('names each kernel state', () => {
    expect(kernelText('idle', undefined, undefined)).toBe('kernel starting');
    expect(kernelText('computing', undefined, undefined)).toBe('computing…');
    expect(kernelText('failed', undefined, undefined)).toBe('kernel stopped');
    expect(kernelText('ready', undefined, undefined)).toBe('computed');
  });
  it('shows the running recompute position when the store has one (ADR-0105 §3)', () => {
    expect(kernelText('computing', undefined, { done: 3, total: 7, feature: 'f1' as never })).toBe(
      'computing 4/7',
    );
  });
  it('rounds the last recompute to whole ms above 10 ms', () => {
    expect(kernelText('ready', { ms: 4.25, evaluated: 1, reused: 0 }, undefined)).toBe(
      'computed in 4.3 ms',
    );
    expect(kernelText('ready', { ms: 42.6, evaluated: 1, reused: 0 }, undefined)).toBe(
      'computed in 43 ms',
    );
  });
});
