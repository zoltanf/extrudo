/**
 * Drawing sheets through the API (P6-24 S6, ADR-0143's S6 amendment): a sheet,
 * its views and its items, each made or changed by one of core's sheet
 * commands (`sheets.ts`), so every call is one undo step and the document is
 * always one the loader takes.
 *
 * ```ts
 * const plate = d.box({ length: '40 mm', width: '20 mm', height: '5 mm' });
 * const sheet = d.addSheet('Plate', { size: 'A4', start: 'standard' });
 * const front = sheet.view('Front');
 * front?.addDimension('linear', [edgeA, edgeB], [20, -12]);
 * sheet.addText('Deburr all edges', [20, 180]);
 * ```
 *
 * Nothing derived is stored: a view says what to draw, never its lines; a
 * dimension what it measures, never its value. The API has no kernel, so an
 * anchor on the model must come with its fingerprint (what the kernel's
 * `reference` gives with a name), as the document requires; and the standard
 * views are placed on a grid of the paper, not fitted to the model's size.
 */
import {
  addSheetItem,
  addSheetView,
  type BodyId,
  type Command,
  type ExtrudoDocument,
  type GeomFingerprint,
  type GeomRef,
  moveSheet,
  removeSheet,
  removeSheetItems,
  removeSheetView,
  SHEET_ANCHOR_REF_KINDS,
  SHEET_STANDARD_VIEWS,
  type Sheet,
  type SheetAnchor,
  type SheetAnchorPoint,
  type SheetChanges,
  type SheetDimensionDirection,
  type SheetDimensionType,
  type SheetId,
  type SheetItem,
  type SheetItemChanges,
  type SheetItemId,
  type SheetPartsColumn,
  type SheetPartsRow,
  type SheetRefAnchor,
  type SheetScale,
  type SheetSize,
  type SheetStandardView,
  type SheetStickyColor,
  type SheetView,
  type SheetViewChanges,
  type SheetViewId,
  type SheetViewSide,
  type SheetViewStyle,
  sheetPaperSize,
  sheetProjectedFrame,
  sheetStandardFrom,
  sheetViewFrame,
  updateSheet,
  updateSheetItem,
  updateSheetView,
  type Vec2,
} from '@extrudo/core';
import { ApiError } from './error';
import type { FeatureHandle } from './handles';
import type { IdKind } from './ids';

/** What the sheet handles change the design through (`Design`), kept off its surface. */
export interface SheetHandleContext {
  readonly doc: ExtrudoDocument;
  dispatch<P>(command: Command<P>): void;
  ids(kind: IdKind): string;
  /** A body reference or ID as the body's ID. */
  bodyId(body: GeomRef | string): BodyId;
}

/** A sheet, named however the caller has it: its handle, its ID or its name. */
export type SheetLike = string | SheetHandle;
/** A view of a sheet: its handle, its ID or its name. */
export type SheetViewLike = string | SheetViewHandle;
/** A body a view draws or a parts list row names: a body reference, its ID, or the feature that made it. */
export type SheetBodyInput = GeomRef | string | FeatureHandle;

/**
 * What a sheet item measures from or points at (ADR-0143 §4): a vertex, an
 * edge or a face as a reference (`plate.edge([...])`, `d.ref('edge', name)`),
 * one point of an edge (`{ ref, at: 'middle' }`), one of a cylinder's or
 * cone's two outlines in the view (`{ ref, silhouette: 1 }`), or a point of
 * the view not tied to the model (`[x, y]` or `{ free: [x, y] }`, the view's
 * own mm: model size, x right, y up). A reference needs its fingerprint, on
 * the reference or beside it (`{ ref, fingerprint }`): the document keeps it
 * to find the geometry again when the name is gone.
 */
export type SheetAnchorInput =
  | GeomRef
  | { ref: GeomRef; at?: SheetAnchorPoint; fingerprint?: GeomFingerprint }
  | { ref: GeomRef; silhouette: 1 | -1; fingerprint?: GeomFingerprint }
  | { free: readonly [number, number] }
  | readonly [number, number];

/** The title blocks a sheet may have; `false` for none. */
export type SheetTitleBlockInput = 'simple' | 'full' | false;
/** A border (`true`), one with zone letters and numbers (`'zones'`), or none (`false`). */
export type SheetBorderInput = boolean | 'zones';

