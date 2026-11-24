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
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'oxc-transform-react';
import { parseAst } from 'vite';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
const LIST = join(SRC, '../compiler-skips.json');

/** Components that must compile, whatever the list says (ADR-0159 §6). */
const MUST_COMPILE = ['shell/AppShell.tsx › Shell'];

// biome-ignore lint/suspicious/noExplicitAny: an ESTree node, walked generically.
type Node = any;

/** The names a pattern binds (`a`, `{ a, b: c }`, `[a, ...b]`, `a = 1`). */
function bound(pattern: Node, out: string[] = []): string[] {
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.push(pattern.name);
  else if (pattern.type === 'ObjectPattern')
    for (const p of pattern.properties) bound(p.type === 'RestElement' ? p.argument : p.value, out);
  else if (pattern.type === 'ArrayPattern') for (const p of pattern.elements) bound(p, out);
  else if (pattern.type === 'AssignmentPattern') bound(pattern.left, out);
  else if (pattern.type === 'RestElement') bound(pattern.argument, out);
  return out;
}

/**
 * Closures in a component that use a name the component declares further down. The React
 * Compiler builds such a value inside the closure's memo scope, so it is made again whenever
 * anything the closure reads changes (ADR-0159 §6). A name a nested function binds itself (a
 * parameter, its own declaration) shadows the component's; property names and keys don't count.
 */
function forwardReferences(file: string, component: string): string[] {
  const ast = parseAst(readFileSync(file, 'utf8'), { lang: 'tsx' }) as Node;
  const fn = ast.body.find(
    (s: Node) => s.type === 'FunctionDeclaration' && s.id?.name === component,
  );
  if (!fn) throw new Error(`${component} isn't in ${file}`);
  const statements: Node[] = fn.body.body;
  const declaredAt = new Map<string, number>();
  statements.forEach((s, i) => {
    if (s.type === 'VariableDeclaration')
      for (const d of s.declarations) for (const n of bound(d.id)) declaredAt.set(n, i);
    if (s.type === 'FunctionDeclaration') declaredAt.set(s.id.name, i);
  });
  const own = (f: Node) => {
    const names = new Set<string>(f.params.flatMap((p: Node) => bound(p)));
    for (const s of f.body?.type === 'BlockStatement' ? f.body.body : []) {
      if (s.type === 'VariableDeclaration')
        for (const d of s.declarations) for (const n of bound(d.id)) names.add(n);
      if (s.type === 'FunctionDeclaration' && s.id) names.add(s.id.name);
    }
    return names;
  };
  const found = new Set<string>();
  const visit = (node: Node, at: number, parent: Node, key: string, shadow: Set<string>) => {
    if (!node || typeof node.type !== 'string') return;
    let inner = shadow;
    if (/Function/.test(node.type)) inner = new Set([...shadow, ...own(node)]);
    const isKey =
      (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
      (parent?.type === 'Property' && key === 'key' && !parent.computed);
    if (node.type === 'Identifier' && !isKey && !inner.has(node.name)) {
      const later = declaredAt.get(node.name);
      if (later !== undefined && later > at) found.add(node.name);
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'typeAnnotation' || k === 'returnType' || k === 'typeArguments') continue;
      if (k === 'typeParameters' || /^TS/.test((v as Node)?.type ?? '')) continue;
      if (Array.isArray(v)) for (const c of v) visit(c, at, node, k, inner);
      else if (v && typeof v === 'object') visit(v, at, node, k, inner);
    }
  };
  statements.forEach((s, i) => {
    visit(s, i, undefined, '', new Set());
  });
  return [...found].sort();
}

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

  it('compiles the components that must compile', () => {
    const skips = (key: string) => {
      const [file, name] = key.split(' › ') as [string, string];
      return skipped(join(SRC, file)).includes(name);
    };
    expect(MUST_COMPILE.filter(skips), 'must compile').toEqual([]);
  }, 60_000);

  it('Shell uses no name in a closure before it declares it (ADR-0159 §6)', () => {
    expect(forwardReferences(join(SRC, 'shell/AppShell.tsx'), 'Shell')).toEqual([]);
  });

  it('the forward-reference check sees a closure using a later name, and only that', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'forward-ref-')), 'probe.tsx');
    writeFileSync(
      file,
      `function Shell({ a }: { a: number }) {
        const run = (tool: string) => go(tool) + later.size;
        const pose = { run() { return 1; }, call: (run: number) => run };
        const x = pose?.run;
        const later = new Set([a]);
        const go = (t: string) => t.length;
        return run(String(x));
      }`,
    );
    expect(forwardReferences(file, 'Shell')).toEqual(['go', 'later']);
  });
});
