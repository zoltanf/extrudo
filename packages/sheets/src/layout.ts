/**
 * A sheet as a display list (P6-24 S1, ADR-0143 §7): the paper, the border
 * (with zones when asked), the title block, the views (their lines once
 * slice S2 hands them in, a placeholder until then) and the items (texts,
 * dimensions, notes, centre marks and lines; for an export, sticky notes
 * only when printed), in sheet
 * mm from the top-left corner with y down, the document's own frame. The
 * screen, `writeDisplaySvg` and `writeDisplayPdf` draw the result unchanged.
 *
 * Pure: the same sheet and context give the same list. Nothing here is
 * stored; derived title-block values (scale, sheet n of N, projection) come
 * from the sheets.
 */
import {
  type LengthUnit,
  type Sheet,
  type SheetAnchors,
  type SheetItem,
  type SheetScale,
  type SheetView,
  type SheetViewId,
  sheetPaperSize,
} from '@extrudo/core';
import {
  type Contour,
  type DisplayItem,
  type DisplayList,
  type DisplayStroke,
  flattenContour,
  type Matrix,
  num,
  type Point,
  transformContour,
} from '@extrudo/io';
import { layoutSheetDimension } from './dimensions';
import {
  layoutSheetCentre,
  layoutSheetLeader,
  layoutSheetSticky,
  type SheetOutput,
  sheetItemShown,
} from './notes';
import { fitLine, LINE_SPACING, type SheetFont, textRun, textWidth, wrapText } from './text';
import {
  CELL_PAD,
  LABEL_SIZE,
  SHEET_TITLE_BLOCKS,
  type SheetTitleCell,
  VALUE_MIN,
} from './title-block';

/** Line widths, mm (plan §4.2): visible 0.5, hidden 0.25 dashed, thin lines 0.18. */
export const SHEET_LINE = {
  visible: 0.5,
  hidden: 0.25,
  thin: 0.18,
} as const;

/** Title-block labels and the placeholder's name. */
export const SHEET_MUTED = '#5b6375';
export const SHEET_PAPER = '#ffffff';

/** A text item's letter height when it has none, mm. */
export const SHEET_TEXT_SIZE = 3.5;

const STROKE: Record<SheetLineKind, DisplayStroke> = {
  visible: { width: SHEET_LINE.visible },
  outline: { width: SHEET_LINE.visible },
  hidden: { width: SHEET_LINE.hidden, dash: [3, 1.5], cap: 'butt' },
  tangent: { width: SHEET_LINE.thin },
  centre: { width: SHEET_LINE.thin, dash: [8, 1.5, 1, 1.5], cap: 'butt' },
};

/** The kinds of line a view draws, and the order they are drawn in (visible on top). */
export const SHEET_LINE_KINDS = ['hidden', 'tangent', 'centre', 'outline', 'visible'] as const;
export type SheetLineKind = (typeof SHEET_LINE_KINDS)[number];

/**
 * A view's lines (slice S2's evaluator): contours in the view's own frame,
 * mm at model size (1:1), from the view's origin, y up the sheet. Layout
 * scales them, flips y and moves them to the view's `at`.
 */
export interface SheetViewCurve {
  kind: SheetLineKind;
  /** The model edge's topological name, for picking (S3); layout ignores it. */
  edge?: string;
  contours: readonly Contour[];
}

export interface SheetViewLines {
  curves: readonly SheetViewCurve[];
  /**
   * Around every curve, in the view's frame (mm at 1:1, y up): where the label
   * goes, without flattening the curves. With no curves it is the frame the
   * view keeps while it is empty (its body is gone).
   */
  bounds?: { min: Point; max: Point };
  /**
   * How the screen may mark the view's lines (`"stale"`: being recomputed,
   * drawn dimmed), as a display item's `state`; writers ignore it.
   */
  state?: string;
}

export interface SheetContext {
  /** The design's name: the PDF's and SVG's title. */
  name?: string;
  /** Every sheet of the design in page order, which "sheet n of N" counts. Absent: the sheet alone. */
  sheets?: readonly Sheet[];
  /** Each view's lines by view ID, once computed; a view not here draws as a placeholder. */
  views?: ReadonlyMap<SheetViewId, SheetViewLines>;
  /**
   * The items' anchors (`KernelApi.resolveSheet`, kept across a lost anchor
   * with `keepLastAnchors`); an item not here is drawn detached.
   */
  anchors?: SheetAnchors;
  /** The design's length unit, which dimensions are written in; absent: mm. */
  units?: LengthUnit;
  /**
   * What the list is for. `screen` (the default for `layoutSheet`) draws every
   * sticky note and marks those not printed "On screen only"; `export` (the
   * default for `sheetsToPdf` and `sheetToSvg`) leaves those out.
   */
  output?: SheetOutput;
}

