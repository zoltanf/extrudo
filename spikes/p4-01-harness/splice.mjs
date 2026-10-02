// Puts public.inc and private.inc into the facade in place of its P4-01 sections.
// node spikes/p4-01-harness/splice.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const facade = join(here, '../../packages/kernel/occt/facade/extrudo_facade.cpp');
const marker = '  // ------------------------------------------- paths, sweeps and lofts (P4-01) --';
let text = readFileSync(facade, 'utf8');
const pub = readFileSync(join(here, 'public.inc'), 'utf8');
const priv = readFileSync(join(here, 'private.inc'), 'utf8');

const first = text.indexOf(marker);
const errors = text.indexOf('  // ------------------------------------------------------ errors, memory --');
if (first < 0 || errors < first) throw new Error('public markers not found');
text = text.slice(0, first) + pub + text.slice(errors);

const second = text.indexOf(marker, text.indexOf('private:'));
const end = text.lastIndexOf('};');
if (second < 0) throw new Error('private marker not found');
text = `${text.slice(0, second).replace(/\n+$/, '\n')}${priv.replace(/^\n/, '\n')}${text.slice(end)}`;
writeFileSync(facade, text);
console.log('spliced');
