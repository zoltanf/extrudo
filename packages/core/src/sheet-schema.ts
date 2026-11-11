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
import { GeomFingerprintSchema, GeomRefSchema, Vec3Schema } from './refs';
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

/** The geometry kinds a sheet anchor may name. */
export const SHEET_ANCHOR_REF_KINDS = ['vertex', 'edge', 'face'] as const;

/**
 * An anchor's reference: a vertex, an edge or a face by its persistent name
 * (ADR-0005), always with its fingerprint, never an `index:` one (those are
 * valid only for the mesh they were picked on), as an annotation's.
 */
export const SheetAnchorRefSchema = GeomRefSchema.extend({
  kind: z.enum(SHEET_ANCHOR_REF_KINDS).describe('What the anchor is on.'),
  fingerprint: GeomFingerprintSchema.describe(
    'What the geometry looked like when it was picked: the fallback when the name is gone.',
  ),
})
  .refine((ref) => !ref.id.startsWith('index:'), {
    message: "is an index reference, which a sheet can't keep: pick the geometry again",
    path: ['id'],
  })
  .describe('The geometry, by its persistent name, with its fingerprint.');

/** Which point of an edge an anchor takes. */
export const SHEET_ANCHOR_POINTS = ['start', 'end', 'middle', 'centre'] as const;
export type SheetAnchorPoint = (typeof SHEET_ANCHOR_POINTS)[number];

/** On a vertex, on an edge (the whole edge, or one of its points), or on a cylinder's face. */
export const SheetRefAnchorSchema = z.strictObject({
  ref: SheetAnchorRefSchema,
  at: z
    .enum(SHEET_ANCHOR_POINTS)
    .optional()
    .describe(
      "An edge's start, end, middle or centre (a circle's); absent: the whole edge, the vertex, the face.",
    ),
});

/**
 * On the outline of a cylinder or a cone as the dimension's view sees it:
 * `1` the outline on the side `axis × direction` points to (the face's axis
 * with its canonical sign, the view's direction), `-1` the other one.
 */
export const SheetSilhouetteAnchorSchema = z.strictObject({
  ref: SheetAnchorRefSchema,
  silhouette: z
    .union([z.literal(1), z.literal(-1)])
    .describe("Which of the face's two outlines in the view: 1 or -1."),
});

/** A point of the view not tied to the model, in the view's own mm (model size, x right, y up). */
export const SheetFreeAnchorSchema = z.strictObject({
  free: SheetPointSchema.describe("The point in the view's own mm: model size, x right, y up."),
});

/** What a dimension measures from (ADR-0143 §4): geometry, an outline, or a free point. */
export const SheetAnchorSchema = z
  .union([SheetRefAnchorSchema, SheetSilhouetteAnchorSchema, SheetFreeAnchorSchema])
  .describe('On a vertex, an edge or a face; on an outline; or a free point of the view.');
export type SheetAnchor = z.infer<typeof SheetAnchorSchema>;
export type SheetRefAnchor = z.infer<typeof SheetRefAnchorSchema>;
export type SheetSilhouetteAnchor = z.infer<typeof SheetSilhouetteAnchorSchema>;
export type SheetFreeAnchor = z.infer<typeof SheetFreeAnchorSchema>;

/** The kinds of dimension. */
export const SHEET_DIMENSION_TYPES = ['linear', 'radius', 'diameter', 'angle'] as const;
export type SheetDimensionType = (typeof SHEET_DIMENSION_TYPES)[number];

/** Which way a linear dimension measures; absent: chosen from where it is placed. */
export const SHEET_DIMENSION_DIRECTIONS = ['horizontal', 'vertical', 'aligned'] as const;
export type SheetDimensionDirection = (typeof SHEET_DIMENSION_DIRECTIONS)[number];

/** The longest text before or after a dimension's value. */
export const SHEET_AFFIX_MAX = 100;

/**
 * A dimension in a view (P6-24 S3, ADR-0143): measured from the model, never
 * driving it, and its value never stored.
 */