/**
 * What a display item is part of, for the screen's picking: `paper`,
 * `border`, `title-block` (its lines), `title-block:<field>` (a cell's label
 * and value), `view:<id>` and `item:<id>`.
 */
export type SheetDisplayKey =
  | 'paper'
  | 'border'
  | 'title-block'
  | `title-block:${string}`
  | `view:${string}`
  | `item:${string}`;

/** The space between the paper's edge and the border, mm: 10, less on a small sheet. */
export function sheetMargin(sheet: Pick<Sheet, 'size' | 'orientation'>): number {
  const { width, height } = sheetPaperSize(sheet);
  return Math.min(10, Math.min(width, height) / 20);
}

/** A scale as the sheet writes it: `[1, 2]` is "1:2". */
export function formatSheetScale([a, b]: SheetScale): string {
  return `${num(a, 3)}:${num(b, 3)}`;
}

/** The scale a view is drawn at: its own, its parent's for a projected view, else the sheet's. */
export function sheetViewScale(sheet: Sheet, view: SheetView): SheetScale {
  return baseOf(sheet, view)?.scale ?? sheet.scale;
}

/** The base view a view is projected from, through its parents (itself for a base view). */
function baseOf(sheet: Sheet, view: SheetView): SheetView | undefined {
  const seen = new Set<string>();
  let at: SheetView | undefined = view;
  while (at && at.from.kind === 'projected') {
    if (seen.has(at.id)) return undefined;
    seen.add(at.id);
    const parent: SheetViewId = at.from.parent;
    at = sheet.views.find((v) => v.id === parent);
  }
  return at;
}

export function layoutSheet(sheet: Sheet, context: SheetContext = {}): DisplayList {
  const { width, height } = sheetPaperSize(sheet);
  const items: DisplayItem[] = [
    {
      type: 'path',
      contours: [rect(0, 0, width, height)],
      fill: { color: SHEET_PAPER },
      key: 'paper',
    },
  ];
  if (sheet.border) items.push(...border(sheet, width, height));
  if (sheet.titleBlock) items.push(...titleBlock(sheet, context, width, height));
  for (const view of sheet.views)
    items.push(...viewItems(sheet, view, context.views?.get(view.id)));
  for (const item of sheet.items) {
    if (sheetItemShown(sheet, item, context.output)) items.push(...sheetItem(sheet, item, context));
  }
  return { width, height, items };
}

// Border ------------------------------------------------------------------------

/** Zone letters top to bottom: A to Z without I and O (they read as 1 and 0). */
const ZONE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function zoneLetter(i: number): string {
  const letter = ZONE_LETTERS[i % ZONE_LETTERS.length] as string;
  return letter.repeat(Math.floor(i / ZONE_LETTERS.length) + 1);
}

/** An even number of zones of about 50 mm along a border side. */
const zoneCount = (length: number) => Math.max(2, 2 * Math.round(length / 100));

function border(sheet: Sheet, width: number, height: number): DisplayItem[] {
  const m = sheetMargin(sheet);
  const key = 'border';
  const out: DisplayItem[] = [
    {
      type: 'path',
      contours: [rect(m, m, width - m, height - m)],
      stroke: { width: SHEET_LINE.visible, join: 'miter' },
      key,
    },
  ];
  // Centring marks at the middle of each side, from near the paper's edge to the border.
  const reach = 0.4 * m;
  const ticks: Contour[] = [
    line([width / 2, reach], [width / 2, m]),
    line([width / 2, height - m], [width / 2, height - reach]),
    line([reach, height / 2], [m, height / 2]),
    line([width - m, height / 2], [width - reach, height / 2]),
  ];
  if (sheet.border?.zones) {
    const across = zoneCount(width - 2 * m);
    const down = zoneCount(height - 2 * m);
    const zw = (width - 2 * m) / across;
    const zh = (height - 2 * m) / down;
    const size = Math.min(SHEET_TEXT_SIZE, 0.35 * m);
    for (let i = 1; i < across; i++) {
      const x = m + i * zw;
      ticks.push(line([x, reach], [x, m]), line([x, height - m], [x, height - reach]));
    }
    for (let j = 1; j < down; j++) {
      const y = m + j * zh;
      ticks.push(line([reach, y], [m, y]), line([width - m, y], [width - reach, y]));
    }
    for (let i = 0; i < across; i++) {
      const x = m + (i + 0.5) * zw;
      const label = String(i + 1);
      out.push(centred(label, [x, (m + size) / 2], size, { key }));
      out.push(centred(label, [x, height - (m - size) / 2], size, { key }));
    }
    for (let j = 0; j < down; j++) {
      const y = m + (j + 0.5) * zh + size / 2;
      const label = zoneLetter(j);
      out.push(centred(label, [m / 2, y], size, { key }));
      out.push(centred(label, [width - m / 2, y], size, { key }));
    }
  }
  out.splice(1, 0, { type: 'path', contours: ticks, stroke: { width: SHEET_LINE.hidden }, key });
  return out;
}

