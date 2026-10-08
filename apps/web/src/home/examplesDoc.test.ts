import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ExampleEntry, examplesPage } from './examplesDoc';

/** The repository root, four levels up from `apps/web/src/home`. */
const ROOT = join(new URL('../../../../', import.meta.url).pathname);
const registry = JSON.parse(
  readFileSync(join(ROOT, 'fixtures/examples/examples.json'), 'utf8'),
) as ExampleEntry[];

/**
 * P6-06 S4: the examples gallery page is generated from the registry, so the
 * checked-in `docs/guide/examples.md` must be what `pnpm docs:generate` writes
 * now, and every picture it names must have been recorded.
 */
describe('the examples page (P6-06 S4)', () => {
  it('is what the generator writes today', () => {
    const onDisk = readFileSync(join(ROOT, 'docs/guide/examples.md'), 'utf8');
    expect(onDisk, 'run pnpm docs:generate').toBe(examplesPage(registry));
  });

  it('has the three level headings in order, each example once under its level', () => {
    const text = examplesPage(registry);
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(['Beginner', 'Intermediate', 'Advanced']);
    for (const e of registry) {
      expect(text.split(`[Open in Extrudo]({{APP_URL}}/#/example/${e.id})`).length - 1).toBe(1);
    }
  });

  it('keeps the registry order within a level', () => {
    const text = examplesPage(registry);
    const beginner = registry.filter((e) => e.level === 'beginner').map((e) => e.id);
    const at = beginner.map((id) => text.indexOf(`#/example/${id})`));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('names a picture recorded for every example', () => {
    for (const e of registry) {
      const file = join(ROOT, 'docs/guide/images/examples', `${e.id}.png`);
      expect(existsSync(file), `run RECORD_ASSETS=1 for ${e.id}`).toBe(true);
    }
  });
});