export const SheetDimensionItemSchema = z.strictObject({
  kind: z.literal('dimension').describe('A dimension.'),
  id: SheetItemIdSchema.describe('A UUID, for life; unique in the design.'),
  view: SheetViewIdSchema.describe('The view it measures in, on the same sheet.'),
  type: z
    .enum(SHEET_DIMENSION_TYPES)
    .describe('linear: a distance; radius, diameter: a circle; angle: between two lines.'),
  direction: z
    .enum(SHEET_DIMENSION_DIRECTIONS)
    .optional()
    .describe('A linear one: horizontal, vertical or aligned; absent: from where it is placed.'),
  anchors: z
    .array(SheetAnchorSchema)
    .min(1)
    .max(2)
    .describe('What it measures: one or two anchors, as its type takes.'),
  at: SheetPointSchema.describe(
    "Where its text is, in the view's own mm (model size, x right, y up); it follows the anchors when they move.",
  ),
  decimals: z
    .int()
    .min(0)
    .max(SHEET_DECIMALS_MAX)
    .optional()
    .describe("Decimals shown, 0 to 4; absent: the sheet's."),
  before: z
    .string()
    .max(SHEET_AFFIX_MAX)
    .optional()
    .describe('Text before the value (and before R or Ø), up to 100 characters.'),
  after: z
    .string()
    .max(SHEET_AFFIX_MAX)
    .optional()
    .describe('Text after the value, up to 100 characters.'),
  reference: z
    .literal(true)
    .optional()
    .describe('A reference dimension: drawn in brackets (only as true).'),
});
export type SheetDimensionItem = z.infer<typeof SheetDimensionItemSchema>;

/**
 * A note with an arrow to the model (P6-24 S4, ADR-0143's S4 amendment): its
 * text at `at`, a leader line from there to what `anchor` names, ending in
 * an arrowhead on an edge or a point and in a dot on a face.
 */
export const SheetLeaderItemSchema = z.strictObject({
  kind: z.literal('leader').describe('A leader note.'),
  id: SheetItemIdSchema.describe('A UUID, for life; unique in the design.'),
  view: SheetViewIdSchema.describe('The view whose geometry it points at, on the same sheet.'),
  anchor: SheetAnchorSchema.describe(
    'What the arrow points at: a vertex, an edge or one of its points, a face (a dot), an outline, or a free point.',
  ),
  at: SheetPointSchema.describe(
    "Where the leader line ends and its text starts, in the view's own mm (model size, x right, y up); it follows the anchor when it moves.",
  ),
  text: z
    .string()
    .max(SHEET_TEXT_MAX)
    .regex(/\S/, 'is blank')
    .describe('Plain text, up to 2000 characters; may contain newlines.'),
});
export type SheetLeaderItem = z.infer<typeof SheetLeaderItemSchema>;

/** A sticky note's colours; absent is the first, yellow. */
export const SHEET_STICKY_COLORS = ['yellow', 'orange', 'pink', 'blue', 'green'] as const;
export type SheetStickyColor = (typeof SHEET_STICKY_COLORS)[number];

/** The smallest and largest side a sticky note may have, mm. */
export const SHEET_STICKY_MIN = 5;
export const SHEET_STICKY_MAX = 1000;

const stickySide = z.number().min(SHEET_STICKY_MIN).max(SHEET_STICKY_MAX);

/**
 * A coloured note on the sheet (P6-24 S4): not tied to a view, on screen
 * only until `print` is set (ADR-0143 §8).
 */
