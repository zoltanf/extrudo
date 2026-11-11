/**
 * Drawing sheets in the document (P6-24, ADR-0143; plan §5): `doc.sheets`, in
 * page order. A sheet holds views of the model and items (a text; dimensions,
 * notes and lists come in later slices). Nothing derived is stored: a view
 * says what to draw (direction, scale, style, bodies), never the lines, and
 * every layout number is stored as a number (mm on the sheet, from its
 * top-left corner, Y down).
 *
 * The rules the shapes can't say are in `sheetProblems`, which both the
 * document's schema and the commands (`sheets.ts`) apply, so a command can
 * never make a design the loader refuses.
 */
import {
  BodyIdSchema,
  SheetIdSchema,
  type SheetItemId,
  SheetItemIdSchema,
  type SheetViewId,
  SheetViewIdSchema,
} from './ids';
import { Vec3Schema } from './refs';
import { z } from './zod';

/** A point on a sheet, mm from its top-left corner, Y down. */
const SheetPointSchema = z.tuple([z.number(), z.number()]);

/** The named paper sizes (ISO 216 and the North American ones). */
export const SHEET_PAPER_SIZES = [
  'A4',
  'A3',
  'A2',
  'A1',
  'A0',
  'letter',
  'legal',
  'tabloid',
] as const;
export type SheetPaper = (typeof SHEET_PAPER_SIZES)[number];

/** Each named paper's short and long side, mm. */
export const SHEET_PAPER_MM: Readonly<Record<SheetPaper, readonly [number, number]>> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  A0: [841, 1189],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  tabloid: [279.4, 431.8],
};

/** The shortest and longest side a custom sheet may have, mm. */
export const SHEET_SIDE_MIN = 10;
export const SHEET_SIDE_MAX = 10000;

const side = z.number().min(SHEET_SIDE_MIN).max(SHEET_SIDE_MAX);

/** A named paper, or a custom one's two sides in mm (the orientation decides which is wide). */
export const SheetSizeSchema = z
  .union([z.enum(SHEET_PAPER_SIZES), z.tuple([side, side])])
  .describe('A named paper, or two sides in mm; the orientation decides which side is wide.');
export type SheetSize = z.infer<typeof SheetSizeSchema>;

/** A scale as two positive numbers: `[1, 2]` is 1:2 (half size), `[2, 1]` is 2:1. */
export const SheetScaleSchema = z
  .tuple([z.number().positive(), z.number().positive()])
  .describe('Sheet length to model length: [1, 2] is 1:2.');
export type SheetScale = z.infer<typeof SheetScaleSchema>;

/** The most decimals a sheet's dimensions show. */
export const SHEET_DECIMALS_MAX = 4;

/** A title block template's field names: a letter, then letters and digits (`title`, `drawnBy`). */
export const SHEET_FIELD_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

/** The longest text a title-block field or a text item holds. */
export const SHEET_TEXT_MAX = 2000;

export const SheetTitleBlockSchema = z.strictObject({
  template: z.enum(['simple', 'full']).describe('Which title block is drawn.'),
  fields: z
    .record(z.string().regex(SHEET_FIELD_NAME), z.string().max(SHEET_TEXT_MAX))
    .describe('What was typed into each field, by field name; a field not here is empty.'),
});
export type SheetTitleBlock = z.infer<typeof SheetTitleBlockSchema>;

export const SheetBorderSchema = z.strictObject({
  zones: z
    .literal(true)
    .optional()
    .describe('Zone letters and numbers along the border (only as true).'),
});
export type SheetBorder = z.infer<typeof SheetBorderSchema>;

/**
 * A base view: looks along `direction` with `up` pointing up the sheet, both
 * world vectors (not unit length, not parallel).
 */
export const SheetBaseFromSchema = z.strictObject({
  kind: z.literal('base').describe('A direction chosen freely.'),
  direction: Vec3Schema.describe('The direction the view looks along, world.'),
  up: Vec3Schema.describe('The world direction that points up the sheet.'),
});

