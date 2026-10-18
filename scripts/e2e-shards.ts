// Duration-balanced e2e shards for CI.
//
// Playwright's own `--shard=i/n` cuts the test list into equal *counts* in
// file order. The long specs sit together early in the alphabet (the
// benchmarks b1–b10 among them), so on 2026-10-18 shard 1 of 2 ran 22.7
// minutes while shard 2 ran 8.5. Instead, CI sets `E2E_SHARD=<current>/<total>`
// and playwright.config.ts gives each project the files of that shard. The
// files are dealt longest first, each to the least loaded shard so far (LPT),
// using the per-file seconds in e2e/timings.json; a file the JSON does not
// know (a new spec) counts as the median of the known ones. Regenerate the
// JSON from a CI run with `node scripts/e2e-timings.mjs <run-id>` when a
// shard runs much longer than the others (docs/agent/e2e-notes.md, General).
//
// CLI (run by CI, Node strips the types itself):
//   node scripts/e2e-shards.ts browsers   # extra Playwright browsers this shard needs
//   node scripts/e2e-shards.ts plan       # every shard's files and estimated minutes
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The only spec of the `webkit` project; the shard that has it installs WebKit. */
export const WEBKIT_SPEC = 'webkit-smoke.spec.ts';

const E2E_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e');
const TIMINGS = join(E2E_DIR, 'timings.json');

export interface Shard {
  current: number;
  total: number;
}

/** Parses `E2E_SHARD` ("2/3"); undefined when unset, an error when malformed. */
export function parseShard(env: string | undefined): Shard | undefined {
  if (!env) return undefined;
  const m = /^(\d+)\/(\d+)$/.exec(env.trim());
  const current = Number(m?.[1]);
  const total = Number(m?.[2]);
  if (!m || current < 1 || total < 1 || current > total) {
    throw new Error(`E2E_SHARD must be <current>/<total> with 1 ≤ current ≤ total, got "${env}"`);
  }
  return { current, total };
}

/** Deals `files` to `total` shards, longest first to the least loaded (LPT). */
export function planShards(
  files: readonly string[],
  timings: Readonly<Record<string, number>>,
  total: number,
): { files: string[]; seconds: number }[] {
  const known = Object.values(timings).sort((a, b) => a - b);
  const median = known.length ? (known[Math.floor(known.length / 2)] ?? 0) : 0;
  const seconds = (file: string) => timings[file] ?? median;
  // Ties by name, so the plan is the same whatever order the files came in.
  const sorted = [...files].sort((a, b) => seconds(b) - seconds(a) || a.localeCompare(b));
  const shards = Array.from({ length: total }, () => ({ files: [] as string[], seconds: 0 }));
  for (const file of sorted) {
    let least = shards[0];
    if (!least) throw new Error('total must be at least 1');
    for (const shard of shards) {
      // Equal loads (all zero, with no timings): the fewest files wins.
      const lighter = shard.seconds < least.seconds;
      const tie = shard.seconds === least.seconds && shard.files.length < least.files.length;
      if (lighter || tie) least = shard;
    }
    least.files.push(file);
    least.seconds += seconds(file);
  }
  for (const shard of shards) shard.files.sort();
  return shards;
}

/** The repo's spec files relative to e2e/ (`tutorials/first-part.spec.ts` included), by name. */
export function specFiles(dir = E2E_DIR): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((name) => name.replaceAll('\\', '/'))
    .filter((name) => name.endsWith('.spec.ts'))
    .sort();
}

export function readTimings(path = TIMINGS): Record<string, number> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
}

/** The spec files of `shard`, from the repo's files and timings. */
export function filesOfShard(shard: Shard): string[] {
  const plan = planShards(specFiles(), readTimings(), shard.total);
  return plan[shard.current - 1]?.files ?? [];
}

// The CLI, only when this file is the script Node ran (playwright.config.ts
// imports it too, with Playwright's own arguments).
const command =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    ? process.argv[2]
    : undefined;
if (command === 'browsers') {
  const shard = parseShard(process.env.E2E_SHARD);
  const files = shard ? filesOfShard(shard) : specFiles();
  if (files.includes(WEBKIT_SPEC)) process.stdout.write('webkit\n');
} else if (command === 'plan') {
  const shard = parseShard(process.env.E2E_SHARD);
  const total = shard?.total ?? Number(process.argv[3] ?? 4);
  const plan = planShards(specFiles(), readTimings(), total);
  plan.forEach((entry, i) => {
    const minutes = (entry.seconds / 60).toFixed(1);
    console.log(
      `shard ${i + 1}/${total}: ${entry.files.length} files, ${minutes} min of test time`,
    );
    console.log(`  ${entry.files.join(' ')}`);
  });
} else if (command !== undefined) {
  console.error(`unknown command "${command}": browsers | plan [total]`);
  process.exit(2);
}
