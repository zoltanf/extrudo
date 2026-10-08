/**
 * Tutorials are tests (ADR-0080 §4, P6-06 S5): each page in `docs/guide/tutorials/` is
 * walked by `e2e/tutorials/<name>.spec.ts`, so the page's `<!-- step: <slug> -->` markers
 * and the spec's `step('<slug>', …)` calls must be the same list, and every step has its
 * picture. Nothing here runs the app; the spec itself does that.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..', '..');
const pages = join(root, 'docs', 'guide', 'tutorials');

/** The steps of a tutorial page, in order: the slug of each marker and the picture after it. */
export function pageSteps(markdown: string): { slug: string; image: string | undefined }[] {
  const parts = markdown.split(/<!--\s*step:\s*([a-z0-9-]+)\s*-->/);
  const steps: { slug: string; image: string | undefined }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const image = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(parts[i + 1] ?? '')?.[1];
    steps.push({ slug: parts[i] as string, image });
  }
  return steps;
}

/** The slugs of a spec's `step('<slug>'` calls, in order. */
export function specSlugs(source: string): string[] {
  return [...source.matchAll(/\bstep\(\s*'([^']+)'/g)].map((m) => m[1] as string);
}

const names = readdirSync(pages)
  .filter((file) => file.endsWith('.md') && file !== 'index.md')
  .map((file) => file.replace(/\.md$/, ''));

describe('the tutorial pages', () => {
  it('exist', () => {
    expect(names).toContain('first-part');
  });

  describe.each(names)('%s', (name) => {
    const page = `docs/guide/tutorials/${name}.md`;
    const spec = `e2e/tutorials/${name}.spec.ts`;
    const steps = pageSteps(readFileSync(join(pages, `${name}.md`), 'utf8'));

    it('has a spec', () => {
      expect(existsSync(join(root, spec)), `${page} needs ${spec}`).toBe(true);
    });

    it('has the same steps as its spec, in order', () => {
      const slugs = specSlugs(readFileSync(join(root, spec), 'utf8'));
      expect(
        steps.map((s) => s.slug),
        `${page} against ${spec}`,
      ).toEqual(slugs);
      expect(new Set(slugs).size, `${spec} repeats a slug`).toBe(slugs.length);
    });

    it('has a picture for every step', () => {
      for (const { slug, image } of steps) {
        expect(image, `${page}: step "${slug}" has no picture`).toBeDefined();
        expect(image, `${page}: step "${slug}"`).toBe(`./images/${name}/${slug}.png`);
        expect(
          existsSync(join(pages, image as string)),
          `${page}: step "${slug}" has no file ${image}`,
        ).toBe(true);
      }
    });
  });
});

describe('the helpers', () => {
  it('read markers and calls', () => {
    expect(
      pageSteps('<!-- step: a -->\n### A\n![x](./images/n/a.png)\n<!--step:b-->\ntext'),
    ).toEqual([
      { slug: 'a', image: './images/n/a.png' },
      { slug: 'b', image: undefined },
    ]);
    expect(specSlugs("await step(\n 'a',\n x);\nstep('b', y)")).toEqual(['a', 'b']);
  });
});