/** Where a projected view sits from its parent; the four diagonal ones are isometric. */
export const SHEET_VIEW_SIDES = [
  'left',
  'right',
  'above',
  'below',
  'iso-above-left',
  'iso-above-right',
  'iso-below-left',
  'iso-below-right',
] as const;
export type SheetViewSide = (typeof SHEET_VIEW_SIDES)[number];

/**
 * A projected view: made from `parent` (a view of the same sheet), stays
 * aligned with it and takes its scale and style; the sheet's projection
 * angle turns `side` into a direction.
 */
export const SheetProjectedFromSchema = z.strictObject({
  kind: z.literal('projected').describe('Projected from another view of the sheet.'),
  parent: SheetViewIdSchema.describe('The view it is projected from, on the same sheet.'),
  side: z.enum(SHEET_VIEW_SIDES).describe('Where it sits from its parent.'),
});

export const SheetViewFromSchema = z.discriminatedUnion('kind', [
  SheetBaseFromSchema,
  SheetProjectedFromSchema,
]);
export type SheetViewFrom = z.infer<typeof SheetViewFromSchema>;

/** How a view's lines are drawn; absent is `hidden`. */
export const SHEET_VIEW_STYLES = ['visible', 'hidden', 'shaded', 'shaded-edges'] as const;
export type SheetViewStyle = (typeof SHEET_VIEW_STYLES)[number];

/** A picture of bodies on a sheet (ADR-0143): a base view or one projected from another. */
export const SheetViewSchema = z.strictObject({
  id: SheetViewIdSchema.describe('A UUID, for life; unique in the design.'),
  name: z
    .string()
    .min(1)
    .max(100)
    .describe('"Front"; unique in its sheet, compared case-insensitively.'),
  at: SheetPointSchema.describe(
    "The view's origin on the sheet, mm from the top-left corner, Y down.",
  ),
  from: SheetViewFromSchema,
  scale: SheetScaleSchema.optional().describe("Absent: the sheet's. Never on a projected view."),
  style: z
    .enum(SHEET_VIEW_STYLES)
    .optional()
    .describe(
      'visible: visible edges only; hidden: and hidden edges dashed (the default). Never on a projected view.',
    ),
  bodies: z
    .array(BodyIdSchema)
    .min(1)
    .optional()
    .describe(
      'The bodies drawn; absent: every shown body. One the design no longer has is skipped.',
    ),
  tangentEdges: z.literal(false).optional().describe('Tangent edges left out (only as false).'),
  centreLines: z.literal(false).optional().describe('Centre lines left out (only as false).'),
  label: z
    .literal(true)
    .optional()
    .describe("The view's name and scale drawn under it (only as true)."),
});
export type SheetView = z.infer<typeof SheetViewSchema>;

/** A text on the sheet, not tied to a view. */
export const SheetTextItemSchema = z.strictObject({
  kind: z.literal('text').describe('A text.'),
  id: SheetItemIdSchema.describe('A UUID, for life; unique in the design.'),
  at: SheetPointSchema.describe(
    "The text's top-left corner, mm from the sheet's top-left, Y down.",
  ),
  text: z
    .string()
    .max(SHEET_TEXT_MAX)
    .regex(/\S/, 'is blank')
    .describe('Plain text, up to 2000 characters; may contain newlines.'),
  size: z.number().positive().max(1000).optional().describe('The letter height, mm; absent: 3.5.'),
  width: z.number().positive().optional().describe('Wraps at this width, mm; absent: no wrapping.'),
});
export type SheetTextItem = z.infer<typeof SheetTextItemSchema>;

/**
 * Every item kind this version knows. A later slice adds a kind by adding its
 * schema here; a file with a kind this version doesn't know loses that item
 * on load and says so (`parseLeniently`), never failing the design.
 */
export const SheetItemSchema = z.discriminatedUnion('kind', [SheetTextItemSchema]);
export type SheetItem = z.infer<typeof SheetItemSchema>;
export type SheetItemKind = SheetItem['kind'];

