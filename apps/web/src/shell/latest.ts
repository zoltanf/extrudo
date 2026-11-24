import { useCallback, useInsertionEffect, useRef, useState } from 'react';

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

/**
 * A value made in a render and read later, from events and effects, by code the render hands
 * it to through a function call (the shell's action creators get getters): a ref can't go
 * there, since the React Compiler can't tell the function won't read it right away (ADR-0159
 * §6). Made once with `useLater`; `useLaterValue` sets it in an insertion effect.
 */
export interface Later<T> {
  get(): T;
  set(value: T): void;
}

function createLater<T>(initial: T): Later<T> {
  let value = initial;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
  };
}

/** A `Later` holding `initial` until `useLaterValue` sets it; the same object for good. */
export function useLater<T>(initial: T): Later<T> {
  const [later] = useState(() => createLater(initial));
  return later;
}

/**
 * Sets `later` to `value` after every render, in an insertion effect: before every layout and
 * passive effect of the commit and every event after it, as a ref written in render reached
 * them (a child's render must not read it: it would see the last commit's value).
 */
export function useLaterValue<T>(later: Later<T>, value: T): void {
  useInsertionEffect(() => {
    later.set(value);
  });
}