// Title block -------------------------------------------------------------------

function titleBlock(sheet: Sheet, context: SheetContext, width: number, height: number) {
  const block = sheet.titleBlock;
  if (!block) return [];
  const template = SHEET_TITLE_BLOCKS[block.template];
  const m = sheetMargin(sheet);
  const x0 = width - m - template.width;
  const y0 = height - m - template.height;
  const out: DisplayItem[] = [
    {
      type: 'path',
      contours: template.cells.map((c) =>
        rect(x0 + c.x, y0 + c.y, x0 + c.x + c.width, y0 + c.y + c.height),
      ),
      stroke: { width: SHEET_LINE.hidden, join: 'miter' },
      key: 'title-block',
    },
    {
      type: 'path',
      contours: [rect(x0, y0, x0 + template.width, y0 + template.height)],
      stroke: { width: SHEET_LINE.visible, join: 'miter' },
      key: 'title-block',
    },
  ];
  for (const cell of template.cells) {
    const key = `title-block:${cell.field}`;
    const left = x0 + cell.x + CELL_PAD;
    const top = y0 + cell.y;
    out.push(
      textRun(cell.label.toUpperCase(), [left, top + CELL_PAD + LABEL_SIZE], LABEL_SIZE, {
        color: SHEET_MUTED,
        key,
      }),
    );
    const value = cell.derived ? derived(cell, sheet, context) : (block.fields[cell.field] ?? '');
    if (value.trim() === '') continue;
    const font: SheetFont = cell.bold ? 'bold' : 'regular';
    const fitted = fitLine(value.trim(), cell.size, cell.width - 2 * CELL_PAD, VALUE_MIN, font);
    // The value sits in the middle of what the label leaves, its capitals centred.
    const below = top + CELL_PAD + LABEL_SIZE + 0.5;
    const middle = (below + top + cell.height - 1) / 2;
    out.push(
      textRun(fitted.text, [left, middle + fitted.height / 2], fitted.height, { font, key }),
    );
  }
  return out;
}

function derived(cell: SheetTitleCell, sheet: Sheet, context: SheetContext): string {
  switch (cell.derived) {
    case 'scale':
      return formatSheetScale(sheet.scale);
    case 'sheet': {
      const all = context.sheets ?? [sheet];
      const n = all.findIndex((s) => s.id === sheet.id);
      return n < 0 ? '1 / 1' : `${n + 1} / ${all.length}`;
    }
    case 'projection':
      return sheet.projection === 'first' ? 'First angle' : 'Third angle';
    default:
      return '';
  }
}

// Views -------------------------------------------------------------------------

/** The frame a view without lines is drawn as, mm, centred on its origin. */
export const VIEW_PLACEHOLDER = { width: 60, height: 40 } as const;

/**
 * A view's items for the lines object they were made from, by what else they
 * depend on: a sheet laid out again with the view unchanged (a text dragged, a
 * field typed) gives back the same items, so nothing is transformed again and
 * the screen's per-item caches hold.
 */
const viewCache = new WeakMap<SheetViewLines, { key: string; items: DisplayItem[] }>();