/** One drawing sheet (P6-24, ADR-0143): a size, an orientation, a border, a title block, views and items. */
export const SheetSchema = z.strictObject({
  id: SheetIdSchema.describe('A UUID, for life.'),
  name: z
    .string()
    .min(1)
    .max(100)
    .describe('Unique among the sheets, compared case-insensitively.'),
  size: SheetSizeSchema,
  orientation: z
    .enum(['landscape', 'portrait'])
    .describe('Landscape: the long side is horizontal.'),
  scale: SheetScaleSchema.describe("The views' scale unless a view has its own."),
  projection: z.enum(['first', 'third']).describe('The projection angle projected views follow.'),
  decimals: z.int().min(0).max(SHEET_DECIMALS_MAX).describe('Decimals dimensions show, 0 to 4.'),
  border: SheetBorderSchema.optional().describe('Absent: no border.'),
  titleBlock: SheetTitleBlockSchema.optional().describe('Absent: no title block.'),
  views: z.array(SheetViewSchema).describe('The views, drawn in order.'),
  items: z
    .array(SheetItemSchema)
    .describe('Texts and later dimensions and notes, drawn in order after the views.'),
});
export type Sheet = z.infer<typeof SheetSchema>;

/** A sheet's paper, mm: `width` across, `height` down. */
export function sheetPaperSize(sheet: Pick<Sheet, 'size' | 'orientation'>): {
  width: number;
  height: number;
} {
  const [a, b] = typeof sheet.size === 'string' ? SHEET_PAPER_MM[sheet.size] : sheet.size;
  const short = Math.min(a, b);
  const long = Math.max(a, b);
  return sheet.orientation === 'landscape'
    ? { width: long, height: short }
    : { width: short, height: long };
}

/**
 * The view an item belongs to, or `undefined` for one placed on the sheet
 * itself (a text). Removing a view removes the items that belong to it.
 */
export function sheetItemView(item: SheetItem): SheetViewId | undefined {
  return 'view' in item ? (item.view as SheetViewId) : undefined;
}

/** The views projected from `id`, directly or through other projected views, on `sheet`. */
export function projectedFrom(sheet: Pick<Sheet, 'views'>, id: SheetViewId): SheetViewId[] {
  const found = new Set<SheetViewId>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const view of sheet.views) {
      if (view.from.kind !== 'projected' || found.has(view.id)) continue;
      if (!found.has(view.from.parent)) continue;
      found.add(view.id);
      grew = true;
    }
  }
  found.delete(id);
  return [...found];
}

/** A rule a valid `sheets` list breaks: the path inside the list and what is wrong. */
export interface SheetProblem {
  path: (string | number)[];
  message: string;
}

const fold = (name: string) => name.toLowerCase();

/**
 * What the sheets' shapes can't say (ADR-0143): sheet, view and item IDs
 * unique in the design; sheet names unique among the sheets and view names in
 * their sheet (case-insensitively); a projected view's parent a view of the
 * same sheet, not itself, with no cycle; scale and style only on a base view;
 * a base view's two directions not zero and not parallel; a body named once
 * per view. A body a view names that the design doesn't have is not a problem
 * (it is skipped when the view is drawn), so deleting a body never touches a
 * sheet.
 */