/** What a sheet's setup holds: paper, scale, projection, border and title block. */
export interface SheetSetup {
  name?: string;
  /** A named paper (`A4` … `A0`, `letter`, `legal`, `tabloid`) or two sides in mm. */
  size?: SheetSize;
  orientation?: 'landscape' | 'portrait';
  /** The views' scale unless a view has its own: `[1, 2]` is 1:2. */
  scale?: SheetScale;
  /** The projection angle projected views follow. */
  projection?: 'first' | 'third';
  /** Decimals dimensions show, 0 to 4. */
  decimals?: number;
  border?: SheetBorderInput;
  titleBlock?: SheetTitleBlockInput;
  /**
   * What is typed into the title block's fields, by field name (`title`,
   * `drawnBy`, …). On a new sheet these are its fields (absent: the design's
   * name as `title` and its units as `units`); on `update` they are merged
   * over the ones there, an empty text clearing one. Fields in braces
   * (`{date}`, `{sheet}`, `{= width}`) are filled when the sheet is drawn.
   */
  fields?: Record<string, string>;
}

/** Where the four standard views go, sheet mm from the top-left: any left out is placed on a grid. */
export type StandardViewPlaces = Partial<Record<'front' | 'top' | 'side' | 'iso', Vec2>>;

/** What `d.addSheet(name, options)` takes besides the name. */
export interface SheetOptions extends Omit<SheetSetup, 'name'> {
  /** The sheet's ID (`sh1`… from the counter otherwise). */
  id?: string;
  /** Its place among the sheets; the end by default. */
  index?: number;
  /**
   * `'standard'`: the New Drawing dialog's Standard views (a Front base view
   * and the Top, side and Isometric views projected from it, for the sheet's
   * projection angle), in the same step; `'empty'` (the default): no views.
   */
  start?: 'standard' | 'empty';
  /** With `start: 'standard'`: the bodies the views draw; absent: every shown body. */
  bodies?: readonly SheetBodyInput[];
  /** With `start: 'standard'`: where views go instead of the grid. */
  at?: StandardViewPlaces;
}

/** What a base view looks along: a standard view's name, or a direction and the world direction up the sheet. */
export type SheetViewFromInput =
  | SheetStandardView
  | { direction: readonly [number, number, number]; up: readonly [number, number, number] };

/** What a view's setup holds besides its place. */
export interface SheetViewSetup {
  name?: string;
  /** The view's origin on the sheet, mm from the top-left, Y down. */
  at?: Vec2;
  /** A base view's own scale; `null` takes the sheet's again. */
  scale?: SheetScale | null;
  /** A base view's style; `null` is the default, `hidden`. */
  style?: SheetViewStyle | null;
  /** A base view's bodies; `null` draws every shown body. */
  bodies?: readonly SheetBodyInput[] | null;
  /** Tangent edges drawn (the default) or left out. */
  tangentEdges?: boolean;
  /** Centre lines and marks drawn (the default) or left out. */
  centreLines?: boolean;
  /** The view's name and scale drawn under it. */
  label?: boolean;
}

/** What `sheet.addView(name, options)` takes: a base view. */
export interface SheetViewOptions
  extends Omit<SheetViewSetup, 'name' | 'at' | 'scale' | 'style' | 'bodies'> {
  /** Where it is on the sheet, mm from the top-left, Y down. */
  at: Vec2;
  /** What it looks along; `front` by default. */
  from?: SheetViewFromInput;
  scale?: SheetScale;
  style?: SheetViewStyle;
  /** The bodies drawn; absent: every shown body. */
  bodies?: readonly SheetBodyInput[];
  /** The view's ID (`sv1`… from the counter otherwise). */
  id?: string;
}

/** What `view.project(side, at, options)` takes besides the side and the place. */
export interface ProjectedViewOptions {
  /** Its name; the standard view it is ("Top", "Left"), else "Isometric" or "Projected". */
  name?: string;
  tangentEdges?: boolean;
  centreLines?: boolean;
  label?: boolean;
  id?: string;
}