function viewItems(
  sheet: Sheet,
  view: SheetView,
  lines: SheetViewLines | undefined,
): DisplayItem[] {
  const key = `view:${view.id}`;
  const [x, y] = view.at;
  const scale = sheetViewScale(sheet, view);
  const k = scale[0] / scale[1];
  if (!lines || lines.curves.length === 0) {
    const size = SHEET_TEXT_SIZE;
    const b = lines?.bounds;
    // The frame the view keeps while it is empty, else a placeholder centred on its origin.
    const [x0, y0, x1, y1] = b
      ? [x + k * b.min[0], y - k * b.max[1], x + k * b.max[0], y - k * b.min[1]]
      : [
          x - VIEW_PLACEHOLDER.width / 2,
          y - VIEW_PLACEHOLDER.height / 2,
          x + VIEW_PLACEHOLDER.width / 2,
          y + VIEW_PLACEHOLDER.height / 2,
        ];
    return [
      {
        type: 'path',
        contours: [rect(x0, y0, x1, y1)],
        stroke: { width: SHEET_LINE.thin, color: SHEET_MUTED, join: 'miter' },
        key,
      },
      centred(view.name, [(x0 + x1) / 2, (y0 + y1) / 2 + size / 2], size, {
        color: SHEET_MUTED,
        key,
      }),
    ];
  }
  const base = baseOf(sheet, view);
  const style = base?.style ?? 'hidden';
  const own = formatSheetScale(scale);
  const label = view.label
    ? own === formatSheetScale(sheet.scale)
      ? view.name
      : `${view.name} (${own})`
    : '';
  const cacheKey = [x, y, k, style, view.tangentEdges, view.centreLines, label].join('|');
  const cached = viewCache.get(lines);
  if (cached?.key === cacheKey) return cached.items;
  // From the view's frame (y up, model size) to the sheet's (y down, at scale).
  const m: Matrix = [k, 0, 0, -k, x, y];
  const skip = new Set<SheetLineKind>();
  if (style !== 'hidden') skip.add('hidden');
  if (view.tangentEdges === false) skip.add('tangent');
  if (view.centreLines === false) skip.add('centre');
  const state = lines.state ? { state: lines.state } : {};
  const out: DisplayItem[] = [];
  let bottom = lines.bounds ? y - k * lines.bounds.min[1] : y;
  for (const kind of SHEET_LINE_KINDS) {
    if (skip.has(kind)) continue;
    const contours = lines.curves
      .filter((c) => c.kind === kind)
      .flatMap((c) => c.contours.map((contour) => transformContour(m, contour)));
    if (contours.length === 0) continue;
    if (!lines.bounds) {
      for (const c of contours)
        for (const p of flattenContour(c, 0.05)) bottom = Math.max(bottom, p[1]);
    }
    out.push({ type: 'path', contours, stroke: STROKE[kind], key, ...state });
  }
  if (label) {
    // Under the middle of the lines (their bounds), else under the view's origin.
    const middle = lines.bounds ? x + (k * (lines.bounds.min[0] + lines.bounds.max[0])) / 2 : x;
    out.push({
      ...centred(label, [middle, bottom + 4 + SHEET_TEXT_SIZE], SHEET_TEXT_SIZE, { key }),
      ...state,
    });
  }
  viewCache.set(lines, { key: cacheKey, items: out });
  return out;
}

// Items -------------------------------------------------------------------------

function sheetItem(sheet: Sheet, item: SheetItem, context: SheetContext): DisplayItem[] {
  switch (item.kind) {
    case 'dimension':
      return layoutSheetDimension(sheet, item, context.anchors, {
        ...(context.units && { units: context.units }),
      });
    case 'leader':
      return layoutSheetLeader(sheet, item, context.anchors);
    case 'centreMark':
    case 'centreLine':
      return layoutSheetCentre(sheet, item, context.anchors);
    case 'sticky':
      return layoutSheetSticky(item, { output: context.output ?? 'screen' });
    case 'text': {
      const size = item.size ?? SHEET_TEXT_SIZE;
      const key = `item:${item.id}`;
      const [x, y] = item.at;
      const out: DisplayItem[] = [];
      wrapText(item.text, size, item.width).forEach((text, i) => {
        if (text.trim() === '') return;
        out.push(textRun(text, [x, y + size + i * size * LINE_SPACING], size, { key }));
      });
      return out;
    }
  }
}

// Shapes ------------------------------------------------------------------------

function rect(x0: number, y0: number, x1: number, y1: number): Contour {
  return {
    start: [x0, y0],
    segments: [
      { type: 'line', to: [x1, y0] },
      { type: 'line', to: [x1, y1] },
      { type: 'line', to: [x0, y1] },
      { type: 'line', to: [x0, y0] },
    ],
    closed: true,
  };
}

function line(a: Point, b: Point): Contour {
  return { start: a, segments: [{ type: 'line', to: b }], closed: false };
}

/** A run centred on `at` along its baseline. */
function centred(
  text: string,
  at: Point,
  size: number,
  options: { color?: string; key?: string; font?: SheetFont },
) {
  const w = textWidth(text, size, options.font);
  return textRun(text, [at[0] - w / 2, at[1]], size, options);
}
