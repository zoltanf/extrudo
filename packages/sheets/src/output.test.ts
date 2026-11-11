// Golden file: `UPDATE_GOLDEN=1 pnpm vitest run packages/sheets/src/output`
import { readFileSync, writeFileSync } from 'node:fs';
import type { Sheet, SheetItemId } from '@extrudo/core';
import { readSvg, writeDisplayPdf } from '@extrudo/io';
import { loadFont } from '@extrudo/sketch/text';
import { beforeAll, describe, expect, it } from 'vitest';
import { CUSTOM, FRONT_LINES, IDS, SAMPLE_SHEETS } from './fixtures';
import { layoutSheet } from './layout';
import { sheetsToPdf, sheetToSvg } from './output';
import { SHEET_FONT } from './text';

beforeAll(() => {
  const fonts = new URL('../../fonts/fonts/', import.meta.url);
  loadFont(SHEET_FONT.regular, readFileSync(new URL('inter-regular.ttf', fonts)));
  loadFont(SHEET_FONT.bold, readFileSync(new URL('inter-bold.ttf', fonts)));
});

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

/** The strings of a PDF's selectable layer: the hex `Tj` operands, WinAnsi (Latin-1 here). */
function pdfStrings(file: string): string[] {
  return [...file.matchAll(/<([0-9a-f]*)> Tj/g)].map((m) =>
    (m[1]?.match(/../g) ?? []).map((h) => String.fromCharCode(Number.parseInt(h, 16))).join(''),
  );
}

describe('sheetsToPdf', () => {
  const views = new Map([[IDS.front, FRONT_LINES]]);

  it('writes one page per sheet at its true size, in order, titled with the design', () => {
    const file = latin1(sheetsToPdf(SAMPLE_SHEETS, { name: 'Box', views }));
    expect(file).toContain('/Count 3');
    expect([...file.matchAll(/\/MediaBox \[([^\]]*)\]/g)].map((m) => m[1])).toEqual([
      '0 0 1190.551 841.89',
      '0 0 595.276 841.89',
      '0 0 425.197 283.465',
    ]);
    // "Box" as a UTF-16 text string.
    expect(file).toContain('/Title <FEFF0042006f0078>');
  });

  it('is the same bytes for the same sheets', () => {
    const a = sheetsToPdf(SAMPLE_SHEETS, { name: 'Box', views });
    const b = sheetsToPdf(structuredClone(SAMPLE_SHEETS), { name: 'Box', views });
    expect(a).toEqual(b);
  });

  it("carries every text's string for selecting and searching", () => {
    const lists = SAMPLE_SHEETS.map((s) => layoutSheet(s, { sheets: SAMPLE_SHEETS, views }));
    const strings = pdfStrings(latin1(writeDisplayPdf(lists, { compress: false })));
    for (const text of [
      'NOTES',
      '1. The lid clears the box by 0.20 mm all round, Ø12',
      '±0.1 at 45°.',
      'Box with a lid',
      'DRAWN BY',
      'J. Maker',
      'First angle',
      '1 / 3',
      '2 / 3',
      'Lid',
      'Front',
      'Top',
      'Hello, sheet',
    ]) {
      expect(strings).toContain(text);
    }
  });

  it('numbers exported sheets among all the design has', () => {
    const lists = [layoutSheet(SAMPLE_SHEETS[1] as Sheet, { sheets: SAMPLE_SHEETS })];
    expect(pdfStrings(latin1(writeDisplayPdf(lists, { compress: false })))).toContain('2 / 3');
  });
});

describe('sheetToSvg', () => {
  const views = new Map([[IDS.front, FRONT_LINES]]);

  it('writes the sheet at its true size as SVG an SVG reader takes', () => {
    const svg = sheetToSvg(SAMPLE_SHEETS[0] as Sheet, { name: 'Box', views });
    expect(svg).toMatch(/<svg [^>]*width="420mm" height="297mm" viewBox="0 0 420 297">/);
    expect(svg).toContain('<title>Box – Assembly</title>');
    const read = readSvg(svg);
    expect(read.drawing.shapes.length).toBeGreaterThan(50);
    expect(svg).toContain('>Box with a lid</text>');
  });

  it('matches the golden file of a small sheet', () => {
    const sheet: Sheet = {
      ...CUSTOM,
      size: [60, 30],
      border: {},
      items: [{ kind: 'text', id: IDS.small as SheetItemId, at: [8, 8], text: 'Hi', size: 5 }],
    };
    const svg = sheetToSvg(sheet);
    const path = new URL('./golden/small-sheet.svg', import.meta.url);
    if (process.env.UPDATE_GOLDEN) writeFileSync(path, svg);
    expect(svg).toBe(readFileSync(path, 'utf8'));
  });
});
