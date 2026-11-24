// The React Compiler memoises every component and hook it can (ADR-0102 §3), and skips, without
// a word in the build, any it can't: a ref written during render, a closure that reads a ref
// handed to a function called during render, a three.js object changed in render… A skipped
// component renders all of its children whenever it renders (ADR-0159). This test runs the
// compiler the way the build does (`vite.config.ts`: `oxc-transform-react`, target 19) in lint
// mode over the app's sources and compares the skipped components and hooks with the list in
// `compiler-skips.json`: a component that compiles today must keep compiling, and one that
// starts compiling comes off the list. After a deliberate change, rewrite the list with
// `EXTRUDO_UPDATE_COMPILER_SKIPS=1 pnpm vitest run apps/web/src/compiler.test.ts`, then
// `pnpm format`.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'oxc-transform-react';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
const LIST = join(SRC, '../compiler-skips.json');

/** The files the build compiles: the app's sources, not tests, type files or workers. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.|\.d\.ts$|[wW]orker\.ts$/.test(name) ? [path] : [];
  });
}

/** A top-level declaration (Biome puts them at column 0): its name. */
const DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([\w$]+)|(?:const|let|var)\s+([\w$]+))/;

/** The name of the top-level declaration that holds the character at `offset`. */
function declarationAt(lines: readonly string[], starts: readonly number[], offset: number) {
  let line = starts.findLastIndex((start) => start <= offset);
  for (; line >= 0; line--) {
    const match = DECLARATION.exec(lines[line] ?? '');
    if (match) return match[1] ?? match[2] ?? '(module)';
  }
  return '(module)';
}

/** The components and hooks the compiler skips in a file, by name. */
function skipped(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const bytes = Buffer.from(text);
  const { errors } = transformSync(path, text, {
    lang: path.endsWith('x') ? 'tsx' : 'ts',
    reactCompiler: { target: '19', outputMode: 'lint', panicThreshold: 'none' },
  });
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  const names = new Set<string>();
  for (const error of errors) {
    if (!/skipped optimizing/.test(error.codeframe ?? '')) continue;
    // Label offsets are UTF-8 bytes; the source lines are UTF-16.
    const byte = error.labels[0]?.start ?? 0;
    names.add(declarationAt(lines, starts, bytes.subarray(0, byte).toString('utf8').length));
  }
  return [...names].sort();
}

describe('the React Compiler', () => {
  it('skips no component or hook that is not on the list', () => {
    const now: Record<string, string[]> = {};
    for (const path of sources(SRC).sort()) {
      const names = skipped(path);
      if (names.length > 0) now[relative(SRC, path).split('\\').join('/')] = names;
    }
    if (process.env.EXTRUDO_UPDATE_COMPILER_SKIPS) {
      writeFileSync(LIST, `${JSON.stringify(now, null, 2)}\n`);
      return;
    }
    const listed = JSON.parse(readFileSync(LIST, 'utf8')) as Record<string, string[]>;
    const key = (file: string, name: string) => `${file} › ${name}`;
    const all = (list: Record<string, string[]>) =>
      new Set(Object.entries(list).flatMap(([file, names]) => names.map((n) => key(file, n))));
    const before = all(listed);
    const after = all(now);
    // A component that compiled stops compiling: fix it, or (deliberately) add it to the list.
    expect(
      [...after].filter((k) => !before.has(k)),
      'newly skipped',
    ).toEqual([]);
    // A listed one compiles now: take it off the list, so it stays compiled.
    expect(
      [...before].filter((k) => !after.has(k)),
      'compiles now, off the list',
    ).toEqual([]);
  }, 60_000);
});
