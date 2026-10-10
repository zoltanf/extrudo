#!/usr/bin/env node
// Enforces the package dependency rules in docs/02-architecture.md §3:
// which workspace packages may depend on which. Checks both package.json
// dependencies and `@extrudo/*` imports in source files.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Allowed internal dependencies per package. Anything not listed is forbidden. */
const ALLOWED = {
  '@extrudo/core': [],
  '@extrudo/sketch': ['@extrudo/core', '@extrudo/io', '@extrudo/fonts'],
  // io (MIT): the `import` evaluator parses STL, 3MF and OBJ files with it
  // (ADR-0066 §3), and the export tests check meshes with it.
  // openscad: the compile protocol's types, and the worker entry's lazy
  // `import()` of its browser compiler (ADR-0071 §3).
  // storage: only `@extrudo/storage/plugin`, the plugin file reader (fflate and
  // core), which the plugin feature runs a design's copy of a plugin with
  // (ADR-0077 §3).
  '@extrudo/kernel': [
    '@extrudo/core',
    '@extrudo/sketch',
    '@extrudo/io',
    '@extrudo/fonts',
    '@extrudo/openscad',
    '@extrudo/storage',
  ],
  // OpenSCAD in WebAssembly (P5-04, ADR-0071): nothing internal at run time;
  // its tests read the 3MFs it writes with io.
  '@extrudo/openscad': ['@extrudo/io'],
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
  // The Fusion .f3d importer: decodes the archive and builds the design
  // through the document API (and the sketch package's profile detection, to
  // match Fusion's profile regions). The kernel only in its tests.
  '@extrudo/f3d': ['@extrudo/api', '@extrudo/core', '@extrudo/sketch', '@extrudo/kernel'],
  // The script runner (ADR-0070): user code in QuickJS, building features
  // through @extrudo/api. Nothing of the kernel's: the kernel gets the runner
  // injected, so this package stays out of its dependency graph.
  '@extrudo/script': ['@extrudo/api', '@extrudo/core'],
  // The headless CLI (P5-03, ADR-0069): the document API, the kernel's Node
  // entry (OCCT in this thread), the solver, the archive format, the io
  // writers and the bundled fonts. Nothing depends on it.
  '@extrudo/cli': [
    '@extrudo/api',
    '@extrudo/core',
    '@extrudo/fonts',
    '@extrudo/io',
    '@extrudo/kernel',
    // The script runner, injected into the kernel for a design with a script
    // (P5-02, ADR-0070 §2): the kernel may not import it itself.
    '@extrudo/script',
    '@extrudo/openscad',
    '@extrudo/sketch',
    '@extrudo/storage',
  ],
  // The landing page: no internal packages (ADR-0057).
  '@extrudo/site': [],
  // The Electron desktop app (P6-01, ADR-0075 §1): the web app's own UI and
  // entry, the storage package's Node entry, and the document model. No
  // kernel code of its own; the renderer runs the web workers unchanged.
  '@extrudo/desktop': ['@extrudo/web', '@extrudo/storage', '@extrudo/core'],
  '@extrudo/web': [
    // Only the macro dialog imports it, lazily, for the emitter (P5-05, ADR-0073 §4).
    '@extrudo/api',
    // The .f3d import, loaded lazily when the user picks a file.
    '@extrudo/f3d',
    '@extrudo/core',
    '@extrudo/sketch',
    '@extrudo/kernel',
    // Only the project's kernel worker entry imports it (P5-02, ADR-0070 §2).
    '@extrudo/script',
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

const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)['"](@extrudo\/[a-z0-9-]+)/g;
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

// Module paths that differ only by case are one file on macOS and Windows, so
// `import './ModelProgress'` can resolve to `modelProgress.ts` there (v0.4.0's
// desktop build failed that way). Compare the stem (the path without its last
// extension) ignoring case: equal stems that differ in case are an error.
const MODULE_EXTENSION = /\.(ts|tsx|js|mjs|jsx)$/;
const trackedModules = execFileSync('git', ['ls-files', '--', 'apps', 'packages'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter((path) => MODULE_EXTENSION.test(path))
  .map((path) => path.replace(MODULE_EXTENSION, ''));
const stemsByLowerCase = new Map();
for (const stem of trackedModules) {
  const key = stem.toLowerCase();
  stemsByLowerCase.set(key, [...(stemsByLowerCase.get(key) ?? []), stem]);
}
const caseClashes = [];
for (const stems of stemsByLowerCase.values()) {
  const distinct = [...new Set(stems)];
  for (let i = 0; i < distinct.length; i++) {
    for (let j = i + 1; j < distinct.length; j++) {
      caseClashes.push(
        `Module paths that differ only by case break macOS and Windows builds: ${distinct[i]} <-> ${distinct[j]}`,
      );
    }
  }
}
if (caseClashes.length > 0) {
  console.error(caseClashes.join('\n'));
  process.exit(1);
}

console.log(`Package boundaries OK (${workspaceDirs.length} packages).`);
