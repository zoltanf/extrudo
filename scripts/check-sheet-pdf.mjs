#!/usr/bin/env node
// Checks a PDF the CLI wrote from a design's sheets (P6-24 S6, ADR-0143): its
// page count and the strings of its selectable text layer. CI runs it after
// `extrudo export fixtures/sheets/plate.extrudo --format pdf`.
//
//   node scripts/check-sheet-pdf.mjs <file.pdf> --pages 2 --text "Plate and peg" [--text …]
//
// Our writer (`packages/io/src/pdf.ts`) deflates each content stream and
// writes the text layer as hex `Tj` operands in WinAnsi; this reads exactly
// that, with Node's own zlib, so it needs no PDF library.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { inflateSync } from 'node:zlib';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { pages: { type: 'string' }, text: { type: 'string', multiple: true } },
});
const [path] = positionals;
if (!path) {
  console.error('Usage: node scripts/check-sheet-pdf.mjs <file.pdf> --pages <n> --text <string>…');
  process.exit(1);
}
const bytes = readFileSync(path);
const file = bytes.toString('latin1');
const problems = [];
if (!file.startsWith('%PDF-')) problems.push('it does not start with %PDF-');
const count = /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(file);
const pages = Number(count?.[1] ?? 0);
if (values.pages !== undefined && pages !== Number(values.pages)) {
  problems.push(`it has ${pages} pages, not ${values.pages}`);
}
const strings = [];
for (const match of file.matchAll(/<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)) {
  const start = match.index + match[0].length;
  const content = inflateSync(bytes.subarray(start, start + Number(match[1]))).toString('latin1');
  for (const tj of content.matchAll(/<([0-9a-f]*)> Tj/g)) {
    strings.push(Buffer.from(tj[1], 'hex').toString('latin1'));
  }
}
for (const text of values.text ?? []) {
  if (!strings.includes(text)) problems.push(`it has no text "${text}"`);
}
if (problems.length > 0) {
  console.error(`${path}: ${problems.join('; ')}.\nIts text: ${JSON.stringify(strings)}`);
  process.exit(1);
}
console.log(`${path}: ${pages} pages, ${strings.length} texts, every one asked for is there.`);