/** What a dimension takes besides its type, anchors and place. */
export interface SheetDimensionOptions {
  /** A linear one: `horizontal`, `vertical` or `aligned`; absent: from where it is placed. */
  direction?: SheetDimensionDirection;
  /** Decimals shown, 0 to 4; absent: the sheet's. */
  decimals?: number;
  /** Text before the value (and before R or Ø). */
  before?: string;
  /** Text after the value. */
  after?: string;
  /** A reference dimension, drawn in brackets. */
  reference?: boolean;
  id?: string;
}

/** A row of a parts list typed over: the body it starts with, and its name or material. */
export interface SheetPartsRowInput extends SheetPartsRow {
  body: SheetBodyInput;
}

/** What `view.addPartsList(at, options)` takes besides its place. */
export interface SheetPartsListOptions {
  /** The columns shown, in this order, each once; absent: all six. */
  columns?: readonly SheetPartsColumn[];
  /** What was typed over rows: a name instead of the body's, a material. */
  rows?: readonly SheetPartsRowInput[];
  id?: string;
}

/** What `sheet.addSticky(text, at, options)` takes besides the text and the place. */
export interface SheetStickyOptions {
  /** Width and height, mm; [40, 30] by default. */
  size?: readonly [number, number];
  color?: SheetStickyColor;
  /** Printed and exported; on screen only by default. */
  print?: boolean;
  id?: string;
}

const STICKY_SIZE: readonly [number, number] = [40, 30];
const TABLE_COLUMN = 30;

// ------------------------------------------------------------------ anchors

/** An anchor as stored, from any form `SheetAnchorInput` takes. */
export function sheetAnchorOf(input: SheetAnchorInput, path = 'anchor'): SheetAnchor {
  if (Array.isArray(input)) return { free: freePoint(input, path) };
  const value = input as Exclude<SheetAnchorInput, readonly [number, number]>;
  if ('free' in value) return { free: freePoint(value.free, path) };
  if ('ref' in value) {
    const ref = anchorRef(value.ref, value.fingerprint, `${path}.ref`);
    if ('silhouette' in value) {
      if (value.silhouette !== 1 && value.silhouette !== -1) {
        throw new ApiError('An outline is silhouette 1 or -1.', { path: `${path}.silhouette` });
      }
      return { ref, silhouette: value.silhouette };
    }
    return { ref, ...(value.at !== undefined && { at: value.at }) };
  }
  return { ref: anchorRef(value as GeomRef, undefined, path) };
}

function freePoint(point: readonly number[], path: string): [number, number] {
  const [x, y] = point;
  if (point.length !== 2 || typeof x !== 'number' || typeof y !== 'number') {
    throw new ApiError("A free point is [x, y] in the view's mm.", { path });
  }
  return [x, y];
}

function anchorRef(
  ref: GeomRef,
  fingerprint: GeomFingerprint | undefined,
  path: string,
): SheetRefAnchor['ref'] {
  if (!(SHEET_ANCHOR_REF_KINDS as readonly string[]).includes(ref.kind)) {
    throw new ApiError(
      `A sheet item can't point at a ${ref.kind}: use a vertex, an edge or a face.`,
      {
        path,
      },
    );
  }
  const print = fingerprint ?? ref.fingerprint;
  if (!print) {
    throw new ApiError(
      `${ref.id} has no fingerprint, which a sheet needs to find it again: pass { ref, fingerprint } or a reference that carries one (the kernel's reference to it).`,
      { path },
    );
  }
  return {
    kind: ref.kind as (typeof SHEET_ANCHOR_REF_KINDS)[number],
    id: ref.id,
    fingerprint: print,
  };
}

function bodyOf(design: SheetHandleContext, body: SheetBodyInput): BodyId {
  if (typeof body === 'object' && 'body' in body && typeof body.body === 'function') {
    return design.bodyId(body.body());
  }
  return design.bodyId(body as GeomRef | string);
}

// ------------------------------------------------------------------- setups

function titleFields(doc: ExtrudoDocument): Record<string, string> {
  return { title: doc.name.slice(0, 2000), units: doc.settings.units };
}

