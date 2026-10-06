/**
 * The bridge's list of the API's handle classes (ADR-0070 §2).
 *
 * A handle is published to the sandbox as a proxy rather than as data, so a
 * missing class shows up as a handle without its methods — quietly, as
 * `plate.bottom` being `undefined`. This test is the other half of that: a new
 * handle class in `@extrudo/api` has to be added to `HANDLE_CLASSES`, or every
 * script that gets one back is missing part of it.
 */
import * as api from '@extrudo/api';
import { describe, expect, it } from 'vitest';
import { HANDLE_CLASSES } from './index';

/** Every class the API publishes for a script to hold on to. */
const PUBLISHED = Object.entries(api)
  .filter(
    ([name, value]) =>
      typeof value === 'function' && (name.endsWith('Handle') || name === 'SketchBuilder'),
  )
  .map(([name, value]) => [name, value] as const);

/** Whether an instance of `published` is a handle: it is one of the classes, or of a kind of one. */
const covered = (published: new (...args: never[]) => object): boolean =>
  HANDLE_CLASSES.some((known) => published === known || published.prototype instanceof known);

describe('the bridge knows every handle', () => {
  it('covers every class the API publishes as a handle', () => {
    expect(PUBLISHED.length).toBeGreaterThan(10);
    expect(PUBLISHED.filter(([, value]) => !covered(value as never)).map(([name]) => name)).toEqual(
      [],
    );
  });

  it('knows nothing that is not one', () => {
    const published = new Set(PUBLISHED.map(([name]) => name));
    expect(
      HANDLE_CLASSES.map((handle) => handle.name).filter((name) => !published.has(name)),
    ).toEqual([]);
  });
});
