/**
 * The reference pages under `docs/api/` (ADR-0068 §6).
 *
 * Three jobs:
 *
 * - **They are what the generator writes.** Every generated page on disk is
 *   compared with the text `docPages()` builds, so a feature or an input that
 *   changed in core fails here with the same message the generated file's own
 *   test gives.
 * - **The examples are true.** `featureExamples` (generated) is the code every
 *   page shows: this runs it against a real `Design` and checks that every call
 *   made a valid feature, and that each page's example block is one of its lines.
 * - **The hand-written pages' code compiles.** Every ```ts block of `README.md`,
 *   `sketch.md` and `references.md` is type-checked here against the package,
 *   with `typescript` the same way `pnpm typecheck` would, so a snippet cannot
 *   rot quietly.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Attachment, type AttachmentId, addAttachment } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { exampleBlock } from './example-calls';
import { docOnDisk, docPages, readFeatureDocs } from './generate';
import { FEATURE_TYPES, featureExamples } from './generated/features';
import { Design } from './index';

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
/** Where the check's own sources and tsconfig go, for the run below. */
const CHECK_DIR = join(ROOT, 'packages/api/.docs-check');

/** The hand-written pages: no generator writes these, so they are read as they are. */
const WRITTEN = ['README.md', 'sketch.md', 'references.md', 'scripts.md'] as const;

describe('the generated pages', () => {
  const pages = docPages();

  it('has one page per feature type, and an index', () => {
    expect([...pages.keys()]).toEqual([
      'docs/api/features/README.md',
      ...FEATURE_TYPES.map((type) => `docs/api/features/${type}.md`),
    ]);
  });

  it('is what the generator writes today', () => {
    const stale = [...pages.keys()].filter((path) => docOnDisk(path) !== pages.get(path));
    expect(stale, 'Run pnpm api:generate').toEqual([]);
  });

  it('has no page the generator no longer writes', () => {
    // A type renamed or removed leaves its page behind; nothing reads it, and it
    // would be listed nowhere, so it is a stale file rather than history.
    const written = [...pages.keys()].filter((path) => docOnDisk(path) !== undefined);
    expect(written.length).toBe(pages.size);
  });

  it('says the method, its inputs, its faces and an example on every page', () => {
    for (const feature of readFeatureDocs()) {
      const page = pages.get(`docs/api/features/${feature.type}.md`) ?? '';
      expect(page, feature.type).toContain(`# ${feature.label}`);
      expect(page, feature.type).toContain('## Inputs');
      expect(page, feature.type).toContain('| Input | Type | Required or default |');
      expect(page, feature.type).toContain('```ts');
      for (const input of feature.inputs) {
        // The sketch's own content is `build`'s, and its page says so instead of
        // listing an input nobody passes.
        if (feature.type === 'sketch' && input.name === 'sketch') continue;
        expect(page, `${feature.type}.${input.name}`).toContain(`\`${input.name}\``);
      }
      for (const role of feature.faceRoles) {
        expect(page, `${feature.type} ${role.name}`).toContain(`\`${role.name}\``);
      }
    }
  });
});

describe('the examples', () => {
  /** A design with the attachments the two file examples name. */
  function design(): Design {
    const d = Design.create({ now: '2026-10-05T00:00:00.000Z' });
    for (const [id, fileName, mediaType] of [
      ['att-part.step', 'part.step', 'model/step'],
      ['att-plan.png', 'plan.png', 'image/png'],
    ] as const) {
      d.state.dispatch(
        addAttachment({
          id: id as AttachmentId,
          attachment: {
            name: fileName,
            fileName,
            mediaType,
            sha256: 'a'.repeat(64),
            size: 1024,
          } as Attachment,
        }),
      );
    }
    return d;
  }

  it('run against a real design and make a valid feature each', () => {
    const d = design();
    featureExamples(d);
    expect(d.validate()).toEqual([]);
    // Every type has its call, and the preamble adds a box, a cylinder and a
    // sketch of its own on top of them.
    const called = FEATURE_TYPES.length - 1;
    expect(d.doc.features).toHaveLength(called + 3 + 1);
    expect(new Set(d.doc.features.map((feature) => feature.type)).size).toBeGreaterThan(30);
  });

  it('are the block every page shows', () => {
    for (const feature of readFeatureDocs()) {
      const page = docOnDisk(`docs/api/features/${feature.type}.md`) ?? '';
      expect(page, feature.type).toContain(exampleBlock(feature));
    }
  });

  it('give every required input a value, which the generator checks', () => {
    // The check itself is in the generator (a missing one is an error there);
    // this says what it protects.
    expect(
      readFeatureDocs()
        .filter((feature) => feature.type !== 'sketch')
        .every((feature) => exampleBlock(feature).includes('d.')),
    ).toBe(true);
  });
});

