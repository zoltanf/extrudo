import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import {
  createTutorialStore,
  readTour,
  requestTutorial,
  TOUR_KEY,
  takeTutorialRequest,
  tourOffered,
  writeTour,
} from './state';

describe('the tour preference', () => {
  it('is offered until it was started, dismissed or finished', () => {
    const preferences = memoryPreferences();
    expect(readTour(preferences)).toBe('new');
    expect(tourOffered(preferences)).toBe(true);
    for (const state of ['started', 'dismissed', 'done'] as const) {
      writeTour(preferences, state);
      expect(preferences.get(TOUR_KEY, '')).toBe(state);
      expect(tourOffered(preferences)).toBe(false);
    }
  });
});

describe('tutorial requests', () => {
  it('are for one project and are taken once', () => {
    requestTutorial('a');
    expect(takeTutorialRequest('b')).toBe(false);
    expect(takeTutorialRequest('a')).toBe(true);
    expect(takeTutorialRequest('a')).toBe(false);
  });
});

describe('the tutorial store', () => {
  it('opens at the first step, closes, and only ever raises the skipped floor', () => {
    const store = createTutorialStore();
    expect(store.getState()).toMatchObject({ open: false, floor: 0 });
    store.getState().start();
    store.getState().skipTo(2);
    store.getState().skipTo(1);
    expect(store.getState()).toMatchObject({ open: true, floor: 2 });
    store.getState().close();
    expect(store.getState().open).toBe(false);
    store.getState().start();
    expect(store.getState()).toMatchObject({ open: true, floor: 0 });
  });
});
