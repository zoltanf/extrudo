/**
 * A design's sheets as code (P6-24 S6, ADR-0143's S6 amendment): one
 * `design.addSheet` per sheet, then its views (`addView`, `project`) and its
 * items in their stored order, so the emitted script builds the same sheets.
 * Every stored field is written that the API would not give by itself, and
 * nothing the API does not store (no measured value, no row): what is
 * derived is computed again when the sheet is drawn.
 */
import {
  type ExtrudoDocument,
  SHEET_STANDARD_VIEWS,
  type Sheet,
  type SheetAnchor,
  type SheetItem,
  type SheetView,
} from '@extrudo/core';
import type { EmitContext } from './context';
import {
  arr,
  bool,
  call,
  constant,
  type Expr,
  num,
  obj,
  raw,
  type Stmt,
  statement,
  str,
} from './print';
import { fingerprintExpr, numbers, refExpr } from './refs';

type Prop = [string, Expr];

/** Hands out a free variable name from a name (and a fallback when it gives none). */
export type VariableOf = (name: string, fallback: string) => string;

/** The `design.addSheet(…)` calls and what follows each, in page order. */
export function sheetStatements(
  doc: ExtrudoDocument,
  ctx: EmitContext,
  variable: VariableOf,
): Stmt[] {
  const out: Stmt[] = [];
  for (const sheet of doc.sheets ?? []) out.push(...oneSheet(sheet, ctx, variable));
  return out;
}

function oneSheet(sheet: Sheet, ctx: EmitContext, variable: VariableOf): Stmt[] {
  const sheetVar = variable(sheet.name, 'sheet');
  const options: Prop[] = [];
  if (sheet.size !== 'A3') {
    options.push(['size', typeof sheet.size === 'string' ? str(sheet.size) : numbers(sheet.size)]);
  }
  if (sheet.orientation !== 'landscape') options.push(['orientation', str(sheet.orientation)]);
  if (sheet.scale[0] !== 1 || sheet.scale[1] !== 1) options.push(['scale', numbers(sheet.scale)]);
  if (sheet.projection !== 'first') options.push(['projection', str(sheet.projection)]);
  if (sheet.decimals !== 1) options.push(['decimals', num(sheet.decimals)]);
  if (!sheet.border) options.push(['border', bool(false)]);
  else if (sheet.border.zones) options.push(['border', str('zones')]);
  if (!sheet.titleBlock) options.push(['titleBlock', bool(false)]);
  else {
    if (sheet.titleBlock.template !== 'simple') {
      options.push(['titleBlock', str(sheet.titleBlock.template)]);
    }
    // Always: the API's own default fields are the new design's name and units.
    options.push([
      'fields',
      obj(Object.entries(sheet.titleBlock.fields).map(([k, v]): Prop => [k, str(v)])),
    ]);
  }
  const out: Stmt[] = [
    constant(sheetVar, call('design.addSheet', [str(sheet.name), ...opt(options)])),
  ];
  const viewOf = new Map<string, string>();
  for (const view of parentsFirst(sheet.views)) {
    const name = variable(view.name, 'view');
    viewOf.set(view.id, name);
    out.push(constant(name, viewExpr(view, sheetVar, viewOf, ctx)));
  }
  const listOf = new Map<string, string>();
  for (const item of listsFirst(sheet.items)) {
    const owner = 'view' in item ? (viewOf.get(item.view) ?? sheetVar) : sheetVar;
    const expression = itemExpr(item, owner, listOf, ctx);
    if (item.kind === 'partsList') {
      const name = variable('partsList', 'partsList');
      listOf.set(item.id, name);
      out.push(constant(name, expression));
    } else {
      out.push(statement(expression));
    }
  }
  return out;
}

/** An options object, or nothing when it would be empty. */
function opt(props: Prop[]): Expr[] {
  return props.length > 0 ? [obj(props)] : [];
}

/** The views in stored order, a projected one held back until its parent is written. */
function parentsFirst(views: readonly SheetView[]): SheetView[] {
  const done = new Set<string>();
  const out: SheetView[] = [];
  let waiting: SheetView[] = [];
  const ready = (v: SheetView) => v.from.kind === 'base' || done.has(v.from.parent);
  for (const view of views) {
    waiting.push(view);
    for (let moved = true; moved; ) {
      moved = false;
      for (const next of waiting) {
        if (!ready(next)) continue;
        out.push(next);
        done.add(next.id);
        moved = true;
      }
      waiting = waiting.filter((v) => !done.has(v.id));
    }
  }
  // A cycle the schema refuses: written as stored rather than dropped.
  return [...out, ...waiting];
}

/**
 * The items in stored order, unless a balloon comes before the parts list it
 * reads (the app never stores that): then the lists go first.
 */
function listsFirst(items: readonly SheetItem[]): SheetItem[] {
  const at = new Map(items.map((item, i) => [item.id as string, i]));
  const early = items.some((item, i) => item.kind === 'balloon' && (at.get(item.list) ?? -1) > i);
  if (!early) return [...items];
  return [
    ...items.filter((i) => i.kind === 'partsList'),
    ...items.filter((i) => i.kind !== 'partsList'),
  ];
}

function switches(view: SheetView): Prop[] {
  return [
    ...(view.tangentEdges === false ? ([['tangentEdges', bool(false)]] as Prop[]) : []),
    ...(view.centreLines === false ? ([['centreLines', bool(false)]] as Prop[]) : []),
    ...(view.label ? ([['label', bool(true)]] as Prop[]) : []),
  ];
}

