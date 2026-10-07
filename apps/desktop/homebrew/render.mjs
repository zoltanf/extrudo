#!/usr/bin/env node
// Renders the Homebrew cask for Extrudo's macOS build (P6-01, ADR-0075's
// amendment): `node render.mjs <version> <sha256>` prints the cask, filled
// from extrudo.rb.template beside this script. Plain Node, no dependencies:
// the `desktop` workflow's `homebrew` job runs it on a tag and pushes the
// result into the tap (zoltanf/homebrew-extrudo). The version must be plain
// semver (x.y.z — the `v<version>` tag and the zip name carry it) and the
// sha256 exactly 64 lowercase hex characters, as sha256sum prints.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TEMPLATE = 'extrudo.rb.template';
const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function renderCask(version, sha256) {
  if (!SEMVER.test(version)) {
    throw new Error(`version ${JSON.stringify(version)} is not plain semver (x.y.z)`);
  }
  if (!SHA256.test(sha256)) {
    throw new Error(`sha256 ${JSON.stringify(sha256)} is not 64 hex characters`);
  }
  const template = readFileSync(join(import.meta.dirname, TEMPLATE), 'utf8');
  return template.replaceAll('{{VERSION}}', version).replaceAll('{{SHA256}}', sha256);
}

function main(argv) {
  if (argv.length < 2) {
    console.error('usage: node render.mjs <version> <sha256>');
    return 2;
  }
  try {
    process.stdout.write(renderCask(argv[0] ?? '', argv[1] ?? ''));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 1;
  }
  return 0;
}

// Run as a program only when this file is the entry (the test spawns it).
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
