#!/usr/bin/env node
// Writes the nginx configuration of the Docker image's response headers from
// apps/web/public/_headers (ADR-0091 §3):
//
//   pnpm docker:headers                      # rewrites docker/nginx/maps.conf and headers.conf
//   node scripts/nginx-headers.mjs --expect /assets/a.js
//                                            # prints the `name: value` lines the file gives that path
//
// The `/*` rule becomes `add_header … always;` lines. Every other rule becomes an
// entry of a `map $uri $extrudo_<name>` per header name, sent by one `add_header`:
// nginx omits a header whose value is empty, so paths outside the maps get none.
// An `add_header` inside a `location` would replace the ones of the server block,
// which is why the cache rules are maps.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { headersFor, parseHeaders } from '../apps/web/pwa/headers.ts';

const ROOT = new URL('../', import.meta.url);
export const HEADERS_PATH = 'apps/web/public/_headers';
const BANNER =
  '# Generated from apps/web/public/_headers by scripts/nginx-headers.mjs; do not edit.\n';

const quote = (value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const variable = (name) => `$extrudo_${name.toLowerCase().replaceAll('-', '_')}`;

/** The texts of docker/nginx/maps.conf and headers.conf for the contents of a `_headers` file. */
export function nginxConfig(headersText) {
  const rules = parseHeaders(headersText);
  const common = rules.filter((rule) => rule.pattern === '/*');
  const mapped = new Map(); // header name -> [{ pattern, value }]
  for (const rule of rules) {
    if (rule.pattern === '/*') continue;
    for (const { name, value } of rule.headers) {
      if (!mapped.has(name)) mapped.set(name, []);
      mapped.get(name).push({ pattern: rule.pattern, value });
    }
  }

  let maps = BANNER;
  for (const [name, entries] of mapped) {
    maps += `\nmap $uri ${variable(name)} {\n  default "";\n`;
    for (const { pattern, value } of entries) {
      const key = pattern.endsWith('*') ? `~^${pattern.slice(0, -1)}` : pattern;
      maps += `  ${quote(key)} ${quote(value)};\n`;
    }
    maps += '}\n';
  }

  let headers = BANNER;
  for (const rule of common) {
    for (const { name, value } of rule.headers) {
      headers += `add_header ${name} ${quote(value)} always;\n`;
    }
  }
  for (const name of mapped.keys()) headers += `add_header ${name} ${variable(name)} always;\n`;
  return { maps, headers };
}

/** The `name: value` lines `_headers` gives a path (what the smoke script expects). */
export function expectedHeaders(headersText, path) {
  return Object.entries(headersFor(parseHeaders(headersText), path)).map(
    ([name, value]) => `${name}: ${value}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = readFileSync(new URL(HEADERS_PATH, ROOT), 'utf8');
  const i = process.argv.indexOf('--expect');
  if (i >= 0) {
    const path = process.argv[i + 1];
    if (!path) throw new Error('--expect needs a path');
    console.log(expectedHeaders(text, path).join('\n'));
  } else {
    const { maps, headers } = nginxConfig(text);
    writeFileSync(new URL('docker/nginx/maps.conf', ROOT), maps);
    writeFileSync(new URL('docker/nginx/headers.conf', ROOT), headers);
    console.log('Wrote docker/nginx/maps.conf and docker/nginx/headers.conf');
  }
}