export const SheetStickyItemSchema = z.strictObject({
  kind: z.literal('sticky').describe('A sticky note.'),
  id: SheetItemIdSchema.describe('A UUID, for life; unique in the design.'),
  at: SheetPointSchema.describe(
    "The note's top-left corner, mm from the sheet's top-left, Y down.",
  ),
  size: z
    .tuple([stickySide, stickySide])
    .describe("The note's width and height, mm, 5 to 1000 each."),
  text: z
    .string()
    .max(SHEET_TEXT_MAX)
    .regex(/\S/, 'is blank')
    .describe('Plain text, up to 2000 characters; may contain newlines. Wraps inside the note.'),
  color: z
    .enum(SHEET_STICKY_COLORS)
    .optional()
    .describe('yellow, orange, pink, blue or green; absent: yellow.'),
  print: z
    .literal(true)
    .optional()
    .describe('Printed and exported (only as true); absent: on screen only.'),
});
export type SheetStickyItem = z.infer<typeof SheetStickyItemSchema>;

/** A centre mark: a cross on a circle's centre (P6-24 S4). */
export const SheetCentreMarkItemSchema = z.strictObject({
  kind: z.literal('centreMark').describe('A centre mark.'),
  id: SheetItemIdSchema.describe('A UUID, for life; unique in the design.'),
  view: SheetViewIdSchema.describe('The view it is drawn in, on the same sheet.'),
  anchors: z
    .array(SheetAnchorSchema)
    .min(1)
    .max(2)
    .describe("The circle: one whole circular edge or a cylinder's face."),
});
export type SheetCentreMarkItem = z.infer<typeof SheetCentreMarkItemSchema>;

/** A centre line: dash-dot, midway between two parallel lines or along an axis (P6-24 S4). */
export const SheetCentreLineItemSchema = z.strictObject({
  kind: z.literal('centreLine').describe('A centre line.'),
  id: SheetItemIdSchema.describe('A UUID, for life; unique in the design.'),
  view: SheetViewIdSchema.describe('The view it is drawn in, on the same sheet.'),
  anchors: z
    .array(SheetAnchorSchema)
    .min(1)
    .max(2)
    .describe(
      "Two parallel lines (whole edges or outlines: it runs midway), or a cylinder's or cone's face (along its axis).",
    ),
});
export type SheetCentreLineItem = z.infer<typeof SheetCentreLineItemSchema>;

/** A parts list's columns, in their default order (plan §4.5). */
export const SHEET_PARTS_COLUMNS = ['item', 'qty', 'name', 'material', 'size', 'mass'] as const;
export type SheetPartsColumn = (typeof SHEET_PARTS_COLUMNS)[number];

/** The longest name or material typed over a parts list's row. */
export const SHEET_PARTS_TEXT_MAX = 200;

/** What was typed over one row of a parts list: its name, its material. */
export const SheetPartsRowSchema = z.strictObject({
  name: z
    .string()
    .max(SHEET_PARTS_TEXT_MAX)
    .optional()
    .describe("The row's name instead of the body's, up to 200 characters."),
  material: z
    .string()
    .max(SHEET_PARTS_TEXT_MAX)
    .optional()
    .describe('The material, free text, up to 200 characters; absent: empty.'),
});
export type SheetPartsRow = z.infer<typeof SheetPartsRowSchema>;

/**
 * A parts list (P6-24 S5, ADR-0143's S5 amendment): a table filled from the
 * bodies of a view each time it is drawn, identical bodies merged into one
 * row with a quantity. Only what a person typed over a row is stored.
 */
export const SheetPartsListItemSchema = z.strictObject({
  kind: z.literal('partsList').describe('A parts list.'),
  id: SheetItemIdSchema.describe('A UUID, for life; unique in the design.'),
  view: SheetViewIdSchema.describe('The view whose bodies it lists, on the same sheet.'),
  at: SheetPointSchema.describe(
    "The table's top-left corner, mm from the sheet's top-left, Y down.",
  ),
  columns: z
    .array(z.enum(SHEET_PARTS_COLUMNS))
    .min(1)
    .optional()
    .describe(
      'The columns shown, in this order, each once: item, qty, name, material, size, mass; absent: all six.',
    ),
  rows: z
    .record(BodyIdSchema, SheetPartsRowSchema)
    .optional()
    .describe(
      "What was typed over a row, by the ID of the row's first body; a body the list no longer shows is ignored.",
    ),
});
export type SheetPartsListItem = z.infer<typeof SheetPartsListItemSchema>;

