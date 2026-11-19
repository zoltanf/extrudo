// What the notice's Stop says and what its Try again does (ADR-0155).
import { createDocument, createDocumentStore, type Feature, type FeatureId } from '@extrudo/core';
import { describe, expect, it, vi } from 'vitest';
import { STOP_TOAST_MS, type StopKernel, stopAndTell, stoppedText } from './stopFeature';

const store = () =>
  createDocumentStore({
    ...createDocument({ name: 'Stops' }),
    features: [
      { id: 'f1', type: 'box', name: 'Box1', suppressed: false, inputs: {} } as unknown as Feature,
    ],
    timelineMarker: 1,
  });

function kernel(stopped: FeatureId | undefined): StopKernel & { held: Set<FeatureId> } {
  const held = new Set<FeatureId>();
  return {
    held,
    stops: {
      get: () => ({ stopped: [], opening: true, stoppable: true, stopping: false }),
      subscribe: () => () => {},
    },
    stop: vi.fn(async () => {
      if (stopped) held.add(stopped);
      return stopped;
    }),
    retry: vi.fn((id: FeatureId) => held.delete(id)),
    isStopped: (id: FeatureId) => held.has(id),
  };
}

describe('stopAndTell', () => {
  it('says what was stopped and offers Try again while it is still stopped', async () => {
    const k = kernel('f1' as FeatureId);
    const notify = vi.fn();
    expect(await stopAndTell(k, store(), notify)).toBe('f1');
    expect(notify).toHaveBeenCalledTimes(1);
    const [tone, text, options] = notify.mock.calls[0] ?? [];
    expect(tone).toBe('info');
    expect(text).toBe(stoppedText('Box1'));
    expect(text).toBe(
      'Box1 was stopped, so the design opened without it. Nothing in the design changed.',
    );
    expect(options.lifetime).toBe(STOP_TOAST_MS);
    expect(options.action.label).toBe('Try again');
    expect(options.action.available()).toBe(true);
    options.action.run();
    expect(k.retry).toHaveBeenCalledWith('f1');
    // Once tried again, the history's copy of the toast no longer offers it.
    expect(options.action.available()).toBe(false);
  });

  it('says nothing when there was nothing to stop', async () => {
    const notify = vi.fn();
    expect(await stopAndTell(kernel(undefined), store(), notify)).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });
});