describe('the hand-written pages', () => {
  it('are there, and carry their front matter', () => {
    for (const name of WRITTEN) {
      const page = readFileSync(join(ROOT, 'docs/api', name), 'utf8');
      expect(page, name).toMatch(/^---\ntitle: [^\n]+\nsection: Guide\norder: \d\n---\n/);
    }
  });

  it('have a TypeScript block that compiles against the package', () => {
    const sources = WRITTEN.map((name) => {
      const page = readFileSync(join(ROOT, 'docs/api', name), 'utf8');
      const blocks = [...page.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
      expect(blocks.length, `${name} has an example to check`).toBeGreaterThan(0);
      return [name, pageSource(blocks)] as const;
    });
    const problems = typeCheck(sources);
    expect(problems, problems.join('\n')).toEqual([]);
  }, 120_000);

  it('link only to pages that exist', () => {
    for (const name of WRITTEN) {
      const page = readFileSync(join(ROOT, 'docs/api', name), 'utf8');
      for (const [, target] of page.matchAll(/\]\((\.[^)#]*?)(?:#[^)]*)?\)/g)) {
        const path = join(ROOT, 'docs/api', target ?? '');
        expect(readFileSync(path, 'utf8').length, `${name} → ${target}`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * A page's TypeScript blocks as one module: the imports hoisted into a single
 * statement (two of them would bind the same names twice) and each block in its
 * own braces inside one async function, because a block in a page stands on its
 * own and may well declare the same `d` as the one before it.
 */
function pageSource(blocks: readonly string[]): string {
  const imported = new Set<string>();
  const bodies = blocks.map((block) =>
    block
      .split('\n')
      .filter((line) => {
        const statement = /^import\s+\{([^}]*)\}\s+from\s+'@extrudo\/api';$/.exec(line.trim());
        if (!statement) return true;
        for (const name of (statement[1] ?? '').split(',')) {
          const trimmed = name.trim();
          if (trimmed) imported.add(trimmed);
        }
        return false;
      })
      .join('\n')
      .trim(),
  );
  return [
    `import { ${[...imported].sort().join(', ')} } from '@extrudo/api';`,
    '',
    'export async function page(): Promise<void> {',
    ...bodies.flatMap((body) => ['  {', body, '  }', '']),
    '}',
  ].join('\n');
}

/**
 * What `tsc` says about the given modules, written into `.docs-check/` beside the
 * package with a tsconfig of their own: the package's own strictness, and the
 * paths entry that maps `@extrudo/api` to this package. The TypeScript that ships
 * with the repository is the native compiler (7.x), which has no JavaScript API
 * to drive, so this runs its command line — which is what `pnpm typecheck` runs
 * anyway.
 *
 * Only the modules themselves are reported: what a dependency says about itself
 * is `pnpm typecheck`'s business, not this page's.
 */
function typeCheck(sources: readonly (readonly [string, string])[]): string[] {
  rmSync(CHECK_DIR, { recursive: true, force: true });
  mkdirSync(CHECK_DIR, { recursive: true });
  writeFileSync(join(CHECK_DIR, 'tsconfig.json'), JSON.stringify(CHECK_TSCONFIG, null, 2));
  for (const [name, code] of sources) {
    writeFileSync(join(CHECK_DIR, `${name.replace(/\.md$/, '')}.ts`), `${code}\n`);
  }
  const tsc = join(ROOT, 'node_modules/typescript/bin/tsc');
  const run = spawnSync(process.execPath, [tsc, '-p', CHECK_DIR, '--pretty', 'false'], {
    encoding: 'utf8',
  });
  rmSync(CHECK_DIR, { recursive: true, force: true });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const mine = sources.map(([name]) => `${name.replace(/\.md$/, '')}.ts`);
  // tsc names its files by the path it was given, which is this check's own
  // directory; the line that names no checked file is a dependency's own problem.
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => mine.some((file) => line.includes(`${file}(`)))
    .map((line) => line.replace(/^.*\.docs-check\//, ''));
}

/** The check's own tsconfig: this package's strictness, nothing else. */
const CHECK_TSCONFIG = {
  compilerOptions: {
    target: 'es2023',
    lib: ['esnext', 'dom'],
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    paths: { '@extrudo/api': ['../src/index.ts'] },
  },
  include: ['*.ts'],
};