/**
 * A balloon (P6-24 S5): a numbered circle with a leader to a body, its
 * number that body's item in a parts list of the same sheet.
 */
export const SheetBalloonItemSchema = z.strictObject({
  kind: z.literal('balloon').describe('A balloon.'),
  id: SheetItemIdSchema.describe('A UUID, for life; unique in the design.'),
  view: SheetViewIdSchema.describe('The view whose geometry it points at, on the same sheet.'),
  anchor: SheetAnchorSchema.describe(
    'What the leader points at, on the body it numbers: a vertex, an edge or one of its points, a face (a dot), or an outline.',
  ),
  at: SheetPointSchema.describe(
    "The circle's centre, in the view's own mm (model size, x right, y up); it follows the anchor when it moves.",
  ),
  list: SheetItemIdSchema.describe('The parts list it takes its number from, on the same sheet.'),
});
export type SheetBalloonItem = z.infer<typeof SheetBalloonItemSchema>;

/** The most columns and rows a free table has. */
export const SHEET_TABLE_COLUMNS_MAX = 50;
export const SHEET_TABLE_ROWS_MAX = 500;

/** A free table (P6-24 S5): column widths and rows of cell texts, on the sheet. */
export const SheetTableItemSchema = z.strictObject({
  kind: z.literal('table').describe('A free table.'),
  id: SheetItemIdSchema.describe('A UUID, for life; unique in the design.'),
  at: SheetPointSchema.describe(
    "The table's top-left corner, mm from the sheet's top-left, Y down.",
  ),
  columns: z
    .array(z.number().min(1).max(1000))
    .min(1)
    .max(SHEET_TABLE_COLUMNS_MAX)
    .describe("Each column's width, mm, 1 to 1000; 1 to 50 columns."),
  rows: z
    .array(z.array(z.string().max(SHEET_TEXT_MAX)))
    .min(1)
    .max(SHEET_TABLE_ROWS_MAX)
    .describe(
      "The rows, top to bottom, each one cell text per column (plain, may be empty, may contain newlines); a row's height fits its text.",
    ),
});
export type SheetTableItem = z.infer<typeof SheetTableItemSchema>;

/**
 * Every item kind this version knows. A later slice adds a kind by adding its
 * schema here; a file with a kind this version doesn't know loses that item
 * on load and says so (`parseLeniently`), never failing the design.
 */
export const SheetItemSchema = z.discriminatedUnion('kind', [
  SheetTextItemSchema,
  SheetDimensionItemSchema,
  SheetLeaderItemSchema,
  SheetStickyItemSchema,
  SheetCentreMarkItemSchema,
  SheetCentreLineItemSchema,
  SheetPartsListItemSchema,
  SheetBalloonItemSchema,
  SheetTableItemSchema,
]);
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
    .describe(
      'Texts, dimensions, notes, centre marks and lines, parts lists, balloons and tables, drawn in order after the views.',
    ),
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

/** The item kinds tied to the model by anchors (ADR-0143's S3, S4 and S5 amendments). */
export type SheetAnchoredItem = Extract<
  SheetItem,
  { kind: 'dimension' | 'leader' | 'centreMark' | 'centreLine' | 'balloon' }
>;

/**
 * An item's anchors in their order, empty for an item with none (a text, a
 * sticky note, a parts list, a table). The one place that says which items have anchors: the
 * kernel resolves these, remint rewrites them, layout reads their reports
 * by this index.
 */
export function sheetItemAnchors(item: SheetItem): readonly SheetAnchor[] {
  switch (item.kind) {
    case 'dimension':
    case 'centreMark':
    case 'centreLine':
      return item.anchors;
    case 'leader':
    case 'balloon':
      return [item.anchor];
    default:
      return [];
  }
}

