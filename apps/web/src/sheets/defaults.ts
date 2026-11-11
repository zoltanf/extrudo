/**
 * What a new sheet starts as (P6-24, ADR-0143's S1 mode amendment): the mode's defaults,
 * since core sets none. Pure: the caller passes the IDs and today's date, so the recipe is
 * deterministic and the tests need no clock.
 *
 * Defaults (plan §12): A3 landscape, 1:1, first angle, one decimal, the simple title block,
 * a border without zones (decision 8: the zone border is off by default). The title block starts with the design's name, today's date and the
 * design's units; "Drawn by" stays empty until typed (the author's name is never written
 * by itself).
 */
import {
  type ExtrudoDocument,
  SHEET_PAPER_MM,
  SHEET_PAPER_SIZES,
  type Sheet,
  type SheetId,
  type SheetItem,
  type SheetItemId,
  type SheetPaper,
  type SheetView,
  type SheetViewId,
} from '@extrudo/core';

/** The title blocks a sheet may have, `none` for no title block (`Sheet.titleBlock` absent). */
export type SheetTitleChoice = 'simple' | 'full' | 'none';

export interface NewSheetOptions {
  size?: Sheet['size'];
  orientation?: Sheet['orientation'];
  projection?: Sheet['projection'];
  titleBlock?: SheetTitleChoice;
}

export const SHEET_DEFAULTS = {
  size: 'A3',
  orientation: 'landscape',
  scale: [1, 1],
  projection: 'first',
  decimals: 1,
  titleBlock: 'simple',
} as const satisfies Required<NewSheetOptions> & Pick<Sheet, 'scale' | 'decimals'>;

/** The paper names as a person reads them: "A3", "Letter". */
export const PAPER_LABELS: Readonly<Record<SheetPaper, string>> = {
  A4: 'A4',
  A3: 'A3',
  A2: 'A2',
  A1: 'A1',
  A0: 'A0',
  letter: 'Letter',
  legal: 'Legal',
  tabloid: 'Tabloid',
};

/** The paper sizes in menu order, with their sides: "A3 · 420 × 297 mm". */
export const PAPER_CHOICES = SHEET_PAPER_SIZES.map((paper) => {
  const [short, long] = SHEET_PAPER_MM[paper];
  return { value: paper, label: `${PAPER_LABELS[paper]} · ${mm(long)} × ${mm(short)} mm` };
});

function mm(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** A sheet's size as a short name: "A3", or "150 × 100 mm" for a custom one. */
export function sizeLabel(size: Sheet['size']): string {
  return typeof size === 'string' ? PAPER_LABELS[size] : `${mm(size[0])} × ${mm(size[1])} mm`;
}

/** `YYYY-MM-DD` in the person's own time zone: the date a title block shows. */
export function isoDate(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** The first of "Sheet 1", "Sheet 2", … no sheet is named (names compare without case). */
export function nextSheetName(sheets: readonly Pick<Sheet, 'name'>[], base = 'Sheet'): string {
  const taken = new Set(sheets.map((s) => s.name.trim().toLowerCase()));
  for (let n = sheets.length + 1; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** A name for a copy of `name`: "Front copy", then "Front copy 2", … */
export function copyName(sheets: readonly Pick<Sheet, 'name'>[], name: string): string {
  const taken = new Set(sheets.map((s) => s.name.trim().toLowerCase()));
  const base = `${name} copy`.slice(0, 100);
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const next = `${base.slice(0, 95)} ${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}

/**
 * Why `name` can't name sheet `id` among `sheets`, in the words of UI spec §8, or
 * `undefined` when it can.
 */
export function sheetNameProblem(
  sheets: readonly Pick<Sheet, 'id' | 'name'>[],
  id: SheetId | undefined,
  name: string,
): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'A sheet needs a name.';
  if (trimmed.length > 100) return 'A sheet name can be at most 100 characters.';
  const clash = sheets.find(
    (s) => s.id !== id && s.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  return clash ? `There is a sheet named "${clash.name}" already: pick another name.` : undefined;
}

/** A new, empty sheet with the mode's defaults and the design's name, today and units. */
export function newSheet(
  doc: Pick<ExtrudoDocument, 'name' | 'settings' | 'sheets'>,
  id: SheetId,
  today: Date,
  options: NewSheetOptions = {},
): Sheet {
  const titleBlock = options.titleBlock ?? SHEET_DEFAULTS.titleBlock;
  return {
    id,
    name: nextSheetName(doc.sheets ?? []),
    size: options.size ?? SHEET_DEFAULTS.size,
    orientation: options.orientation ?? SHEET_DEFAULTS.orientation,
    scale: [...SHEET_DEFAULTS.scale],
    projection: options.projection ?? SHEET_DEFAULTS.projection,
    decimals: SHEET_DEFAULTS.decimals,
    border: {},
    ...(titleBlock !== 'none' && {
      titleBlock: {
        template: titleBlock,
        fields: {
          title: doc.name.slice(0, 2000),
          date: isoDate(today),
          units: doc.settings.units,
        },
      },
    }),
    views: [],
    items: [],
  };
}

/** New IDs for a copied sheet: the caller makes them (`newId`), so the copy is deterministic. */
export interface SheetCopyIds {
  sheet: SheetId;
  view(old: SheetViewId): SheetViewId;
  item(old: SheetItemId): SheetItemId;
}

/**
 * A copy of `sheet` under new IDs and `name`: its views, their projected parents and every
 * item's `view` follow the new view IDs.
 */
export function copySheet(sheet: Sheet, name: string, ids: SheetCopyIds): Sheet {
  const views = new Map(sheet.views.map((v) => [v.id, ids.view(v.id)]));
  const copy = structuredClone(sheet);
  return {
    ...copy,
    id: ids.sheet,
    name,
    views: copy.views.map(
      (view): SheetView => ({
        ...view,
        id: views.get(view.id) ?? view.id,
        from:
          view.from.kind === 'projected'
            ? { ...view.from, parent: views.get(view.from.parent) ?? view.from.parent }
            : view.from,
      }),
    ),
    items: copy.items.map((item): SheetItem => {
      const moved = { ...item, id: ids.item(item.id) };
      // An item tied to a view names it in `view` (the digest's rule for item kinds).
      const tied = moved as SheetItem & { view?: SheetViewId };
      if (tied.view !== undefined) tied.view = views.get(tied.view) ?? tied.view;
      return moved;
    }),
  };
}
