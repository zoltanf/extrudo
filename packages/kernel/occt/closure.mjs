// Expand the config's binding list with what embind needs at run time:
// every base class (else "unbound types" on construct) and, optionally, the
// types our bindings' APIs reference directly (return/argument types).
// `node closure.mjs [--refs]` prints the added symbols as a TS array.
import { readFileSync } from 'node:fs';

// The catalog isn't in the package's exports map; read the file directly.
const catalog = JSON.parse(
  readFileSync(
    new URL('../node_modules/@libcascade/toolchain/generated/symbol-catalog.json', import.meta.url),
    'utf8',
  ),
).symbols;
const byName = new Map(catalog.map((s) => [s.name, s]));
const src = readFileSync(new URL('./libcascade.config.ts', import.meta.url), 'utf8');
const bindings = [
  ...src
    .slice(src.indexOf('bindings:'), src.indexOf('],', src.indexOf('bindings:')))
    .matchAll(/'([A-Za-z0-9_]+)'/g),
].map((m) => m[1]);
const withRefs = process.argv.includes('--refs');
const out = new Set(bindings);
const queue = [...bindings];
const seenRefs = new Set();
while (queue.length) {
  const s = byName.get(queue.shift());
  if (!s) continue;
  const next = [...(s.parents ?? [])];
  // One level of referenced types for the explicitly listed bindings only.
  if (withRefs && bindings.includes(s.name) && !seenRefs.has(s.name)) {
    seenRefs.add(s.name);
    next.push(...(s.referencedTypes ?? []).filter((t) => byName.has(t)));
  }
  for (const n of next)
    if (!out.has(n)) {
      out.add(n);
      queue.push(n);
    }
}
const added = [...out].filter((n) => !bindings.includes(n)).sort();
console.error(
  `${bindings.length} listed, ${added.length} added, ${out.size} total${withRefs ? ' (with referenced types)' : ''}`,
);
console.log(JSON.stringify(added));