/** `item` with each anchor mapped through `f`, in `sheetItemAnchors`' order; the same item when it has none. */
export function mapSheetItemAnchors<T extends SheetItem>(
  item: T,
  f: (anchor: SheetAnchor) => SheetAnchor,
): T {
  switch (item.kind) {
    case 'dimension':
    case 'centreMark':
    case 'centreLine':
      return { ...item, anchors: item.anchors.map(f) };
    case 'leader':
    case 'balloon':
      return { ...item, anchor: f(item.anchor) };
    default:
      return item;
  }
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
 * per view; an item's view a view of its sheet and its anchors fitting
 * its kind (`sheetItemProblems`); a balloon's list a parts list of its sheet. A body a view names that the design doesn't
 * have is not a problem (it is skipped when the view is drawn), nor is an
 * anchor whose geometry is gone (it is drawn detached), so deleting a body or
 * a feature never touches a sheet.
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
      const at = [s, 'items', i];
      const view = sheetItemView(item);
      if (view !== undefined && !views.has(view)) {
        problems.push({
          path: [...at, 'view'],
          message: `is ${view}, which is not a view of this sheet`,
        });
      }
      if (item.kind === 'balloon') {
        const list = sheet.items.find((it) => it.id === item.list);
        if (list?.kind !== 'partsList') {
          problems.push({
            path: [...at, 'list'],
            message: list
              ? `is ${item.list}, which is not a parts list`
              : `is ${item.list}, which is not a parts list of this sheet`,
          });
        }
      }
      for (const { path, message } of sheetItemProblems(item)) {
        problems.push({ path: [...at, ...path], message });
      }
    });
  });
  return problems;
}

/** "a radius", "an edge". */
const an = (word: string) => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;

/** What an anchor stands for in a dimension: a point, a line, a circle, or nothing it can take. */
function anchorRole(anchor: SheetAnchor): 'point' | 'line' | 'circle' | 'edge' | undefined {
  if ('free' in anchor) return 'point';
  if ('silhouette' in anchor) return anchor.ref.kind === 'face' ? 'line' : undefined;
  const { ref, at } = anchor;
  if (ref.kind === 'vertex') return at === undefined ? 'point' : undefined;
  if (ref.kind === 'face') return at === undefined ? 'circle' : undefined;
  // An edge: one of its points, or the whole edge (a line or a circle, told when it resolves).
  return at === undefined ? 'edge' : 'point';
}

/** Anchors that name nothing an item can take: a vertex's or face's point, an outline of an edge. */
function shapeProblems(anchors: readonly SheetAnchor[], path: string): SheetProblem[] {
  const problems: SheetProblem[] = [];
  anchors.forEach((anchor, a) => {
    if (anchorRole(anchor) !== undefined) return;
    const on = anchor as SheetRefAnchor | SheetSilhouetteAnchor;
    const message =
      'silhouette' in on
        ? `is an outline of ${an(on.ref.kind)}: only a face has outlines`
        : `takes the ${on.at} of ${an(on.ref.kind)}: only an edge has one`;
    problems.push({ path: path === 'anchor' ? [path] : [path, a], message });
  });
  return problems;
}

/**
 * Whether an item's anchors fit its kind (ADR-0143's S3 and S4 amendments):
 * a dimension's its type (`dimensionProblems`); a leader's any one anchor;
 * a centre mark's one circle (a whole edge, told a circle when it resolves,
 * or a cylinder's face); a centre line's two lines (whole edges or outlines)
 * or one cylinder's or cone's face (its axis); a balloon's one anchor on
 * geometry (never a free point: it numbers a body). A parts list names each
 * column once; a free table's rows have one cell per column. Texts and
 * sticky notes have no rules here.
 */
