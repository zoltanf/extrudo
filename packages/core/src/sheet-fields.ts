/**
 * Text fields in braces on a sheet (P6-24 S5, ADR-0143's S5 amendment; plan
 * §5.3): `{name}` (the design), `{sheet}` and `{sheets}` (this sheet's
 * number and how many there are), `{scale}` (the sheet's), `{date}`,
 * `{version}` (the newest saved version) and `{= expr}` (a parameter
 * expression, written with its unit). They are filled each time a sheet is
 * drawn and never stored filled in. A field with no value, an unknown one
 * and an expression that doesn't evaluate are left as typed.
 *
 * `mapSheetFieldTexts` is the one place that says which texts take fields:
 * text items, leader notes, table cells and the title block's typed fields.
 * Layout fills them through it, and `rewriteReferences` renames a
 * parameter in their `{= …}` through it.
 */
import { mentions, renameReferences } from './expr/parameters';
import type { Sheet, SheetItem } from './sheet-schema';

/** The fields a sheet text may hold besides `{= expr}`. */
export const SHEET_FIELDS = ['name', 'sheet', 'sheets', 'scale', 'date', 'version'] as const;
export type SheetFieldName = (typeof SHEET_FIELDS)[number];

/** `{= expr}` (the `=` may follow spaces) or `{name}`; no braces inside. */
const FIELD = /\{(\s*=)([^{}]*)\}|\{([a-z]+)\}/g;

/** What a text's fields become; a field without a value is left as typed. */
export type SheetFieldValues = Partial<Record<SheetFieldName, string>> & {
  /** A `{= expr}`'s text, `undefined` when it has none (the expression doesn't evaluate). */
  expression?: (expression: string) => string | undefined;
};

/** `text` with its fields filled from `values`. */
export function fillSheetFields(text: string, values: SheetFieldValues): string {
  return text.replace(FIELD, (whole, eq: string | undefined, expr: string, name: string) => {
    if (eq !== undefined) {
      const source = expr.trim();
      return (source ? values.expression?.(source) : undefined) ?? whole;
    }
    if (!(SHEET_FIELDS as readonly string[]).includes(name)) return whole;
    return values[name as SheetFieldName] ?? whole;
  });
}

/** The expressions of `text`'s `{= …}` fields, trimmed, in order. */
export function sheetFieldExpressions(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(FIELD)) {
    if (match[1] !== undefined && (match[2] ?? '').trim()) out.push((match[2] ?? '').trim());
  }
  return out;
}

/** `text` with every `{= …}` that refers to parameter `from` referring to `to`; the rest untouched. */
export function renameSheetFieldReferences(text: string, from: string, to: string): string {
  return text.replace(FIELD, (whole, eq: string | undefined, expr: string) =>
    eq !== undefined && mentions(expr, from) ? `{${eq}${renameReferences(expr, from, to)}}` : whole,
  );
}

/**
 * `sheet` with each text that takes fields mapped through `f`: text items',
 * leader notes' texts, table cells and the title block's typed fields. An
 * item or block whose texts `f` leaves alone is the same object.
 */
export function mapSheetFieldTexts(sheet: Sheet, f: (text: string) => string): Sheet {
  let changed = false;
  const items = sheet.items.map((item): SheetItem => {
    const next = mapItemTexts(item, f);
    if (next !== item) changed = true;
    return next;
  });
  let titleBlock = sheet.titleBlock;
  if (titleBlock) {
    const entries = Object.entries(titleBlock.fields);
    const mapped = entries.map(([k, v]) => [k, f(v)] as const);
    if (mapped.some(([, v], i) => v !== entries[i]?.[1])) {
      titleBlock = { ...titleBlock, fields: Object.fromEntries(mapped) };
      changed = true;
    }
  }
  if (!changed) return sheet;
  return { ...sheet, items, ...(titleBlock && { titleBlock }) };
}

function mapItemTexts(item: SheetItem, f: (text: string) => string): SheetItem {
  switch (item.kind) {
    case 'text':
    case 'leader': {
      const text = f(item.text);
      return text === item.text ? item : { ...item, text };
    }
    case 'table': {
      const rows = item.rows.map((row) => {
        const next = row.map(f);
        return next.some((cell, i) => cell !== row[i]) ? next : row;
      });
      return rows.some((row, i) => row !== item.rows[i]) ? { ...item, rows } : item;
    }
    default:
      return item;
  }
}
