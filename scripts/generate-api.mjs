#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { TOOLS_PAGE_PATH, toolsPage } from '../apps/web/src/agent/toolsPage.ts';
// Writes packages/api/src/generated/features.ts and the reference pages under
// docs/api/features/ from core's feature registry (ADR-0068 §3, §6).
//
//   pnpm api:generate
//   pnpm api:generate --check     # writes nothing; fails when anything is out of date
//
// The generator itself is `packages/api/src/generate.ts`, so this script and the
// staleness tests (`generated.test.ts`, `docs.test.ts`) build the same files the
// same way. Node reads the TypeScript directly (`--import ./scripts/ts-import.mjs`
// adds the resolver for the extensionless imports core's sources use), and Biome
// formats the generated TypeScript.
import {
  docOnDisk,
  docPages,
  generate,
  generatedOnDisk,
  skillPages,
  writeGenerated,
} from '../packages/api/src/generate.ts';

// The shipped skill's tool reference (P6-08, ADR-0087 §7), from the tools' schemas.
const toolsOnDisk = () => {
  try {
    return readFileSync(TOOLS_PAGE_PATH, 'utf8');
  } catch {
    return undefined;
  }
};

const GENERATED = 'packages/api/src/generated/features.ts';

if (process.argv.includes('--check')) {
  const stale = [];
  if (generate() !== generatedOnDisk()) stale.push(GENERATED);
  for (const [path, text] of [...docPages(), ...skillPages()]) {
    if (docOnDisk(path) !== text) stale.push(path);
  }
  if (toolsOnDisk() !== toolsPage()) stale.push(TOOLS_PAGE_PATH);
  if (stale.length > 0) {
    console.error(`Out of date. Run pnpm api:generate:\n${stale.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`${GENERATED} and ${docPages().size} pages under docs/api/features/ are up to date.`);
} else {
  const written = writeGenerated();
  writeFileSync(TOOLS_PAGE_PATH, toolsPage());
  console.log(
    `Wrote ${GENERATED}, ${written.length - 2} pages under docs/api/features/ and the skill's references.`,
  );
}
