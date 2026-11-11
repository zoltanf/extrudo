// A sample sheet set as PDF and SVG, to look at in other readers (P6-24 S1):
//   SHEETS_OUT=/some/dir pnpm vitest run packages/sheets/src/sample
// writes sheets.pdf and one SVG per sheet into that directory.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sheet } from '@extrudo/core';
import { loadFont } from '@extrudo/sketch/text';
import { describe, expect, it } from 'vitest';
import { FRONT_LINES, IDS, SAMPLE_SHEETS } from './fixtures';
import { sheetsToPdf, sheetToSvg } from './output';

const ENV =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const FONTS = new URL('../../fonts/fonts/', import.meta.url);
loadFont('inter-regular@1', readFileSync(new URL('inter-regular.ttf', FONTS)));
loadFont('inter-bold@1', readFileSync(new URL('inter-bold.ttf', FONTS)));

describe('the S1 sample sheets', () => {
  it.skipIf(!ENV.SHEETS_OUT)('writes a PDF and an SVG per sheet', () => {
    const dir = ENV.SHEETS_OUT as string;
    const sheets: Sheet[] = SAMPLE_SHEETS;
    const views = new Map([[IDS.front, FRONT_LINES]]);
    const pdf = sheetsToPdf(sheets, { name: 'Box with a lid', views });
    expect(pdf.length).toBeGreaterThan(1000);
    writeFileSync(join(dir, 'sheets.pdf'), pdf);
    sheets.forEach((sheet, i) => {
      writeFileSync(
        join(dir, `sheet-${i + 1}.svg`),
        sheetToSvg(sheet, { name: 'Box with a lid', sheets, views }),
      );
    });
  });
});
