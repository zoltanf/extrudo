/**
 * What the onboarding remembers (P3-12, ADR-0052). The tour's progress is
 * never stored: it is read from the design (`tutorial.ts`). Only two things
 * outlive the page: whether the tour was offered, started, dismissed or
 * finished (a preference), and, between the home screen and the project it
 * opens, a request to start the tour there.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Preferences } from '../platform';

/** `new`: never offered; the home screen shows its card. */
export type TourState = 'new' | 'started' | 'dismissed' | 'done';

export const TOUR_KEY = 'onboarding.tour';

export const readTour = (preferences: Preferences): TourState =>
  preferences.get<TourState>(TOUR_KEY, 'new');

export const writeTour = (preferences: Preferences, state: TourState) =>
  preferences.set(TOUR_KEY, state);

/** Whether the home screen offers the tour: it hasn't been started, dismissed or finished. */
export const tourOffered = (preferences: Preferences) => readTour(preferences) === 'new';

const requested = new Set<string>();

/** Asks the project that opens next, `id`, to start the tutorial. */
export function requestTutorial(id: string): void {
  requested.add(id);
}

/** Whether `id` was asked to start the tutorial, once. */
export function takeTutorialRequest(id: string): boolean {
  return requested.delete(id);
}

/** The tutorial card's own state: open or not, and how many steps were skipped. */
export interface TutorialState {
  open: boolean;
  /** Steps before this one were skipped by hand. */
  floor: number;
  start(): void;
  close(): void;
  /** Moves past the step that shows now. */
  skipTo(floor: number): void;
}

export type TutorialStore = StoreApi<TutorialState>;

export function createTutorialStore(): TutorialStore {
  return createStore<TutorialState>()((set) => ({
    open: false,
    floor: 0,
    start: () => set({ open: true, floor: 0 }),
    close: () => set({ open: false }),
    skipTo: (floor) => set((s) => ({ floor: Math.max(s.floor, floor) })),
  }));
}