function viewExpr(
  view: SheetView,
  sheetVar: string,
  viewOf: ReadonlyMap<string, string>,
  ctx: EmitContext,
): Expr {
  const { from } = view;
  if (from.kind === 'projected') {
    return call(`${viewOf.get(from.parent) ?? 'undefined'}.project`, [
      str(from.side),
      numbers(view.at),
      obj([['name', str(view.name)], ...switches(view)]),
    ]);
  }
  const standard = Object.entries(SHEET_STANDARD_VIEWS).find(
    ([, v]) =>
      v.direction.every((x, i) => x === from.direction[i]) &&
      v.up.every((x, i) => x === from.up[i]),
  )?.[0];
  const options: Prop[] = [['at', numbers(view.at)]];
  if (standard !== 'front') {
    options.push([
      'from',
      standard
        ? str(standard)
        : obj([
            ['direction', numbers(from.direction)],
            ['up', numbers(from.up)],
          ]),
    ]);
  }
  if (view.scale) options.push(['scale', numbers(view.scale)]);
  if (view.style) options.push(['style', str(view.style)]);
  if (view.bodies) options.push(['bodies', arr(view.bodies.map((id) => body(id, ctx)))]);
  options.push(...switches(view));
  return call(`${sheetVar}.addView`, [str(view.name), obj(options)]);
}

const body = (id: string, ctx: EmitContext): Expr => refExpr({ kind: 'body', id }, ctx);

/** An anchor as `SheetAnchorInput`: `{ ref, fingerprint, at? }`, `{ ref, fingerprint, silhouette }` or `[x, y]`. */
function anchorExpr(anchor: SheetAnchor, ctx: EmitContext): Expr {
  if ('free' in anchor) return numbers(anchor.free);
  const props: Prop[] = [
    ['ref', refExpr(anchor.ref, ctx)],
    ['fingerprint', fingerprintExpr(anchor.ref.fingerprint, ctx)],
  ];
  if ('silhouette' in anchor) props.push(['silhouette', num(anchor.silhouette)]);
  else if (anchor.at) props.push(['at', str(anchor.at)]);
  return obj(props);
}

function itemExpr(
  item: SheetItem,
  owner: string,
  listOf: ReadonlyMap<string, string>,
  ctx: EmitContext,
): Expr {
  const anchors = (list: readonly SheetAnchor[]) => arr(list.map((a) => anchorExpr(a, ctx)));
  switch (item.kind) {
    case 'text': {
      const options: Prop[] = [];
      if (item.size !== undefined) options.push(['size', num(item.size)]);
      if (item.width !== undefined) options.push(['width', num(item.width)]);
      return call(`${owner}.addText`, [str(item.text), numbers(item.at), ...opt(options)]);
    }
    case 'sticky': {
      const options: Prop[] = [['size', numbers(item.size)]];
      if (item.color) options.push(['color', str(item.color)]);
      if (item.print) options.push(['print', bool(true)]);
      return call(`${owner}.addSticky`, [str(item.text), numbers(item.at), obj(options)]);
    }
    case 'table':
      return call(`${owner}.addTable`, [
        numbers(item.at),
        arr(item.rows.map((row) => arr(row.map(str)))),
        obj([['columns', numbers(item.columns)]]),
      ]);
    case 'dimension': {
      const options: Prop[] = [];
      if (item.direction) options.push(['direction', str(item.direction)]);
      if (item.decimals !== undefined) options.push(['decimals', num(item.decimals)]);
      if (item.before !== undefined) options.push(['before', str(item.before)]);
      if (item.after !== undefined) options.push(['after', str(item.after)]);
      if (item.reference) options.push(['reference', bool(true)]);
      return call(`${owner}.addDimension`, [
        str(item.type),
        anchors(item.anchors),
        numbers(item.at),
        ...opt(options),
      ]);
    }
    case 'leader':
      return call(`${owner}.addLeader`, [
        anchorExpr(item.anchor, ctx),
        numbers(item.at),
        str(item.text),
      ]);
    case 'centreMark':
      // One circle: what `sheetItemProblems` lets a centre mark have.
      return call(`${owner}.addCentreMark`, [anchorExpr(item.anchors[0] as SheetAnchor, ctx)]);
    case 'centreLine':
      return call(`${owner}.addCentreLine`, [anchors(item.anchors)]);
    case 'partsList': {
      const options: Prop[] = [];
      if (item.columns) options.push(['columns', arr(item.columns.map(str))]);
      if (item.rows) {
        options.push([
          'rows',
          arr(
            Object.entries(item.rows).map(([id, row]) =>
              obj([
                ['body', body(id, ctx)],
                ...(row.name !== undefined ? ([['name', str(row.name)]] as Prop[]) : []),
                ...(row.material !== undefined
                  ? ([['material', str(row.material)]] as Prop[])
                  : []),
              ]),
            ),
          ),
        ]);
      }
      return call(`${owner}.addPartsList`, [numbers(item.at), ...opt(options)]);
    }
    case 'balloon':
      return call(`${owner}.addBalloon`, [
        anchorExpr(item.anchor, ctx),
        numbers(item.at),
        raw(listOf.get(item.list) ?? 'undefined'),
      ]);
  }
}
