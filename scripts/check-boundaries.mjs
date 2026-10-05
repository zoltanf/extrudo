#!/usr/bin/env node
// Enforces the package dependency rules in docs/02-architecture.md §3:
// which workspace packages may depend on which. Checks both package.json
// dependencies and `@extrudo/*` imports in source files.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Allowed internal dependencies per package. Anything not listed is forbidden. */
const ALLOWED = {
  '@extrudo/core': [],
  '@extrudo/sketch': ['@extrudo/core', '@extrudo/io', '@extrudo/fonts'],
  // io (MIT): the `import` evaluator parses STL, 3MF and OBJ files with it
  // (ADR-0066 §3), and the export tests check meshes with it.
  '@extrudo/kernel': ['@extrudo/core', '@extrudo/sketch', '@extrudo/io', '@extrudo/fonts'],
  // MIT-licensed: must stay independent of the GPL packages.
  '@extrudo/io': [],
  // The bundled fonts: a data package, nothing internal may depend the other
  // way; @extrudo/sketch (the shaper), @extrudo/kernel and the app use it.
  '@extrudo/fonts': [],
  '@extrudo/storage': ['@extrudo/core'],
  // The public document API (ADR-0068 §1): the document, the sketch package's
  // pure entries and the archive writer. No DOM, no WASM, no kernel — the
  // kernel is a devDependency only, for the tests that recompute a design
  // headless (`examples.test.ts`).
  '@extrudo/api': ['@extrudo/core', '@extrudo/sketch', '@extrudo/storage', '@extrudo/kernel'],
  // The headless CLI (P5-03, ADR-0069): the document API, the kernel's Node
  // entry (OCCT in this thread), the solver, the archive format, the io
  // writers and the bundled fonts. Nothing depends on it.
  '@extrudo/cli': [
    '@extrudo/api',
    '@extrudo/core',
    '@extrudo/fonts',
    '@extrudo/io',
    '@extrudo/kernel',
    '@extrudo/sketch',
    '@extrudo/storage',
  ],
  // The landing page: no internal packages (ADR-0057).
  '@extrudo/site': [],
  '@extrudo/web': [
    '@extrudo/core',
    '@extrudo/sketch',
    '@extrudo/kernel',
    '@extrudo/io',
    '@extrudo/storage',
    '@extrudo/fonts',
  ],
};

const workspaceDirs = ['apps', 'packages'].flatMap((group) =>
  readdirSync(join(ROOT, group)).map((name) => join(ROOT, group, name)),
);

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) yield path;
  }
}

const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)['"](@extrudo\/[a-z-]+)/g;
const problems = [];

for (const dir of workspaceDirs) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const allowed = ALLOWED[pkg.name];
  if (!allowed) {
    problems.push(`${pkg.name}: not listed in scripts/check-boundaries.mjs, add its rules there`);
    continue;
  }
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) =>
    d.startsWith('@extrudo/'),
  );
  for (const dep of declared) {
    if (!allowed.includes(dep)) problems.push(`${pkg.name}: must not depend on ${dep}`);
  }
  for (const file of sourceFiles(dir)) {
    for (const [, target] of readFileSync(file, 'utf8').matchAll(importPattern)) {
      if (target !== pkg.name && !allowed.includes(target)) {
        problems.push(`${relative(ROOT, file)}: must not import ${target}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`Package boundary violations:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}

// opentype.js (~170 kB) must stay inside the @extrudo/sketch/text entry
// (ADR-0058 §4): core, the app and the other sketch modules go through core's
// text registry instead, so the parser is only ever loaded with text.
for (const file of sourceFiles(join(ROOT, 'packages/sketch/src'))) {
  if (file.includes(`${join('src', 'text')}${sep}`)) continue;
  const source = readFileSync(file, 'utf8');
  if (/['"]opentype\.js['"]/.test(source) || /['"]@extrudo\/sketch\/text['"]/.test(source)) {
    problems.push(`${relative(ROOT, file)}: only packages/sketch/src/text may import opentype.js`);
  }
}

if (problems.length > 0) {
  console.error(`Package boundary violations:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Package boundaries OK (${workspaceDirs.length} packages).`);
