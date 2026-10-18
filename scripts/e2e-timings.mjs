#!/usr/bin/env node
// Rewrites e2e/timings.json, the per-file seconds that scripts/e2e-shards.ts
// balances the CI shards with, from a CI run's JSON reports (the
// `playwright-results-<shard>` artifacts every e2e shard uploads).
//
//   node scripts/e2e-timings.mjs <run-id>     # gh run download, then sum per file
//
// A test's seconds are its last result's (a retry replaces the failed try, it
// does not add to it); skipped tests count nothing. Prints the plan the new
// numbers give for the shard count in .github/workflows/ci.yml.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planShards } from './e2e-shards.ts';

const runId = process.argv[2];
if (!runId) {
  console.error('usage: node scripts/e2e-timings.mjs <run-id>');
  process.exit(2);
}
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'e2e', 'timings.json');
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const total = Number(/E2E_SHARD: \$\{\{ matrix\.shard \}\}\/(\d+)/.exec(workflow)?.[1] ?? 1);

const dir = mkdtempSync(join(tmpdir(), 'e2e-timings-'));
try {
  execFileSync('gh', ['run', 'download', runId, '-p', 'playwright-results-*', '-D', dir], {
    stdio: 'inherit',
  });
  const seconds = {};
  const visit = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        if (!last || last.status === 'skipped') continue;
        seconds[file] = (seconds[file] ?? 0) + last.duration / 1000;
      }
    }
    for (const child of suite.suites ?? []) visit(child, file);
  };
  let reports = 0;
  for (const artifact of readdirSync(dir)) {
    const report = JSON.parse(readFileSync(join(dir, artifact, 'playwright-results.json'), 'utf8'));
    reports++;
    for (const suite of report.suites ?? []) visit(suite, suite.file ?? suite.title);
  }
  if (reports === 0) throw new Error(`run ${runId} has no playwright-results-* artifact`);
  const timings = Object.fromEntries(
    Object.entries(seconds)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, s]) => [file, Math.round(s * 10) / 10]),
  );
  writeFileSync(OUT, `${JSON.stringify(timings, null, 2)}\n`);
  console.log(
    `wrote ${Object.keys(timings).length} files to e2e/timings.json from ${reports} reports`,
  );
  planShards(Object.keys(timings), timings, total).forEach((shard, i) => {
    console.log(
      `shard ${i + 1}/${total}: ${shard.files.length} files, ${(shard.seconds / 60).toFixed(1)} min`,
    );
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
