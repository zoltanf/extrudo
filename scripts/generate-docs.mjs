#!/usr/bin/env node
// Writes the tool reference pages under docs/guide/tools/ from the app's own
// tool catalogue, key map and demo list (ADR-0080 §2, §4).
//
//   pnpm docs:generate
//   pnpm docs:generate --check     # writes nothing; fails when anything is out of date
//
// The generator itself is `apps/web/src/shell/toolDocs.ts`, so this script and
// the staleness test (`apps/web/src/shell/toolDocs.test.ts`) build the same pages
// the same way. Node reads the TypeScript directly (`--import ./scripts/ts-import.mjs`
// adds the resolver for the extensionless imports the sources use). A page the
// generator no longer makes is deleted; the pages it writes carry their notes
// over, so a hand-written note between the markers survives.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolPages } from '../apps/web/src/shell/toolDocs.ts';

/** The repository root, one level up from `scripts/`. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Where the generated tool pages go, relative to the repository root. */
const TOOLS_DIR = 'docs/guide/tools';

/** A generated page as it is on disk, or `undefined` when there is none. */
const onDisk = (path) => {
  const file = join(ROOT, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

/** Every `.md` file under the tools directory, by name, sorted. */
const filesInTools = () =>
  existsSync(join(ROOT, TOOLS_DIR))
    ? readdirSync(join(ROOT, TOOLS_DIR))
        .filter((name) => name.endsWith('.md'))
        .sort()
    : [];

const pages = toolPages(onDisk);

if (process.argv.includes('--check')) {
  const stale = [];
  for (const [path, text] of pages) {
    if (onDisk(path) !== text) stale.push(path);
  }
  const known = new Set([...pages.keys()].map((path) => path.slice(TOOLS_DIR.length + 1)));
  for (const name of filesInTools()) {
    if (!known.has(name)) stale.push(`${TOOLS_DIR}/${name}`);
  }
  if (stale.length > 0) {
    console.error(`Out of date. Run pnpm docs:generate:\n${stale.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`${pages.size} pages under ${TOOLS_DIR}/ are up to date.`);
} else {
  mkdirSync(join(ROOT, TOOLS_DIR), { recursive: true });
  const known = new Set();
  for (const [path, text] of pages) {
    writeFileSync(join(ROOT, path), text);
    known.add(path.slice(TOOLS_DIR.length + 1));
  }
  for (const name of filesInTools()) {
    if (!known.has(name)) unlinkSync(join(ROOT, TOOLS_DIR, name));
  }
  console.log(`Wrote ${pages.size} pages under ${TOOLS_DIR}/.`);
}