export function sheetProblems(sheets: readonly Sheet[]): SheetProblem[] {
  const problems: SheetProblem[] = [];
  const once = (seen: Set<string>, key: string, path: SheetProblem['path'], message: string) => {
    if (seen.has(key)) problems.push({ path, message });
    seen.add(key);
  };
  const sheetIds = new Set<string>();
  const sheetNames = new Set<string>();
  const viewIds = new Set<string>();
  const itemIds = new Set<string>();
  sheets.forEach((sheet, s) => {
    once(sheetIds, sheet.id, [s, 'id'], `is ${sheet.id}, which another sheet has`);
    once(sheetNames, fold(sheet.name), [s, 'name'], `is "${sheet.name}", which another sheet has`);
    const views = new Map(sheet.views.map((v) => [v.id as string, v]));
    const viewNames = new Set<string>();
    sheet.views.forEach((view, v) => {
      const at = [s, 'views', v];
      once(viewIds, view.id, [...at, 'id'], `is ${view.id}, which another view has`);
      once(
        viewNames,
        fold(view.name),
        [...at, 'name'],
        `is "${view.name}", which another view of this sheet has`,
      );
      const seenBodies = new Set<string>();
      for (const [b, body] of (view.bodies ?? []).entries()) {
        once(seenBodies, body, [...at, 'bodies', b], `names body ${body} twice`);
      }
      const { from } = view;
      if (from.kind === 'base') {
        const [d, u] = [from.direction, from.up];
        const cross = [
          d[1] * u[2] - d[2] * u[1],
          d[2] * u[0] - d[0] * u[2],
          d[0] * u[1] - d[1] * u[0],
        ];
        const length = (w: readonly number[]) => Math.hypot(...w);
        if (length(d) === 0)
          problems.push({ path: [...at, 'from', 'direction'], message: 'is zero' });
        else if (length(u) === 0)
          problems.push({ path: [...at, 'from', 'up'], message: 'is zero' });
        else if (length(cross) <= 1e-9 * length(d) * length(u)) {
          problems.push({ path: [...at, 'from', 'up'], message: 'is parallel to the direction' });
        }
        return;
      }
      for (const key of ['scale', 'style'] as const) {
        if (view[key] === undefined) continue;
        problems.push({
          path: [...at, key],
          message: `is set on a projected view, which takes its parent's ${key}`,
        });
      }
      if (from.parent === view.id) {
        problems.push({ path: [...at, 'from', 'parent'], message: 'is the view itself' });
        return;
      }
      if (!views.has(from.parent)) {
        problems.push({
          path: [...at, 'from', 'parent'],
          message: `is ${from.parent}, which is not a view of this sheet`,
        });
        return;
      }
      // Walk up the parents: a cycle comes back to this view.
      const visited = new Set<string>([view.id]);
      for (let next = views.get(from.parent); next?.from.kind === 'projected'; ) {
        if (visited.has(next.id)) break;
        visited.add(next.id);
        if (next.from.parent === view.id) {
          problems.push({
            path: [...at, 'from', 'parent'],
            message: `makes a cycle: "${view.name}" is projected from itself through "${next.name}"`,
          });
          break;
        }
        next = views.get(next.from.parent);
      }
    });
    sheet.items.forEach((item, i) => {
      once(itemIds, item.id, [s, 'items', i, 'id'], `is ${item.id}, which another item has`);
    });
  });
  return problems;
}

/**
 * Whether a parse issue is a sheet item of a kind this version doesn't know
 * (`sheets.<n>.items.<m>.kind`, no matching discriminator). Such an item is
 * left out on load, like an unknown key, so a design from a newer Extrudo
 * with a new kind of item still opens (ADR-0143, S1 amendment).
 */
export function isUnknownSheetItem(
  issue: { code: string; path: readonly PropertyKey[] },
  doc: unknown,
): boolean {
  const { code, path } = issue;
  if (code !== 'invalid_union' || path.length !== 5) return false;
  const [list, s, items, i, key] = path;
  if (list !== 'sheets' || items !== 'items' || key !== 'kind') return false;
  if (typeof s !== 'number' || typeof i !== 'number') return false;
  const sheets = (doc as { sheets?: unknown }).sheets;
  const item = Array.isArray(sheets)
    ? (sheets[s] as { items?: unknown } | undefined)?.items
    : undefined;
  const kind = Array.isArray(item) ? (item[i] as { kind?: unknown } | undefined)?.kind : undefined;
  // A missing or non-string kind is damage, not a newer kind.
  return typeof kind === 'string' && kind.length > 0;
}

/** Where an item with this ID is: its sheet's and its own index. */
export function findSheetItem(
  sheets: readonly Sheet[],
  id: SheetItemId,
): { sheet: number; item: number } | undefined {
  for (const [s, sheet] of sheets.entries()) {
    const item = sheet.items.findIndex((it) => it.id === id);
    if (item >= 0) return { sheet: s, item };
  }
  return undefined;
}

/** Where a view with this ID is: its sheet's and its own index. */
export function findSheetView(
  sheets: readonly Sheet[],
  id: SheetViewId,
): { sheet: number; view: number } | undefined {
  for (const [s, sheet] of sheets.entries()) {
    const view = sheet.views.findIndex((v) => v.id === id);
    if (view >= 0) return { sheet: s, view };
  }
  return undefined;
}