export function sheetItemProblems(item: SheetItem): SheetProblem[] {
  switch (item.kind) {
    case 'dimension':
      return dimensionProblems(item);
    case 'leader':
      return shapeProblems([item.anchor], 'anchor');
    case 'balloon':
      if ('free' in item.anchor) {
        return [{ path: ['anchor'], message: 'is a free point: a balloon points at a body' }];
      }
      return shapeProblems([item.anchor], 'anchor');
    case 'partsList': {
      const seen = new Set<string>();
      const problems: SheetProblem[] = [];
      for (const [c, column] of (item.columns ?? []).entries()) {
        if (seen.has(column)) {
          problems.push({ path: ['columns', c], message: `names the ${column} column twice` });
        }
        seen.add(column);
      }
      return problems;
    }
    case 'table': {
      const n = item.columns.length;
      const problems: SheetProblem[] = [];
      for (const [r, row] of item.rows.entries()) {
        if (row.length !== n) {
          problems.push({
            path: ['rows', r],
            message: `has ${row.length} ${row.length === 1 ? 'cell' : 'cells'}, but the table has ${n} ${n === 1 ? 'column' : 'columns'}`,
          });
        }
      }
      return problems;
    }
    case 'centreMark':
    case 'centreLine': {
      const problems = shapeProblems(item.anchors, 'anchors');
      if (problems.length > 0) return problems;
      const roles = item.anchors.map(anchorRole);
      const mark = item.kind === 'centreMark';
      const fits = mark
        ? roles.length === 1 && (roles[0] === 'edge' || roles[0] === 'circle')
        : roles.length === 1
          ? roles[0] === 'circle'
          : roles.every((r) => r === 'line' || r === 'edge');
      if (fits) return [];
      return [
        {
          path: ['anchors'],
          message: mark
            ? "don't fit a centre mark: it takes one whole edge or a cylinder's face"
            : "don't fit a centre line: it takes two whole edges or outlines, or a cylinder's or cone's face",
        },
      ];
    }
    default:
      return [];
  }
}

/**
 * Whether a dimension's anchors fit its type (ADR-0143's S3 amendment). Each
 * anchor is a point (a vertex, an edge's `at` point, a free point), a line
 * (a whole edge, an outline) or a circle (a whole edge, a cylinder's face):
 *
 * - `linear`: one whole edge (its length) or an outline, or two anchors that
 *   are points or lines;
 * - `radius`: one circle (a whole edge or a face);
 * - `diameter`: one circle, or two outlines (a cylinder seen from the side);
 * - `angle`: two lines (whole edges or outlines).
 *
 * A face is taken only whole for a radius or diameter, or as an outline; a
 * vertex only whole. `direction` is for a linear dimension only. Whether a
 * whole edge is a line or a circle is the geometry's to tell, when it resolves.
 */
export function dimensionProblems(item: SheetDimensionItem): SheetProblem[] {
  const problems = shapeProblems(item.anchors, 'anchors');
  if (problems.length > 0) return problems;
  const roles = item.anchors.map(anchorRole);
  const n = roles.length;
  const lineLike = (r: (typeof roles)[number]) => r === 'line' || r === 'edge';
  const circleLike = (r: (typeof roles)[number]) => r === 'circle' || r === 'edge';
  const outline = (a: SheetAnchor) => 'silhouette' in a;
  let fits: boolean;
  let wants: string;
  switch (item.type) {
    case 'linear':
      fits = n === 1 ? lineLike(roles[0]) : roles.every((r) => r === 'point' || lineLike(r));
      wants = 'a whole edge or an outline, or two points, edges or outlines';
      break;
    case 'radius':
      fits = n === 1 && circleLike(roles[0]);
      wants = 'one whole edge or a face';
      break;
    case 'diameter':
      fits = n === 1 ? circleLike(roles[0]) : item.anchors.every(outline);
      wants = 'one whole edge or a face, or two outlines';
      break;
    case 'angle':
      fits = n === 2 && roles.every(lineLike);
      wants = 'two whole edges or outlines';
      break;
  }
  if (!fits) {
    problems.push({
      path: ['anchors'],
      message: `don't fit ${an(item.type)} dimension: it takes ${wants}`,
    });
  }
  if (item.direction !== undefined && item.type !== 'linear') {
    problems.push({
      path: ['direction'],
      message: `is set on ${an(item.type)} dimension: only a linear one has a direction`,
    });
  }
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
