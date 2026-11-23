import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * A function that stays the same object and calls the latest `fn` (ADR-0159 §4). For callbacks
 * the shell hands to many components (the toolbar's `onRun`): a new function on every render
 * of the shell rendered every toolbar tile. The latest `fn` is taken in an insertion effect,
 * which runs before every layout and passive effect of the commit, so those effects (and any
 * event after the commit) call this render's `fn`. Call the result from events and effects,
 * never during a render.
 */
export function useLatest<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  useInsertionEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
