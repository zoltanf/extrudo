import { readFileSync } from 'node:fs';
import type { Sheet } from '@extrudo/core';
import type { DisplayList, DisplayPath, DisplayText } from '@extrudo/io';
import { loadFont } from '@extrudo/sketch/text';
import { beforeAll, describe, expect, it } from 'vitest';
import { A3, A4, CUSTOM, FRONT_LINES, IDS, SAMPLE_SHEETS } from './fixtures';
import { layoutSheet, SHEET_LINE, sheetMargin, VIEW_PLACEHOLDER } from './layout';
import { fitLine, LINE_SPACING, SHEET_FONT, textWidth, wrapText } from './text';
import { SHEET_TITLE_BLOCKS, sheetTitleFields } from './title-block';

beforeAll(() => {
  const fonts = new URL('../../fonts/fonts/', import.meta.url);
  loadFont(SHEET_FONT.regular, readFileSync(new URL('inter-regular.ttf', fonts)));
  loadFont(SHEET_FONT.bold, readFileSync(new URL('inter-bold.ttf', fonts)));
});

const texts = (list: DisplayList, key?: string) =>
  list.items.filter((i): i is DisplayText => i.type === 'text' && (!key || i.key === key));
const paths = (list: DisplayList, key: string) =>
  list.items.filter((i): i is DisplayPath => i.type === 'path' && i.key === key);
const run = (list: DisplayList, text: string) => texts(list).find((t) => t.text === text);
/** The x of a run's middle. */
const middle = (t: DisplayText | undefined) => (t ? t.at[0] + t.width / 2 : Number.NaN);

describe('layoutSheet: paper and size', () => {
  it('lays an A3 landscape, an A4 portrait and a custom sheet out at their sizes, paper first', () => {
    const sizes = [A3, A4, CUSTOM].map((s) => {
      const list = layoutSheet(s);
      const paper = list.items[0];
      expect(paper).toMatchObject({ type: 'path', key: 'paper', fill: { color: '#ffffff' } });
      expect(paper?.type === 'path' && paper.contours[0]?.segments[1]?.to).toEqual([
        list.width,
        list.height,
      ]);
      return [list.width, list.height];
    });
    // The custom sheet is [100, 150] turned landscape.
    expect(sizes).toEqual([
      [420, 297],
      [210, 297],
      [150, 100],
    ]);
  });

  it('draws nothing but the paper and its items without a border or a title block', () => {
    const list = layoutSheet(CUSTOM);
    expect(list.items.map((i) => i.key)).toEqual(['paper', `item:${IDS.small}`]);
  });

  it('gives the same list for the same sheet', () => {
    expect(layoutSheet(A3, { sheets: SAMPLE_SHEETS })).toEqual(
      layoutSheet(structuredClone(A3), { sheets: structuredClone(SAMPLE_SHEETS) }),
    );
  });
});

describe('layoutSheet: border', () => {
  it('draws the border 10 mm in, with centring marks, and no zones unless asked', () => {
    const list = layoutSheet(A4);
    const [frame, marks] = paths(list, 'border');
    expect(frame?.contours[0]?.start).toEqual([10, 10]);
    expect(frame?.contours[0]?.segments[1]?.to).toEqual([200, 287]);
    expect(frame?.stroke?.width).toBe(SHEET_LINE.visible);
    expect(marks?.contours).toHaveLength(4);
    expect(texts(list, 'border')).toEqual([]);
  });

  it('numbers zones of about 50 mm left to right and letters them top to bottom', () => {
    const list = layoutSheet(A3);
    const labels = texts(list, 'border').map((t) => t.text);
    // A3: 400 × 277 mm inside the border, 8 × 6 zones, each label on both sides.
    expect(labels.filter((t) => /\d/.test(t)).sort()).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8'].flatMap((n) => [n, n]),
    );
    expect(labels.filter((t) => /[A-Z]/.test(t)).sort()).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((n) => [n, n]),
    );
    // The first number sits in the middle of the first zone, in the top margin.
    const one = texts(list, 'border').filter((t) => t.text === '1');
    expect(middle(one[0])).toBeCloseTo(10 + 400 / 16, 6);
    expect(one.map((t) => t.at[1])).toEqual([(10 + 3.5) / 2, 297 - (10 - 3.5) / 2]);
    // Ticks between zones, on all four sides, plus the four centring marks.
    expect(paths(list, 'border')[1]?.contours).toHaveLength(4 + 2 * 7 + 2 * 5);
  });

  it('skips I and O and shrinks its margin on a small sheet', () => {
    const tall: Sheet = {
      ...CUSTOM,
      size: [100, 600],
      orientation: 'portrait',
      border: { zones: true },
    };
    const letters = texts(layoutSheet(tall), 'border')
      .map((t) => t.text)
      .filter((t) => /[A-Z]/.test(t));
    expect(new Set(letters)).toEqual(new Set('ABCDEFGHJKLM'));
    expect(sheetMargin(tall)).toBe(5);
  });
});

