#!/usr/bin/env node
// Enforces the package dependency rules in docs/02-architecture.md §3:
// which workspace packages may depend on which. Checks both package.json
// dependencies and `@extrudo/*` imports in source files.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Allowed internal dependencies per package. Anything not listed is forbidden. */
const ALLOWED = {
  '@extrudo/core': [],
  '@extrudo/sketch': ['@extrudo/core', '@extrudo/io'],
  '@extrudo/kernel': ['@extrudo/core', '@extrudo/sketch'],
  // MIT-licensed: must stay independent of the GPL packages.
  '@extrudo/io': [],
  '@extrudo/storage': ['@extrudo/core'],
  '@extrudo/web': [
    '@extrudo/core',
    '@extrudo/sketch',
    '@extrudo/kernel',
    '@extrudo/io',
    '@extrudo/storage',
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
console.log(`Package boundaries OK (${workspaceDirs.length} packages).`);
