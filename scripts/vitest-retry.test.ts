import { describe, expect, it } from 'vitest';
import { crashedFiles } from './vitest-retry';

const crash = (file: string) =>
  `Caused by: Error: Worker exited unexpectedly with signal SIGTRAP during started state while running test file ${file}`;

// The tail of CI run 41285993270 (2026-11-01), colours included.
const summary = (files: string, errors: string) =>
  [
    `\x1b[2m Test Files \x1b[22m ${files}`,
    '\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m6116 passed\x1b[39m\x1b[22m | 23 skipped (6143)',
    `\x1b[2m     Errors \x1b[22m \x1b[1m\x1b[31m${errors}\x1b[39m\x1b[22m`,
  ].join('\n');

const passed = '\x1b[1m\x1b[32m518 passed\x1b[39m\x1b[22m | 10 skipped (529)';

describe('crashedFiles', () => {
  it('returns the crashed file when the crash was the only problem', () => {
    const output = `${crash('/w/packages/kernel/src/scad-export/hooks.test.ts')}\n${summary(passed, '1 error')}`;
    expect(crashedFiles(output)).toEqual(['/w/packages/kernel/src/scad-export/hooks.test.ts']);
  });

  it('returns every crashed file when each error is a crash', () => {
    const output = [crash('/w/a.test.ts'), crash('/w/b.test.ts'), summary(passed, '2 errors')];
    expect(crashedFiles(output.join('\n'))).toEqual(['/w/a.test.ts', '/w/b.test.ts']);
  });

  it('gives up when a test failed as well', () => {
    const output = `${crash('/w/a.test.ts')}\n${summary('1 failed | 517 passed (529)', '1 error')}`;
    expect(crashedFiles(output)).toBeUndefined();
  });

  it('gives up when there are more errors than crashes', () => {
    expect(
      crashedFiles(`${crash('/w/a.test.ts')}\n${summary(passed, '2 errors')}`),
    ).toBeUndefined();
  });

  it('gives up on another signal or no crash at all', () => {
    const sigsegv = crash('/w/a.test.ts').replace('SIGTRAP', 'SIGSEGV');
    expect(crashedFiles(`${sigsegv}\n${summary(passed, '1 error')}`)).toBeUndefined();
    expect(crashedFiles(summary('1 failed | 517 passed (529)', '0 errors'))).toBeUndefined();
  });
});
