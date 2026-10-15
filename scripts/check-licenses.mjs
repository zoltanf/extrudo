#!/usr/bin/env node
// Fails when a production dependency has a license that isn't on the allow-list
// below. Every license here is compatible with distributing Extrudo under the
// GPL-3.0-or-later (NOTICE lists the components). A new license means someone
// reads it, adds it here and mentions the package in NOTICE.
//
// Uses `pnpm licenses list --prod --json` (the lockfile's packages, installed).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'OFL-1.1', // the bundled fonts
  'LGPL-2.0-or-later', // planegcs's JavaScript wrapper
  'LGPL-2.1-or-later',
  'GPL-3.0-or-later',
  // OpenSCAD (ADR-0071). Its WASM is not an npm dependency (packages/openscad
  // mirrors OpenSCAD's own build, NOTICE §1); listed for whatever of it may come
  // through npm later.
  'GPL-2.0-or-later',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
]);

const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  cwd: new URL('..', import.meta.url),
});
const byLicense = JSON.parse(raw);
const notice = readFileSync(new URL('../NOTICE', import.meta.url), 'utf8');

/** An SPDX expression is fine when every `AND` part has an allowed alternative. */
function acceptable(expression) {
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+AND\s+/)
    .every((part) => part.split(/\s+OR\s+/).some((id) => ALLOWED.has(id.trim())));
}

const problems = [];
let packages = 0;
for (const [license, list] of Object.entries(byLicense)) {
  for (const pkg of list) {
    packages += 1;
    if (!acceptable(license)) {
      problems.push(`${pkg.name}@${pkg.versions.join(', ')}: license "${license}" is not allowed`);
    }
    // The bundled fonts and the LGPL wrapper must be named in NOTICE.
    if (/^(OFL|LGPL)/.test(license) && !notice.includes(pkg.name)) {
      problems.push(`${pkg.name}: ${license}, but NOTICE does not name it`);
    }
  }
}

// Development dependencies the desktop app bundles into `out/main`, so the
// installer redistributes them (`--prod` doesn't see a devDependency): each
// root and everything it depends on goes through the same allow-list
// (P6-08, ADR-0087: the MCP SDK). NOTICE names the roots.
const BUNDLED_DEV = [{ from: 'apps/desktop', name: '@modelcontextprotocol/sdk' }];

/** The package's real folder, looked up the way Node resolves from `fromDir`. */
function findPackage(fromDir, name) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidates = [join(dir, 'node_modules', name)];
    if (basename(dir) === 'node_modules') candidates.push(join(dir, name));
    for (const candidate of candidates) {
      if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    }
    if (dirname(dir) === dir) return undefined;
  }
}

const root = new URL('..', import.meta.url).pathname;
const seen = new Set();
for (const { from, name } of BUNDLED_DEV) {
  if (!notice.includes(name)) problems.push(`${name}: bundled, but NOTICE does not name it`);
  const queue = [[join(root, from), name]];
  while (queue.length > 0) {
    const [fromDir, dep] = queue.pop();
    const dir = findPackage(fromDir, dep);
    if (!dir) {
      problems.push(`${dep}: bundled dependency not installed (run pnpm install)`);
      continue;
    }
    if (seen.has(dir)) continue;
    seen.add(dir);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    packages += 1;
    const license = typeof pkg.license === 'string' ? pkg.license : String(pkg.license?.type);
    if (!acceptable(license)) {
      problems.push(
        `${pkg.name}@${pkg.version} (bundled by ${from}): license "${license}" is not allowed`,
      );
    }
    for (const next of Object.keys(pkg.dependencies ?? {})) queue.push([dir, next]);
  }
}

if (problems.length > 0) {
  console.error(`License check failed:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`License check: ${packages} production packages, all on the allow-list.`);