describe('layoutSheet: title block', () => {
  it('puts the simple block in the lower right corner against the border', () => {
    const list = layoutSheet(A4, { sheets: SAMPLE_SHEETS });
    const [cells, frame] = paths(list, 'title-block');
    const { width, height } = SHEET_TITLE_BLOCKS.simple;
    expect(frame?.contours[0]?.start).toEqual([200 - width, 287 - height]);
    expect(frame?.stroke?.width).toBe(SHEET_LINE.visible);
    expect(cells?.contours).toHaveLength(7);
    expect(cells?.stroke?.width).toBe(SHEET_LINE.hidden);
  });

  it('shows typed fields, the derived scale and sheet n of N, and labels alone for empty fields', () => {
    const list = layoutSheet(A4, { sheets: SAMPLE_SHEETS });
    const cell = (field: string) => texts(list, `title-block:${field}`).map((t) => t.text);
    expect(cell('title')).toEqual(['TITLE', 'Lid']);
    expect(cell('version')).toEqual(['VERSION', 'V3']);
    expect(cell('scale')).toEqual(['SCALE', '1:1']);
    expect(cell('sheet')).toEqual(['SHEET', '2 / 3']);
    expect(cell('drawnBy')).toEqual(['DRAWN BY']);
    expect(cell('date')).toEqual(['DATE']);
    // The title in bold at 5 mm, the label at 1.6 mm in the muted colour.
    const [label, title] = texts(list, 'title-block:title');
    expect(label).toMatchObject({ height: 1.6, color: '#5b6375' });
    expect(title).toMatchObject({ height: 5 });
    expect(title?.at[0]).toBeCloseTo(200 - 160 + 1.5, 9);
    // Bold Inter is wider than Regular.
    expect(title?.width).toBeCloseTo(textWidth('Lid', 5, 'bold'), 9);
  });

  it('draws the full block with its own fields and the projection angle', () => {
    const list = layoutSheet(A3);
    const cell = (field: string) => texts(list, `title-block:${field}`).map((t) => t.text);
    expect(cell('partNumber')).toEqual(['PART NUMBER', 'BX-001']);
    expect(cell('material')).toEqual(['MATERIAL', 'PLA']);
    expect(cell('checkedBy')).toEqual(['CHECKED BY']);
    expect(cell('projection')).toEqual(['PROJECTION', 'First angle']);
    expect(cell('scale')).toEqual(['SCALE', '1:2']);
    // Without the design's sheets the sheet is 1 of 1.
    expect(cell('sheet')).toEqual(['SHEET', '1 / 1']);
    const frame = paths(list, 'title-block')[1];
    expect(frame?.contours[0]?.start).toEqual([410 - 180, 287 - 40]);
  });

  it('never shows a typed value for a derived field', () => {
    const typed: Sheet = {
      ...A4,
      titleBlock: { template: 'simple', fields: { scale: '9:9', sheet: '7' } },
    };
    const list = layoutSheet(typed);
    expect(texts(list, 'title-block:scale').map((t) => t.text)).toEqual(['SCALE', '1:1']);
    expect(texts(list, 'title-block:sheet').map((t) => t.text)).toEqual(['SHEET', '1 / 1']);
  });

  it('fits a long value into its cell: smaller, then cut', () => {
    const title = 'A very long title that goes on and on about the box and its lid and the screws';
    const list = layoutSheet({ ...A4, titleBlock: { template: 'simple', fields: { title } } });
    const value = texts(list, 'title-block:title')[1];
    expect(value?.width).toBeLessThanOrEqual(90 - 3 + 1e-9);
    expect(value?.height).toBe(1.8);
    expect(value?.text.endsWith('…')).toBe(true);
    expect(fitLine('Short', 5, 87, 1.8)).toEqual({ text: 'Short', height: 5 });
  });

  it('lists the fields a person types, without the derived ones', () => {
    expect(sheetTitleFields('simple').map((f) => f.field)).toEqual([
      'title',
      'drawnBy',
      'date',
      'units',
      'version',
    ]);
    expect(sheetTitleFields('full').map((f) => f.field)).not.toContain('projection');
  });
});