/** A new sheet as stored, from `addSheet`'s options. */
export function newApiSheet(
  design: SheetHandleContext,
  id: SheetId,
  name: string,
  options: SheetOptions,
): Sheet {
  const titleBlock = options.titleBlock ?? 'simple';
  const sheet: Sheet = {
    id,
    name,
    size: options.size ?? 'A3',
    orientation: options.orientation ?? 'landscape',
    scale: options.scale ? [options.scale[0], options.scale[1]] : [1, 1],
    projection: options.projection ?? 'first',
    decimals: options.decimals ?? 1,
    ...borderOf(options.border ?? true),
    ...(titleBlock !== false && {
      titleBlock: {
        template: titleBlock,
        fields: options.fields ? { ...options.fields } : titleFields(design.doc),
      },
    }),
    views: [],
    items: [],
  };
  if (options.start === 'standard') {
    const bodies = options.bodies?.map((b) => bodyOf(design, b));
    sheet.views = standardViews(design, sheet, bodies, options.at ?? {});
  }
  return sheet;
}

function borderOf(border: SheetBorderInput): Pick<Sheet, 'border'> {
  if (border === false) return {};
  return { border: border === 'zones' ? { zones: true } : {} };
}

/** A setup as the changes `updateSheet` takes (fields merged over the ones stored). */
function sheetChanges(sheet: Sheet, setup: SheetSetup): SheetChanges {
  const changes: SheetChanges = {};
  if (setup.name !== undefined) changes.name = setup.name;
  if (setup.size !== undefined) changes.size = setup.size;
  if (setup.orientation !== undefined) changes.orientation = setup.orientation;
  if (setup.scale !== undefined) changes.scale = [setup.scale[0], setup.scale[1]];
  if (setup.projection !== undefined) changes.projection = setup.projection;
  if (setup.decimals !== undefined) changes.decimals = setup.decimals;
  if (setup.border !== undefined) changes.border = borderOf(setup.border).border ?? null;
  if (setup.titleBlock === false) changes.titleBlock = null;
  else if (setup.titleBlock !== undefined || setup.fields !== undefined) {
    const template = setup.titleBlock || sheet.titleBlock?.template || 'simple';
    const fields = { ...(sheet.titleBlock?.fields ?? {}) };
    for (const [key, value] of Object.entries(setup.fields ?? {})) {
      if (value === '') delete fields[key];
      else fields[key] = value;
    }
    changes.titleBlock = { template, fields };
  }
  return changes;
}

function viewFrom(from: SheetViewFromInput | undefined): SheetView['from'] {
  if (from === undefined) return sheetStandardFrom('front');
  if (typeof from === 'string') {
    if (!(from in SHEET_STANDARD_VIEWS)) {
      throw new ApiError(
        `"${from}" is not a standard view: ${Object.keys(SHEET_STANDARD_VIEWS).join(', ')}.`,
        { path: 'from' },
      );
    }
    return sheetStandardFrom(from);
  }
  const vec = (v: readonly number[]): [number, number, number] => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
  return { kind: 'base', direction: vec(from.direction), up: vec(from.up) };
}

/** The view switches as stored: only the ones off (`false`) or on (`label: true`). */
function switches(setup: Pick<SheetViewSetup, 'tangentEdges' | 'centreLines' | 'label'>) {
  return {
    ...(setup.tangentEdges === false && { tangentEdges: false as const }),
    ...(setup.centreLines === false && { centreLines: false as const }),
    ...(setup.label === true && { label: true as const }),
  };
}

function viewChanges(design: SheetHandleContext, setup: SheetViewSetup): SheetViewChanges {
  const changes: SheetViewChanges = {};
  if (setup.name !== undefined) changes.name = setup.name;
  if (setup.at !== undefined) changes.at = [setup.at[0], setup.at[1]];
  if (setup.scale !== undefined) changes.scale = setup.scale && [setup.scale[0], setup.scale[1]];
  if (setup.style !== undefined) changes.style = setup.style;
  if (setup.bodies !== undefined) {
    changes.bodies = setup.bodies === null ? null : setup.bodies.map((b) => bodyOf(design, b));
  }
  if (setup.tangentEdges !== undefined) changes.tangentEdges = setup.tangentEdges ? null : false;
  if (setup.centreLines !== undefined) changes.centreLines = setup.centreLines ? null : false;
  if (setup.label !== undefined) changes.label = setup.label ? true : null;
  return changes;
}

