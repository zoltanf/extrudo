import type { DocumentStore, SessionStore } from '@extrudo/core';
import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import type { Preferences } from '../platform';
import { createTutorialStore, readTour, takeTutorialRequest, writeTour } from './state';
import { currentStep, TUTORIAL_STEPS, type TutorialFacts, type TutorialStep } from './tutorial';

export interface Tutorial {
  open: boolean;
  /** The step showing, `TUTORIAL_STEPS.length` once every step is done. */
  index: number;
  step: TutorialStep | undefined;
  finished: boolean;
  facts: TutorialFacts;
  /** Opens the tour on this design from its first step. */
  start(): void;
  /** Closes the card; a tour that was started and not finished isn't offered again. */
  close(): void;
  /** Moves past the step that shows now. */
  skip(): void;
}

/**
 * The tutorial of an open project (P3-12): its card state, which step the
 * design is at, and the preference that remembers the tour was started or
 * finished. A project the home screen opened for the tour (`requestTutorial`)
 * starts it as soon as it has loaded.
 */
export function useTutorial(options: {
  store: DocumentStore;
  session: SessionStore;
  preferences: Preferences;
}): Tutorial {
  const { store, session, preferences } = options;
  const tutorial = useMemo(() => createTutorialStore(), []);
  const { open, floor } = useStore(tutorial);
  const doc = useStore(store, (s) => s.doc);
  const mode = useStore(session, (s) => s.mode);
  const activeTool = useStore(session, (s) => s.activeTool);
  const facts = useMemo<TutorialFacts>(() => ({ doc, mode, activeTool }), [doc, mode, activeTool]);
  const index = currentStep(facts, floor);
  const finished = index >= TUTORIAL_STEPS.length;

  const start = useMemo(
    () => () => {
      tutorial.getState().start();
      writeTour(preferences, 'started');
    },
    [tutorial, preferences],
  );
  const id = doc.id;
  useEffect(() => {
    if (takeTutorialRequest(id)) start();
  }, [id, start]);

  // Finishing is remembered once, however the tour ended (the card closed or not).
  useEffect(() => {
    if (open && finished) writeTour(preferences, 'done');
  }, [open, finished, preferences]);

  return {
    open,
    index,
    step: TUTORIAL_STEPS[index],
    finished,
    facts,
    start,
    close: () => {
      tutorial.getState().close();
      if (readTour(preferences) === 'started') writeTour(preferences, 'dismissed');
    },
    skip: () => tutorial.getState().skipTo(index + 1),
  };
}
