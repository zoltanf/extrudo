// CI's unit test run: `vitest run`, then once more for just the test files
// whose worker crashed with SIGTRAP.
//
// The OpenSCAD tests compile in Node worker_threads, which share the vitest
// fork's V8. On GitHub's runners V8 sometimes aborts there ("Check failed:
// jit_page…", SIGTRAP; hooks.test.ts and live.test.ts on 2026-11-01), the fork
// dies mid-file and the job fails although every other file passed. Re-running
// the whole suite would cost another 23 minutes, so only the crashed files run
// again, and only when the crashes were the run's sole problem: any failed test
// or other error fails the job as before.
//
// CLI (run by CI, Node strips the types itself):
//   node scripts/vitest-retry.ts [vitest filters…]
import { spawn } from 'node:child_process';
import { relative } from 'node:path';

const CRASH =
  /Worker exited unexpectedly with signal SIGTRAP during \w+ state while running test file (\S+)/g;

/**
 * The test files to run again, or undefined when the run failed for any reason
 * besides SIGTRAP worker crashes (or did not crash at all).
 */
export function crashedFiles(output: string): string[] | undefined {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colours
  const text = output.replace(/\x1b\[[0-9;]*m/g, '');
  const files = [...new Set([...text.matchAll(CRASH)].map((m) => m[1] as string))];
  if (files.length === 0) return undefined;
  if (/^\s*(Test Files|Tests)\s.*\bfailed\b/m.test(text)) return undefined;
  const errors = /^\s*Errors\s+(\d+) errors?\b/m.exec(text);
  if (Number(errors?.[1]) !== files.length) return undefined;
  return files;
}

/** Runs `pnpm exec vitest run …args`, echoing and returning its output. */
function vitest(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'vitest', 'run', ...args], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      output += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      output += chunk;
    });
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

if (import.meta.main) {
  const first = await vitest(process.argv.slice(2));
  const files = first.code === 0 ? undefined : crashedFiles(first.output);
  if (!files) process.exit(first.code);
  const paths = files.map((file) => relative(process.cwd(), file));
  console.log(`::warning::Worker crashed with SIGTRAP; running again: ${paths.join(' ')}`);
  process.exit((await vitest(paths)).code);
}