/** "Front", "Top", "Left"…, or "Isometric" / "Projected", for a projected view. */
function projectedName(sheet: Sheet, parent: SheetViewId, side: SheetViewSide): string {
  if (side.startsWith('iso-')) return 'Isometric';
  const frame = sheetViewFrame(sheet, parent);
  if (!frame) return 'Projected';
  const { direction } = sheetProjectedFrame(frame, sheet.projection, side);
  const length = Math.hypot(...direction);
  const match = (
    Object.entries(SHEET_STANDARD_VIEWS) as [string, { direction: readonly number[] }][]
  ).find(
    ([, v]) =>
      ((v.direction[0] ?? 0) * direction[0] +
        (v.direction[1] ?? 0) * direction[1] +
        (v.direction[2] ?? 0) * direction[2]) /
        length >
      1 - 1e-9,
  );
  return match ? match[0].charAt(0).toUpperCase() + match[0].slice(1) : 'Projected';
}

/** `name`, or "name 2", "name 3"… when another view of the sheet has it. */
function freeViewName(sheet: Sheet, name: string): string {
  const taken = new Set(sheet.views.map((v) => v.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const next = `${name} ${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}

/**
 * The four standard views (New Drawing's Standard views): Front, and the top,
 * side and isometric views projected from it, their origins on a 2 × 2 grid of
 * the paper inside the border (front and side in one row, front and top in one
 * column, as the projection angle puts them), unless `at` places them.
 */
function standardViews(
  design: SheetHandleContext,
  sheet: Sheet,
  bodies: BodyId[] | undefined,
  at: StandardViewPlaces,
): SheetView[] {
  const { width, height } = sheetPaperSize(sheet);
  const left = width * 0.3;
  const right = width * 0.7;
  const upper = height * 0.3;
  const lower = height * 0.62;
  const first = sheet.projection === 'first';
  const frontAt = at.front ?? [left, first ? upper : lower];
  const front: SheetView = {
    id: design.ids('sheetView') as SheetViewId,
    name: 'Front',
    at: [frontAt[0], frontAt[1]],
    from: sheetStandardFrom('front'),
    ...(bodies && { bodies }),
  };
  const sheetWith = { ...sheet, views: [front] };
  const projected = (side: SheetViewSide, place: Vec2): SheetView => ({
    id: design.ids('sheetView') as SheetViewId,
    name: projectedName(sheetWith, front.id, side),
    at: [place[0], place[1]],
    from: { kind: 'projected', parent: front.id, side },
  });
  const topY = first ? lower : upper;
  return [
    front,
    projected(first ? 'below' : 'above', at.top ?? [front.at[0], topY]),
    projected('right', at.side ?? [right, front.at[1]]),
    projected('iso-above-right', at.iso ?? [right, topY]),
  ];
}

// ------------------------------------------------------------------ handles

/**
 * One sheet of the design, by its ID (P6-24). Its views and items are added
 * here and on its views' handles; each call is one undo step.
 */
export class SheetHandle {
  readonly id: SheetId;
  readonly #design: SheetHandleContext;

  constructor(design: SheetHandleContext, id: SheetId) {
    this.#design = design;
    this.id = id;
  }

  /** The stored sheet, or `undefined` when it is gone. */
  get sheet(): Sheet | undefined {
    return (this.#design.doc.sheets ?? []).find((s) => s.id === this.id);
  }

  /** Its name, as its tab shows it. */
  get name(): string {
    return this.sheet?.name ?? this.id;
  }

  #own(): Sheet {
    const sheet = this.sheet;
    if (!sheet) throw new ApiError(`Sheet ${this.id} is gone.`);
    return sheet;
  }

  /** Changes its setup (Sheet Setup, one step): paper, scale, projection, border, title block. */
  update(setup: SheetSetup): this {
    this.#design.dispatch(updateSheet({ id: this.id, changes: sheetChanges(this.#own(), setup) }));
    return this;
  }

  /** Renames it; the name must be free among the sheets. */
  rename(name: string): this {
    return this.update({ name });
  }

  /** Moves it to `index` among the sheets (0 is the first page). */
  move(index: number): this {
    this.#design.dispatch(moveSheet({ id: this.id, index }));
    return this;
  }

  /** Deletes it, its views and its items. */
  remove(): void {
    this.#design.dispatch(removeSheet({ id: this.id }));
  }

  /** Its views, in drawing order. */
  views(): SheetViewHandle[] {
    return (this.sheet?.views ?? []).map((v) => new SheetViewHandle(this.#design, this, v.id));
  }

  /** One of its views, by ID or (case-insensitive) name, or `undefined`. */
  view(view: string): SheetViewHandle | undefined {
    const wanted = view.toLowerCase();
    const found = this.sheet?.views.find((v) => v.id === view || v.name.toLowerCase() === wanted);
    return found && new SheetViewHandle(this.#design, this, found.id);
  }

  /** Its items (texts, dimensions, notes, lists, tables), in drawing order. */
  items(): SheetItemHandle[] {
    return (this.sheet?.items ?? []).map((i) => new SheetItemHandle(this.#design, i.id));
  }

  /** One of its items, by ID, or `undefined`. */
  item(id: string): SheetItemHandle | undefined {
    return this.sheet?.items.some((i) => i.id === id)
      ? new SheetItemHandle(this.#design, id as SheetItemId)
      : undefined;
  }

  /**
   * A base view (Base View): looking along a standard view or a direction of
   * its own, its origin at `options.at`; projected views are made from it
   * with `view.project`.
   */
  addView(name: string, options: SheetViewOptions): SheetViewHandle {
    const id = (options.id ?? this.#design.ids('sheetView')) as SheetViewId;
    const view: SheetView = {
      id,
      name,
      at: [options.at[0], options.at[1]],
      from: viewFrom(options.from),
      ...(options.scale && { scale: [options.scale[0], options.scale[1]] }),
      ...(options.style && { style: options.style }),
      ...(options.bodies && { bodies: options.bodies.map((b) => bodyOf(this.#design, b)) }),
      ...switches(options),
    };
    this.#design.dispatch(addSheetView({ sheet: this.id, view }));
    return new SheetViewHandle(this.#design, this, id);
  }

  /** A text (Text): its top-left corner at `at`, sheet mm; `size` is the letter height. */
  addText(
    text: string,
    at: Vec2,
    options: { size?: number; width?: number; id?: string } = {},
  ): SheetItemHandle {
    return this.#add({
      kind: 'text',
      id: this.#itemId(options.id),
      at: [at[0], at[1]],
      text,
      ...(options.size !== undefined && { size: options.size }),
      ...(options.width !== undefined && { width: options.width }),
    });
  }

  /** A sticky note (Sticky Note): on screen only unless `print` is set. */
  addSticky(text: string, at: Vec2, options: SheetStickyOptions = {}): SheetItemHandle {
    const size = options.size ?? STICKY_SIZE;
    return this.#add({
      kind: 'sticky',
      id: this.#itemId(options.id),
      at: [at[0], at[1]],
      size: [size[0], size[1]],
      text,
      ...(options.color && { color: options.color }),
      ...(options.print && { print: true }),
    });
  }

  /** A free table (Table): rows of cell texts, top to bottom; columns 30 mm wide unless given. */
  addTable(
    at: Vec2,
    rows: readonly (readonly string[])[],
    options: { columns?: readonly number[]; id?: string } = {},
  ): SheetItemHandle {
    const count = Math.max(1, ...rows.map((r) => r.length));
    const columns = options.columns
      ? [...options.columns]
      : Array.from({ length: count }, () => TABLE_COLUMN);
    return this.#add({
      kind: 'table',
      id: this.#itemId(options.id),
      at: [at[0], at[1]],
      columns,
      rows: rows.map((row) => columns.map((_, i) => row[i] ?? '')),
    });
  }

  #itemId(id: string | undefined): SheetItemId {
    return (id ?? this.#design.ids('sheetItem')) as SheetItemId;
  }

  #add(item: SheetItem): SheetItemHandle {
    this.#design.dispatch(addSheetItem({ sheet: this.id, item }));
    return new SheetItemHandle(this.#design, item.id as SheetItemId);
  }

  /** @internal What a view's handle adds its items through. */
  addItem(item: SheetItem): SheetItemHandle {
    return this.#add(item);
  }

  toString(): string {
    return this.name;
  }
}

/**
 * One view of a sheet, by its ID. The items tied to it (dimensions, notes,
 * centre marks and lines, parts lists, balloons) are added here, in its own
 * mm: model size, x right, y up from the view's origin.
 */
export class SheetViewHandle {
  readonly id: SheetViewId;
  /** The sheet it is on. */
  readonly sheet: SheetHandle;
  readonly #design: SheetHandleContext;

  constructor(design: SheetHandleContext, sheet: SheetHandle, id: SheetViewId) {
    this.#design = design;
    this.sheet = sheet;
    this.id = id;
  }

  /** The stored view, or `undefined` when it is gone. */
  get view(): SheetView | undefined {
    return this.sheet.sheet?.views.find((v) => v.id === this.id);
  }

  get name(): string {
    return this.view?.name ?? this.id;
  }

  /** Changes it (one step): name, place, a base view's scale, style and bodies, its switches. */
  update(setup: SheetViewSetup): this {
    this.#design.dispatch(
      updateSheetView({ id: this.id, changes: viewChanges(this.#design, setup) }),
    );
    return this;
  }

  /** Deletes it, the views projected from it and the items in them (one step). */
  remove(): void {
    this.#design.dispatch(removeSheetView({ id: this.id }));
  }

  /**
   * A view projected from this one (Projected View) on `side`, its origin at
   * `at`: it stays lined up with this view and takes its scale and style.
   */
  project(side: SheetViewSide, at: Vec2, options: ProjectedViewOptions = {}): SheetViewHandle {
    const sheet = this.sheet.sheet;
    if (!sheet) throw new ApiError(`Sheet ${this.sheet.id} is gone.`);
    const id = (options.id ?? this.#design.ids('sheetView')) as SheetViewId;
    const view: SheetView = {
      id,
      name: options.name ?? freeViewName(sheet, projectedName(sheet, this.id, side)),
      at: [at[0], at[1]],
      from: { kind: 'projected', parent: this.id, side },
      ...switches(options),
    };
    this.#design.dispatch(addSheetView({ sheet: this.sheet.id, view }));
    return new SheetViewHandle(this.#design, this.sheet, id);
  }

  /**
   * A dimension (Dimension), measured from the model each time it is drawn:
   * `linear` between two anchors (or along one edge), `radius` and `diameter`
   * of a circle, `angle` between two lines. Its text is at `at`.
   */
  addDimension(
    type: SheetDimensionType,
    anchors: readonly SheetAnchorInput[],
    at: Vec2,
    options: SheetDimensionOptions = {},
  ): SheetItemHandle {
    return this.sheet.addItem({
      kind: 'dimension',
      id: this.#itemId(options.id),
      view: this.id,
      type,
      ...(options.direction && { direction: options.direction }),
      anchors: anchors.map((a, i) => sheetAnchorOf(a, `anchors[${i}]`)),
      at: [at[0], at[1]],
      ...(options.decimals !== undefined && { decimals: options.decimals }),
      ...(options.before !== undefined && { before: options.before }),
      ...(options.after !== undefined && { after: options.after }),
      ...(options.reference && { reference: true }),
    });
  }

  /** A leader note (Leader Note): its text at `at`, an arrow to what `anchor` names. */
  addLeader(
    anchor: SheetAnchorInput,
    at: Vec2,
    text: string,
    options: { id?: string } = {},
  ): SheetItemHandle {
    return this.sheet.addItem({
      kind: 'leader',
      id: this.#itemId(options.id),
      view: this.id,
      anchor: sheetAnchorOf(anchor),
      at: [at[0], at[1]],
      text,
    });
  }

  /** A centre mark (Centre Mark) on a circular edge or a cylinder's face. */
  addCentreMark(anchor: SheetAnchorInput, options: { id?: string } = {}): SheetItemHandle {
    return this.sheet.addItem({
      kind: 'centreMark',
      id: this.#itemId(options.id),
      view: this.id,
      anchors: [sheetAnchorOf(anchor)],
    });
  }

  /** A centre line (Centreline): midway between two parallel lines, or along a cylinder's or cone's axis. */
  addCentreLine(
    anchors: readonly SheetAnchorInput[],
    options: { id?: string } = {},
  ): SheetItemHandle {
    return this.sheet.addItem({
      kind: 'centreLine',
      id: this.#itemId(options.id),
      view: this.id,
      anchors: anchors.map((a, i) => sheetAnchorOf(a, `anchors[${i}]`)),
    });
  }

  /**
   * A parts list (Parts List) of this view's bodies, its top-left corner at
   * `at` in sheet mm. Its rows, quantities, sizes and masses are worked out
   * each time it is drawn; only what is typed over a row is stored.
   */
  addPartsList(at: Vec2, options: SheetPartsListOptions = {}): SheetItemHandle {
    let rows: Record<BodyId, SheetPartsRow> | undefined;
    if (options.rows) {
      rows = {};
      for (const { body, ...typed } of options.rows) rows[bodyOf(this.#design, body)] = typed;
    }
    return this.sheet.addItem({
      kind: 'partsList',
      id: this.#itemId(options.id),
      view: this.id,
      at: [at[0], at[1]],
      ...(options.columns && { columns: [...options.columns] }),
      ...(rows && { rows }),
    });
  }

  /** A balloon (Balloon) at `at`, pointing at a body and showing its number in `list`. */
  addBalloon(
    anchor: SheetAnchorInput,
    at: Vec2,
    list: SheetItemHandle | string,
    options: { id?: string } = {},
  ): SheetItemHandle {
    return this.sheet.addItem({
      kind: 'balloon',
      id: this.#itemId(options.id),
      view: this.id,
      anchor: sheetAnchorOf(anchor),
      at: [at[0], at[1]],
      list: (typeof list === 'string' ? list : list.id) as SheetItemId,
    });
  }

  #itemId(id: string | undefined): SheetItemId {
    return (id ?? this.#design.ids('sheetItem')) as SheetItemId;
  }

  toString(): string {
    return this.name;
  }
}

/** What an item's `update` takes: its stored fields, anchors in any form `SheetAnchorInput` takes. */
export type SheetItemUpdate = Record<string, unknown> & {
  anchors?: readonly SheetAnchorInput[];
  anchor?: SheetAnchorInput;
};

/** One item of a sheet, by its ID: a text, a dimension, a note, a list or a table. */
export class SheetItemHandle {
  readonly id: SheetItemId;
  readonly #design: SheetHandleContext;

  constructor(design: SheetHandleContext, id: SheetItemId) {
    this.#design = design;
    this.id = id;
  }

  /** The stored item, or `undefined` when it is gone. */
  get item(): SheetItem | undefined {
    for (const sheet of this.#design.doc.sheets ?? []) {
      const found = sheet.items.find((i) => i.id === this.id);
      if (found) return found;
    }
    return undefined;
  }

  /** What it is: `text`, `dimension`, `leader`, `sticky`, `centreMark`, `centreLine`, `partsList`, `balloon`, `table`. */
  get kind(): SheetItem['kind'] | undefined {
    return this.item?.kind;
  }

  /**
   * Changes its stored fields (one step), `null` clearing an optional one:
   * `{ text }`, `{ at }`, `{ decimals: 2 }`, `{ anchors: [...] }`.
   */
  update(changes: SheetItemUpdate): this {
    const { anchors, anchor, ...rest } = changes;
    const stored: Record<string, unknown> = { ...rest };
    if (anchors) stored.anchors = anchors.map((a, i) => sheetAnchorOf(a, `anchors[${i}]`));
    if (anchor) stored.anchor = sheetAnchorOf(anchor);
    this.#design.dispatch(updateSheetItem({ id: this.id, changes: stored as SheetItemChanges }));
    return this;
  }

  /** Deletes it (a parts list's balloons with it). */
  remove(): void {
    this.#design.dispatch(removeSheetItems({ ids: [this.id] }));
  }

  toString(): string {
    return this.id;
  }
}

/** A sheet of `doc`, by handle, ID or (case-insensitive) name. */
export function findSheet(doc: ExtrudoDocument, sheet: SheetLike): Sheet | undefined {
  const id = typeof sheet === 'string' ? sheet : sheet.id;
  const wanted = id.toLowerCase();
  return (doc.sheets ?? []).find((s) => s.id === id || s.name.toLowerCase() === wanted);
}
