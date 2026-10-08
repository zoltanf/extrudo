import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, exampleById } from './examples';

/** `fixtures/`, from this file's place in the tree. */
const FIXTURES = join(new URL('../../../../fixtures/', import.meta.url).pathname);

/**
 * P6-06 S3: the example registry `fixtures/examples/examples.json` is what
 * both the app's More examples… and (a later slice) the site's gallery page
 * build from, so the tests keep it honest: unique kebab-case IDs, files that
 * exist, levels from the three, one-sentence descriptions.
 */
describe('example registry (P6-06 S3)', () => {
  it('has unique kebab-case IDs', () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('has a file on disk for every example', () => {
    for (const e of EXAMPLES) {
      expect(existsSync(join(FIXTURES, e.file)), `${e.id}: ${e.file}`).toBe(true);
    }
  });

  it('levels are beginner, intermediate or advanced', () => {
    for (const e of EXAMPLES) {
      expect(['beginner', 'intermediate', 'advanced']).toContain(e.level);
    }
  });

  it('descriptions are one sentence ending in a full stop', () => {
    for (const e of EXAMPLES) {
      expect(e.description, e.id).toMatch(/^[^.]+\.$/);
    }
  });

  it('finds an example by its ID and misses unknown ones', () => {
    expect(exampleById('plate')?.title).toBe('Plate with corner holes');
    expect(exampleById('nope')).toBeUndefined();
  });

  // The glob lookup is module load: a renamed fixture must rename the
  // registry with it, or the app fails to start rather than 404 an example.
  it('every example has a bundled file URL', () => {
    for (const e of EXAMPLES) {
      expect(e.url.length, e.id).toBeGreaterThan(0);
      expect(e.url).not.toBe('undefined');
    }
  });

  // Kept in sync with the checked-in fixtures: the eleven examples this
  // slice ships, in the registry's own order.
  it('lists the eleven examples in order', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual([
      'plate',
      'storage-box',
      'phone-stand',
      'box-with-lid',
      'pcb-enclosure',
      'wall-hook',
      'knurled-knob',
      'name-tag',
      'bottle-cap',
      'chain-link',
      'sweep-loft-coil',
    ]);
  });
});
