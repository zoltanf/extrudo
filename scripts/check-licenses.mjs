#!/usr/bin/env node
// Fails when a production dependency has a license that isn't on the allow-list
// below. Every license here is compatible with distributing Extrudo under the
// GPL-3.0-or-later (NOTICE lists the components). A new license means someone
// reads it, adds it here and mentions the package in NOTICE.
//
// Uses `pnpm licenses list --prod --json` (the lockfile's packages, installed).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

if (problems.length > 0) {
  console.error(`License check failed:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`License check: ${packages} production packages, all on the allow-list.`);