describe('layoutSheet: text items', () => {
  it('wraps at the width and breaks at newlines, one run per line from the top-left corner', () => {
    const list = layoutSheet(A3);
    const lines = texts(list, `item:${IDS.notes}`);
    expect(lines.map((l) => l.text)).toEqual([
      '1. The lid clears the box by 0.20 mm all round, Ø12',
      '±0.1 at 45°.',
      '2. Wall and floor 3 mm.',
    ]);
    // Default letter height 3.5; the first baseline one letter height below `at`.
    lines.forEach((l, i) => {
      expect(l.height).toBe(3.5);
      expect(l.at).toEqual([250, 50 + 3.5 + i * 3.5 * LINE_SPACING]);
      expect(l.width).toBeLessThanOrEqual(120);
      expect(l.outline.length).toBeGreaterThan(0);
    });
    // Capitals reach from the baseline up one letter height: y down, so above it.
    const heading = run(list, 'NOTES') as DisplayText;
    expect(heading.height).toBe(5);
    const ys = heading.outline.flatMap((c) => [c.start[1], ...c.segments.map((s) => s.to[1])]);
    // (The round S overshoots the cap height a little.)
    expect(Math.abs(Math.min(...ys) - 40)).toBeLessThan(0.1);
    expect(Math.abs(Math.max(...ys) - 45)).toBeLessThan(0.1);
  });

  it('wraps words, breaks a word longer than the width, keeps blank lines', () => {
    expect(wrapText('one two three', 3.5)).toEqual(['one two three']);
    expect(wrapText('a\n\nb', 3.5, 100)).toEqual(['a', '', 'b']);
    const narrow = textWidth('one two', 3.5) + 0.1;
    expect(wrapText('one two three', 3.5, narrow)).toEqual(['one two', 'three']);
    const broken = wrapText('Supercalifragilistic', 3.5, 10);
    expect(broken.length).toBeGreaterThan(1);
    expect(broken.join('')).toBe('Supercalifragilistic');
    for (const line of broken) expect(textWidth(line, 3.5)).toBeLessThanOrEqual(10);
  });
});

describe('layoutSheet: views', () => {
  it('draws a view without lines as a thin frame with its name', () => {
    const list = layoutSheet(A3);
    const [frame] = paths(list, `view:${IDS.top}`);
    const { width: w, height: h } = VIEW_PLACEHOLDER;
    expect(frame?.contours[0]?.start).toEqual([120 - w / 2, 200 - h / 2]);
    expect(frame?.stroke?.width).toBe(SHEET_LINE.thin);
    const name = texts(list, `view:${IDS.top}`)[0];
    expect(name?.text).toBe('Top');
    expect(middle(name)).toBeCloseTo(120, 9);
  });

  it("scales a view's lines, flips them onto the sheet and draws each kind in its line", () => {
    const views = new Map([[IDS.front, FRONT_LINES]]);
    const list = layoutSheet(A3, { views });
    const drawn = paths(list, `view:${IDS.front}`);
    expect(drawn.map((p) => p.stroke?.width)).toEqual([0.25, 0.18, 0.18, 0.5]);
    expect(drawn[0]?.stroke?.dash).toEqual([3, 1.5]);
    const visible = drawn[3] as DisplayPath;
    // The plate's corner (-80, -40) at 1:2, y flipped, from the view's origin (120, 110).
    expect(visible.contours[0]?.start).toEqual([80, 130]);
    // The quarter arc turns from +x to +y in the view; y flipped, its sweep turns the other way.
    expect(visible.contours[2]?.segments[0]).toMatchObject({
      type: 'arc',
      center: [90, 110],
      sweep: -Math.PI / 2,
      to: [90, 105],
    });
    // The label under the lowest line (the centre line's end, 48 mm down at 1:2): the
    // scale is the sheet's, so the name alone.
    const label = texts(list, `view:${IDS.front}`)[0];
    expect(label?.text).toBe('Front');
    expect(label?.at[1]).toBeCloseTo(110 + 24 + 4 + 3.5, 9);
  });

  it("follows the view's style and switches, and a projected view its parent's scale", () => {
    const sheet: Sheet = {
      ...A3,
      views: [
        {
          ...(A3.views[0] as Sheet['views'][number]),
          style: 'visible',
          scale: [1, 4],
          tangentEdges: false,
        },
        { ...(A3.views[1] as Sheet['views'][number]), centreLines: false, label: true },
      ],
    };
    const views = new Map([
      [IDS.front, FRONT_LINES],
      [IDS.top, FRONT_LINES],
    ]);
    const list = layoutSheet(sheet, { views });
    expect(paths(list, `view:${IDS.front}`).map((p) => p.stroke?.width)).toEqual([0.18, 0.5]);
    const top = paths(list, `view:${IDS.top}`);
    // Hidden lines off from the parent's style; centre lines off on the view itself.
    expect(top.map((p) => p.stroke?.width)).toEqual([0.18, 0.5]);
    // 1:4 from the parent: the corner (-80, -40) lands at (120 - 20, 200 + 10).
    expect(top[1]?.contours[0]?.start).toEqual([100, 210]);
    expect(texts(list, `view:${IDS.front}`)[0]?.text).toBe('Front (1:4)');
    expect(texts(list, `view:${IDS.top}`)[0]?.text).toBe('Top (1:4)');
  });
});
