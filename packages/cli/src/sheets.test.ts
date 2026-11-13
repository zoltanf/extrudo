// Sheets from the command line (P6-24 S6, ADR-0143's S6 amendment): `info`
// lists them, `export --format pdf|svg` writes them through the kernel's
// `sheetModelNow` and `@extrudo/sheets`' `sheetFiles`, and `check --sheets`
// fails on a detached anchor. Each case spawns the binary on the drawing
// fixture (`fixtures/sheets/plate.extrudo`, built by `sheet-fixture.ts`).
//
//   UPDATE_FIXTURE=1 pnpm vitest run packages/cli/src/sheets   # writes the fixture again

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Design } from '@extrudo/api';
import { readArchive, writeArchive } from '@extrudo/storage';
import { unzlibSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from './cli';
import { SHEET_FIXTURE, sheetFixture } from './sheet-fixture';

const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/extrudo.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPAWNING = { timeout: 60_000 } as const;
const ENV = process.env;

let dir: string;
let design: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'extrudo-sheets-'));
  design = join(dir, 'plate.extrudo');
  await writeFile(design, await readFile(join(ROOT, SHEET_FIXTURE)));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function extrudo(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run('node', [BIN, ...args], { maxBuffer: 32 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

/** A PDF's page count and the strings of its selectable layer (the hex `Tj` operands), streams inflated. */
function readPdf(bytes: Uint8Array): { pages: number; strings: string[] } {
  const file = latin1(bytes);
  const strings: string[] = [];
  for (const match of file.matchAll(/<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const content = latin1(unzlibSync(bytes.subarray(start, start + Number(match[1]))));
    for (const tj of content.matchAll(/<([0-9a-f]*)> Tj/g)) {
      strings.push(
        (tj[1]?.match(/../g) ?? [])
          .map((h) => String.fromCharCode(Number.parseInt(h, 16)))
          .join(''),
      );
    }
  }
  const count = /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(file);
  return { pages: Number(count?.[1] ?? 0), strings };
}

describe('the drawing fixture', () => {
  it('is what sheet-fixture.ts builds', SPAWNING, async () => {
    const built = await sheetFixture();
    if (ENV.UPDATE_FIXTURE) {
      await mkdir(join(ROOT, 'fixtures/sheets'), { recursive: true });
      await writeFile(join(ROOT, SHEET_FIXTURE), writeArchive(built));
    }
    const stored = readArchive(await readFile(join(ROOT, SHEET_FIXTURE)));
    expect(stored.doc).toEqual(built);
    expect(built.sheets?.map((s) => s.name)).toEqual(['Plate', 'Notes']);
  });
});

describe('extrudo info', () => {
  it('lists the sheets: size, scale, views, items, detached anchors', SPAWNING, async () => {
    const text = await extrudo(['info', design]);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain(
      'Sheets:\n  Plate  A3 landscape · 1:1 · 4 views · 9 items\n  Notes  A4 portrait · 1:1 · 0 views · 3 items\n',
    );
    const json = JSON.parse((await extrudo(['info', design, '--json'])).stdout);
    expect(
      json.sheets.map((s: { name: string; detached: number }) => [s.name, s.detached]),
    ).toEqual([
      ['Plate', 0],
      ['Notes', 0],
    ]);
  });
});

describe('extrudo export --format pdf', () => {
  it(
    'writes every sheet as a page, the model measured now and the fields filled',
    SPAWNING,
    async () => {
      const out = join(dir, 'all.pdf');
      const result = await extrudo([
        'export',
        design,
        '--format',
        'pdf',
        '--out',
        out,
        '--version-name',
        'V1',
      ]);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(`Wrote ${out}\n`);
      const pdf = readPdf(new Uint8Array(await readFile(out)));
      expect(pdf.pages).toBe(2);
      for (const text of [
        'Plate and peg',
        '60.0',
        'Ø16.0',
        'Break the edge 1.0 mm',
        // `{date}` is the day the design was last changed, `{version}` the flag's.
        'Drawn 2026-11-11, V1. Sheet 1 of 2.',
        'Printed note',
        'Rev',
        'First drawing',
        'Plate',
        'Peg',
        'PETG',
      ]) {
        expect(pdf.strings, text).toContain(text);
      }
      // A sticky note on screen only stays out of the file unless asked for.
      expect(pdf.strings.join(' ')).not.toContain('On screen');
      expect(pdf.strings.join(' ')).not.toContain('?');
    },
  );

  it(
    'is the same bytes each time, and takes --date, --stickies and --sheet',
    SPAWNING,
    async () => {
      const a = join(dir, 'a.pdf');
      const b = join(dir, 'b.pdf');
      expect((await extrudo(['export', design, '--format', 'pdf', '--out', a])).code).toBe(0);
      expect((await extrudo(['export', design, '--format', 'pdf', '--out', b])).code).toBe(0);
      expect(await readFile(a)).toEqual(await readFile(b));
      // No saved version in the file: `{version}` stays as typed.
      expect(readPdf(new Uint8Array(await readFile(a))).strings).toContain(
        'Drawn 2026-11-11, {version}. Sheet 1 of 2.',
      );
      const c = join(dir, 'c.pdf');
      const args = ['--date', '2027-01-02', '--stickies', '--sheet', 'notes', '--sheet', 'Plate'];
      expect((await extrudo(['export', design, '--format', 'pdf', '--out', c, ...args])).code).toBe(
        0,
      );
      const pdf = readPdf(new Uint8Array(await readFile(c)));
      expect(pdf.pages).toBe(2);
      expect(pdf.strings).toContain('Drawn 2027-01-02, {version}. Sheet 1 of 2.');
      expect(pdf.strings.join(' ')).toContain('On screen');
      // One sheet of several: beside the design, named after both.
      const one = await extrudo([
        'export',
        design,
        '--format',
        'pdf',
        '--sheet',
        'Notes',
        '--json',
      ]);
      expect(one.code).toBe(0);
      const [file] = JSON.parse(one.stdout).files;
      expect(file).toMatchObject({ name: 'Plate - Notes.pdf', sheets: ['Notes'] });
      expect(readPdf(new Uint8Array(await readFile(file.path))).pages).toBe(1);
    },
  );

  it('refuses a sheet the design has not, and a design without sheets', SPAWNING, async () => {
    const missing = await extrudo(['export', design, '--format', 'pdf', '--sheet', 'Lid']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain(
      'There is no sheet "Lid" in this design. It has: Plate, Notes.',
    );
    const bare = join(dir, 'bare.extrudo');
    await writeFile(bare, await Design.create({ name: 'Bare' }).toFile());
    const none = await extrudo(['export', bare, '--format', 'pdf']);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('This design has no sheets.');
  });
});

describe('extrudo export --format svg', () => {
  it('writes one SVG per sheet into the --out folder, or one file', SPAWNING, async () => {
    const folder = join(dir, 'svgs');
    const result = await extrudo(['export', design, '--format', 'svg', '--out', folder]);
    expect(result.code).toBe(0);
    expect((await readdir(folder)).sort()).toEqual(['Plate - Notes.svg', 'Plate - Plate.svg']);
    const plate = await readFile(join(folder, 'Plate - Plate.svg'), 'utf8');
    expect(plate).toContain('<title>Plate – Plate</title>');
    expect(plate).toContain('Ø16.0');
    const notes = await readFile(join(folder, 'Plate - Notes.svg'), 'utf8');
    expect(notes).toContain('First drawing');
    expect(notes).not.toContain('On screen');
    const single = join(dir, 'notes.svg');
    expect(
      (await extrudo(['export', design, '--format', 'svg', '--sheet', 'Notes', '--out', single]))
        .code,
    ).toBe(0);
    expect(await readFile(single, 'utf8')).toBe(notes);
  });
});

describe('extrudo check --sheets', () => {
  it('passes with every anchor found, and fails on a detached one', SPAWNING, async () => {
    const ok = await extrudo(['check', design, '--sheets']);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toBe('Plate: no detached anchors (2 sheets).\n');
    // The peg suppressed: its diameter, centre mark and balloon lose their anchors.
    const broken = Design.from(readArchive(await readFile(design)).doc);
    const peg = broken.doc.features.find((f) => f.name === 'Peg');
    if (!peg) throw new Error('no peg');
    broken.suppress(peg.id);
    const path = join(dir, 'detached.extrudo');
    await writeFile(path, await broken.toFile());
    const failed = await extrudo(['check', path, '--sheets']);
    expect(failed.code).toBe(2);
    expect(failed.stderr).toContain('Plate: 3 detached anchors.');
    expect(failed.stderr).toMatch(
      /Plate: Dimension \S+ is detached: Peg, the feature this was measured on, is suppressed\./,
    );
    const json = JSON.parse((await extrudo(['check', path, '--sheets', '--json'])).stdout);
    expect(json.ok).toBe(false);
    expect(json.sheets[0].problems.map((p: { kind: string }) => p.kind)).toEqual([
      'dimension',
      'centreMark',
      'balloon',
    ]);
    // A detached dimension is written as its text with "?", never as the old value.
    const out = join(dir, 'detached.pdf');
    expect((await extrudo(['export', path, '--format', 'pdf', '--out', out])).code).toBe(0);
    const strings = readPdf(new Uint8Array(await readFile(out))).strings;
    expect(strings).toContain('Ø?');
    expect(strings).not.toContain('Ø16.0');
  });
});

describe('the sheet flags', () => {
  it('belong to a sheet export or check', () => {
    expect(() => parse(['export', 'a.extrudo', '--format', 'stl', '--sheet', 'A'])).toThrow(
      '--sheet is for extrudo export --format pdf or svg.',
    );
    expect(() => parse(['export', 'a.extrudo', '--format', 'pdf', '--bodies', 'A'])).toThrow(
      '--bodies is for a model export, not --format pdf.',
    );
    expect(() => parse(['info', 'a.extrudo', '--sheets'])).toThrow(
      '--sheets is for extrudo check, not info.',
    );
    expect(() => parse(['check', 'a.extrudo', '--sheets', '--joints'])).toThrow(
      'extrudo check takes --joints or --sheets, not both.',
    );
    expect(() => parse(['export', 'a.extrudo', '--format', 'pdf', '--date', '2026-02-30'])).toThrow(
      '--date takes YYYY-MM-DD or today',
    );
    expect(() => parse(['export', 'a.extrudo', '--format', 'pdf', '--density', 'x'])).toThrow(
      '--density takes g/cm³',
    );
    expect(parse(['export', 'a.extrudo', '--format', 'svg', '--density', '1.24'])).toMatchObject({
      density: 1.24,
    });
  });
});
