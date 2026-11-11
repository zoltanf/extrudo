/**
 * The title block templates (ADR-0143 §8, plan decision 8): "simple" (title,
 * drawn by, date, scale, sheet, units, version) and the fuller "full". Each
 * is a grid of cells in mm from the block's top-left corner; a cell shows its
 * label at the top and its value below. A value is what was typed into the
 * sheet's `titleBlock.fields` under the cell's field name, except for the
 * derived cells (scale, sheet, projection), which come from the sheets and
 * never from a stored field.
 */

export type SheetTitleTemplate = 'simple' | 'full';

/** What a cell shows without being typed into. */
export type SheetTitleDerived = 'scale' | 'sheet' | 'projection';

export interface SheetTitleCell {
  /** The field name in `titleBlock.fields`, or the derived value's name. */
  field: string;
  /** The cell's label as the interface writes it ("Drawn by"); the sheet draws it in capitals. */
  label: string;
  /** Set when the value comes from the sheets, not from `fields`. */
  derived?: SheetTitleDerived;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The value's letter height, mm (it shrinks to fit, down to `VALUE_MIN`). */
  size: number;
  bold?: true;
}

export interface SheetTitleBlockTemplate {
  width: number;
  height: number;
  cells: readonly SheetTitleCell[];
}

const cell = (
  field: string,
  label: string,
  [x, y, width, height]: [number, number, number, number],
  size: number,
  extra: Partial<Pick<SheetTitleCell, 'derived' | 'bold'>> = {},
): SheetTitleCell => ({ field, label, x, y, width, height, size, ...extra });

/** Both templates. The block sits in the sheet's lower right corner, against the border. */
export const SHEET_TITLE_BLOCKS: Readonly<Record<SheetTitleTemplate, SheetTitleBlockTemplate>> = {
  simple: {
    width: 160,
    height: 32,
    cells: [
      cell('title', 'Title', [0, 0, 90, 16], 5, { bold: true }),
      cell('scale', 'Scale', [90, 0, 35, 16], 3.5, { derived: 'scale', bold: true }),
      cell('sheet', 'Sheet', [125, 0, 35, 16], 3.5, { derived: 'sheet', bold: true }),
      cell('drawnBy', 'Drawn by', [0, 16, 45, 16], 2.5),
      cell('date', 'Date', [45, 16, 45, 16], 2.5),
      cell('units', 'Units', [90, 16, 35, 16], 2.5),
      cell('version', 'Version', [125, 16, 35, 16], 2.5),
    ],
  },
  full: {
    width: 180,
    height: 40,
    cells: [
      cell('drawnBy', 'Drawn by', [0, 0, 55, 10], 2.5),
      cell('checkedBy', 'Checked by', [0, 10, 55, 10], 2.5),
      cell('approvedBy', 'Approved by', [0, 20, 55, 10], 2.5),
      cell('date', 'Date', [0, 30, 55, 10], 2.5),
      cell('company', 'Company', [55, 0, 80, 10], 2.5),
      cell('title', 'Title', [55, 10, 80, 20], 5, { bold: true }),
      cell('material', 'Material', [55, 30, 80, 10], 2.5),
      cell('partNumber', 'Part number', [135, 0, 45, 10], 2.5, { bold: true }),
      cell('scale', 'Scale', [135, 10, 22.5, 10], 2.5, { derived: 'scale', bold: true }),
      cell('sheet', 'Sheet', [157.5, 10, 22.5, 10], 2.5, { derived: 'sheet', bold: true }),
      cell('units', 'Units', [135, 20, 22.5, 10], 2.5),
      cell('version', 'Version', [157.5, 20, 22.5, 10], 2.5),
      cell('projection', 'Projection', [135, 30, 45, 10], 2.5, { derived: 'projection' }),
    ],
  },
};

/** The fields a template lets a person type, in its reading order: what Sheet Setup lists. */
export function sheetTitleFields(template: SheetTitleTemplate): { field: string; label: string }[] {
  return SHEET_TITLE_BLOCKS[template].cells
    .filter((c) => !c.derived)
    .map(({ field, label }) => ({ field, label }));
}

/** Label letter height, mm, and its distance from the cell's top and left. */
export const LABEL_SIZE = 1.6;
export const CELL_PAD = 1.5;
/** The smallest a value shrinks to before it is cut, mm. */
export const VALUE_MIN = 1.8;
