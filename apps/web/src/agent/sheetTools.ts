/**
 * The sheet tools (P6-24 S6, ADR-0143's amendment "S6, the agent tools"): what an agent
 * may do with the design's drawing sheets, over the same `AgentHost` as the model's tools.
 *
 * - **Every change is one undo transaction `Agent: <what>`** (`change`), and it is built by
 *   `@extrudo/api`'s sheet calls on a scratch `Design.from(document)` with the app's IDs,
 *   then dispatched as the same core command: the API checks it, the document takes it.
 * - **Anchors on the model carry their fingerprint**, from the kernel's `reference` of the
 *   name the agent gave (a face, an edge, `edgeBetween` two faces or a vertex), in the
 *   view's bodies, before the API is called; never an index.
 * - **A dimension or a leader note is measured before it goes in**: one whose anchors are
 *   lost or measure nothing is refused and nothing changes; `add_dimension` answers the
 *   value, so an agent can check its model's sizes.
 * - **`export_sheet` is the shared export**: the kernel's `sheetModelNow` (every view drawn
 *   exactly, anchors and parts lists read now), then `@extrudo/sheets`' `sheetFiles`, with
 *   the fields the app's Export drawing fills (today, the newest version, the filament).
 *   A PNG is that SVG drawn onto a canvas through a `blob:` image (`sheetSvgSnapshot`).
 * - **The mode is left as it is**: the sheet tools work whether or not the drawing is open
 *   and never open or close it (the person sees a change on the sheet they have open).
 *
 * `@extrudo/sheets` and `standardViews` load lazily here, as in the app, so they stay out
 * of the entry chunk.
 */
import {
  Design,
  edgeName,
  type SheetAnchorInput,
  type SheetViewFromInput,
  type StandardViewPlaces,
} from '@extrudo/api';
import {
  addSheet,
  addSheetItem,
  addSheetView,
  type BodyId,
  CommandError,
  type ExtrudoDocument,
  type GeomRef,
  newId,
  SHEET_STANDARD_VIEWS,
  type Sheet,
  type SheetAnchors,
  type SheetItem,
  type SheetItemId,
  type SheetParts,
  type SheetScale,
  type SheetStandardView,
  type SheetView,
  sheetPaperSize,
  sheetViewFrame,
} from '@extrudo/core';
import { isAnchored, sheetModelNow, shownBodies } from '@extrudo/kernel';
import type { AgentContent, AgentReply } from '../platform/agent';
import { isoDate, nextSheetName, SHEET_DEFAULTS, sheetNameProblem } from '../sheets/defaults';
import { ensureUiFonts } from '../sketch/fonts';
import { type AgentContext, change, failure, json, liveBodies, resolveBodyRefs } from './change';
import { type AgentHost, type AgentSheetKernel, settled } from './host';
import type { ToolInput } from './schemas';

export const NO_SHEET_KERNEL = "The geometry kernel isn't ready yet: try again in a moment.";
const NOT_COMPUTED = "The model isn't computed: check get_design's problems first.";
/** The most sheets one PNG export answers (each is a picture). */
const MOST_PICTURES = 4;

const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0;
const round3s = (v: readonly number[]) => v.map(round3);
const scaleText = ([a, b]: SheetScale) => `${a}:${b}`;

/** '1:2' as a stored scale. */
function scaleOf(text: string): SheetScale {
  const [a, b] = text.split(':').map((part) => Number(part.trim()));
  return [a as number, b as number];
}

/** The sheet named `name` (or with that ID), or a refusal that says where names come from. */
function sheetOf(doc: ExtrudoDocument, name: string, path = 'sheet'): Sheet {
  const sheets = doc.sheets ?? [];
  const found =
    sheets.find((s) => s.id === name) ??
    sheets.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!found) {
    throw new CommandError(`${path}: There is no sheet "${name}": list_sheets lists them.`);
  }
  return found;
}

/** The view named `name` (or with that ID) on `sheet`. */
function viewOf(sheet: Sheet, name: string, path = 'view'): SheetView {
  const found =
    sheet.views.find((v) => v.id === name) ??
    sheet.views.find((v) => v.name.toLowerCase() === name.toLowerCase());
  if (!found) {
    throw new CommandError(
      `${path}: ${sheet.name} has no view "${name}": list_sheets lists its views.`,
    );
  }
  return found;
}

/** A design to build on with the API: the document as it is, the app's IDs. */
const scratch = (host: AgentHost) =>
  Design.from(host.store.getState().doc, { ids: () => newId<SheetItemId>() });

/** The sheet open in the app now, while the drawing is. */
function openSheet(host: AgentHost): Sheet | undefined {
  const { mode, activeSheetId } = host.session.getState();
  if (mode !== 'sheet') return undefined;
  return (host.store.getState().doc.sheets ?? []).find((s) => s.id === activeSheetId);
}

/** The kernel, or a refusal. */
function kernelOf(host: AgentHost): AgentSheetKernel {
  const kernel = host.sheetKernel();
  if (!kernel) throw new CommandError(NO_SHEET_KERNEL);
  return kernel;
}

/** Body references as body IDs, checked against the bodies the model has now (#84). */
function bodyIds(
  host: AgentHost,
  bodies: readonly string[] | undefined,
  path = 'bodies',
): BodyId[] | undefined {
  if (!bodies) return undefined;
  const live = liveBodies(host);
  const refs = bodies.map((id) => ({ kind: 'body', id }));
  const checked = live
    ? (
        resolveBodyRefs({ [path]: refs }, live, host.store.getState().doc) as Record<
          string,
          GeomRef[]
        >
      )[path]
    : refs;
  return (checked ?? []).map((ref) => ref.id as BodyId);
}

/** The base view `view` is drawn from: itself, or its projected parents' base. */
function baseOf(sheet: Sheet, view: SheetView): SheetView | undefined {
  const seen = new Set<string>();
  let at: SheetView | undefined = view;
  while (at && at.from.kind === 'projected' && !seen.has(at.id)) {
    seen.add(at.id);
    const parent: string = at.from.parent;
    at = sheet.views.find((v) => v.id === parent);
  }
  return at && at.from.kind !== 'projected' ? at : undefined;
}

/** The bodies a view draws now: its base view's own, else every shown body at the marker. */
function viewBodies(host: AgentHost, sheet: Sheet, view: SheetView): BodyId[] {
  const { doc } = host.store.getState();
  const live = Object.keys(host.model.getState().bodies) as BodyId[];
  const own = baseOf(sheet, view)?.bodies;
  return own ? own.filter((b) => live.includes(b)) : shownBodies(doc, live);
}

type AgentSheetAnchor = ToolInput<'add_dimension'>['anchors'][number];

/**
 * An agent's anchor as the API takes it: a name found in one of the view's bodies through
 * the kernel's `reference`, which gives it with its fingerprint, or a free point. A name in
 * none of them is refused with its input path.
 */
async function anchorInput(
  host: AgentHost,
  kernel: AgentSheetKernel,
  sheet: Sheet,
  view: SheetView,
  anchor: AgentSheetAnchor,
  path: string,
): Promise<SheetAnchorInput> {
  if ('free' in anchor) return { free: anchor.free };
  const [key, kind, name] =
    'edgeBetween' in anchor
      ? (['edgeBetween', 'edge', edgeName(anchor.edgeBetween)] as const)
      : 'edge' in anchor
        ? (['edge', 'edge', anchor.edge] as const)
        : 'face' in anchor
          ? (['face', 'face', anchor.face] as const)
          : (['vertex', 'vertex', anchor.vertex] as const);
  const candidates = anchor.body
    ? (bodyIds(host, [anchor.body], `${path}.body`) ?? [])
    : viewBodies(host, sheet, view);
  let found: GeomRef | undefined;
  for (const body of candidates) {
    const ref = await kernel.reference(body, kind, name);
    if (ref?.fingerprint && ref.kind === kind) {
      found = ref;
      break;
    }
  }
  if (!found) {
    const named = 'edgeBetween' in anchor ? anchor.edgeBetween.join(' and ') : `"${name}"`;
    const what = key === 'edgeBetween' ? 'edge between' : kind;
    throw new CommandError(
      `${[path, key].join('.')}: There is no ${what} ${named} in the bodies ${view.name} draws: get_feature and the API reference name faces, and an edge is edgeBetween two of them.`,
    );
  }
  const ref = found;
  if ('silhouette' in anchor && anchor.silhouette !== undefined) {
    return { ref, silhouette: anchor.silhouette };
  }
  if ('at' in anchor && anchor.at !== undefined) return { ref, at: anchor.at };
  return ref;
}

// --- Reading ---------------------------------------------------------------------------

/** A base view's `from` as an agent reads it: a standard name, or its direction and up. */
function fromOf(sheet: Sheet, view: SheetView) {
  if (view.from.kind === 'projected') {
    const parent = view.from.parent;
    return {
      parent: sheet.views.find((v) => v.id === parent)?.name ?? parent,
      side: view.from.side,
    };
  }
  const { direction, up } = view.from;
  const same = (a: readonly number[], b: readonly number[]) =>
    a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 1e-9);
  const standard = (Object.keys(SHEET_STANDARD_VIEWS) as SheetStandardView[]).find(
    (name) =>
      same(direction, SHEET_STANDARD_VIEWS[name].direction) &&
      same(up, SHEET_STANDARD_VIEWS[name].up),
  );
  return standard ?? { direction: round3s(direction), up: round3s(up) };
}

type Sheets = typeof import('@extrudo/sheets');

/** What the kernel says of `sheet`'s items now: undefined while it can't say. */
interface SheetMeasures {
  anchors: SheetAnchors | undefined;
  parts: SheetParts | undefined;
}

async function measuresOf(
  kernel: AgentSheetKernel | undefined,
  sheet: Sheet,
): Promise<SheetMeasures> {
  if (!kernel) return { anchors: undefined, parts: undefined };
  const anchors = sheet.items.some(isAnchored)
    ? await kernel.resolveSheet(sheet, { quiet: true })
    : {};
  const parts = sheet.items.some((i) => i.kind === 'partsList')
    ? await kernel.sheetParts(sheet, { quiet: true })
    : { lists: {}, bodies: {} };
  return { anchors, parts };
}

/** An item as list_sheets answers it: its kind, what it says, and its state now. */
function readableItem(
  sheets: Sheets,
  doc: ExtrudoDocument,
  sheet: Sheet,
  item: SheetItem,
  measures: SheetMeasures,
) {
  const view =
    'view' in item ? (sheet.views.find((v) => v.id === item.view)?.name ?? item.view) : undefined;
  const base = { id: item.id, kind: item.kind, ...(view !== undefined && { view }) };
  const units = doc.settings.units;
  const pending = measures.anchors === undefined && isAnchored(item);
  if (item.kind === 'dimension') {
    const measured = sheets.measureSheetDimension(sheet, item, measures.anchors, { units });
    return {
      ...base,
      type: item.type,
      ...(measured.value !== undefined && !pending && { value: round3(measured.value) }),
      text: measured.text,
      state: pending ? 'pending' : measured.state,
      ...(measured.message && !pending && { message: measured.message }),
    };
  }
  const status = sheets.sheetItemStatus(sheet, item, measures.anchors, {
    units,
    ...(measures.parts && { parts: sheets.sheetPartBodies(doc, measures.parts) }),
  });
  const said =
    item.kind === 'text' || item.kind === 'leader'
      ? { text: item.text }
      : item.kind === 'sticky'
        ? { text: item.text, print: item.print ?? false }
        : item.kind === 'table'
          ? { rows: item.rows.length }
          : {};
  return {
    ...base,
    ...said,
    state: pending ? 'pending' : status.state,
    ...(status.message && !pending && { message: status.message }),
  };
}

/** A sheet as list_sheets answers it. */
function readableSheet(sheets: Sheets, host: AgentHost, sheet: Sheet, measures: SheetMeasures) {
  const { doc } = host.store.getState();
  const paper = sheetPaperSize(sheet);
  return {
    id: sheet.id,
    name: sheet.name,
    paper: {
      size: sheet.size,
      orientation: sheet.orientation,
      width: round3(paper.width),
      height: round3(paper.height),
    },
    scale: scaleText(sheet.scale),
    projection: sheet.projection,
    decimals: sheet.decimals,
    ...(sheet.titleBlock && { titleBlock: sheet.titleBlock }),
    views: sheet.views.map((view) => {
      const frame = sheetViewFrame(sheet, view.id);
      return {
        id: view.id,
        name: view.name,
        at: round3s(view.at),
        from: fromOf(sheet, view),
        scale: scaleText(sheets.sheetViewScale(sheet, view)),
        ...(frame && { right: round3s(frame.right), up: round3s(frame.up) }),
        ...(view.bodies && { bodies: view.bodies }),
      };
    }),
    items: sheet.items.map((item) => readableItem(sheets, doc, sheet, item, measures)),
  };
}

// --- The tools -------------------------------------------------------------------------

type SheetToolName =
  | 'list_sheets'
  | 'add_sheet'
  | 'add_view'
  | 'add_dimension'
  | 'add_note'
  | 'export_sheet';

type Handler<T extends SheetToolName> = (
  input: ToolInput<T>,
  ctx: AgentContext,
  host: AgentHost,
) => Promise<AgentReply>;

export const SHEET_HANDLERS: { [T in SheetToolName]: Handler<T> } = {
  list_sheets: async (_input, ctx, h) => {
    await settled(h, ctx.settleMs);
    const sheets = await import('@extrudo/sheets');
    const kernel = h.sheetKernel();
    const { doc } = h.store.getState();
    const answer = [];
    for (const sheet of doc.sheets ?? []) {
      answer.push(readableSheet(sheets, h, sheet, await measuresOf(kernel, sheet)));
    }
    const open = openSheet(h);
    return json({ open: open?.name ?? null, sheets: answer });
  },

  add_sheet: async (input, ctx, h) => {
    const { doc } = h.store.getState();
    const name = input.name ?? nextSheetName(doc.sheets ?? []);
    const problem = sheetNameProblem(doc.sheets ?? [], undefined, name);
    if (problem) return failure(`name: ${problem}`);
    const size = input.size ?? SHEET_DEFAULTS.size;
    const orientation = input.orientation ?? SHEET_DEFAULTS.orientation;
    const projection = input.projection ?? SHEET_DEFAULTS.projection;
    const titleBlock = input.titleBlock ?? SHEET_DEFAULTS.titleBlock;
    const bodies = bodyIds(h, input.bodies);
    let scale = input.scale ? scaleOf(input.scale) : undefined;
    let at: StandardViewPlaces | undefined;
    if (input.start === 'standard') {
      // Fitted as New drawing fits it: the views measured from the model, then laid out.
      const kernel = kernelOf(h);
      await settled(h, ctx.settleMs);
      const live = liveBodies(h);
      if (!live) return failure(NOT_COMPUTED);
      const { planSheetStart } = await import('../sheets/standardViews');
      const plan = await planSheetStart(kernel, doc, [...live] as BodyId[], 'standard', {
        size,
        orientation,
        titleBlock,
        projection,
        ...(bodies && { bodies }),
        ...(scale && { scale }),
      });
      if (!plan) {
        return failure(
          "There is nothing to draw: no body is shown at the timeline marker (get_bodies), or its views couldn't be measured. start: 'empty' makes a sheet without views.",
        );
      }
      // planSheetStart's views: Front, then Top, the side and Isometric projected from it.
      const [front, top, side, iso] = plan.views.map((v) => v.at);
      scale = plan.scale;
      at = {
        ...(front && { front }),
        ...(top && { top }),
        ...(side && { side }),
        ...(iso && { iso }),
      };
    }
    const sheet = scratch(h).addSheet(name, {
      id: newId<SheetItemId>(),
      size,
      orientation,
      projection,
      ...(scale && { scale }),
      titleBlock: titleBlock === 'none' ? false : titleBlock,
      ...(input.fields && { fields: input.fields }),
      start: input.start,
      ...(bodies && { bodies }),
      ...(at && { at }),
    }).sheet as Sheet;
    return change(
      ctx,
      h,
      `Add sheet ${name}`,
      () => {
        h.store.getState().dispatch(addSheet({ sheet }));
        return undefined;
      },
      async () => {
        const sheets = await import('@extrudo/sheets');
        return readableSheet(sheets, h, sheet, { anchors: {}, parts: { lists: {}, bodies: {} } });
      },
    );
  },

  add_view: async (input, ctx, h) => {
    const { doc } = h.store.getState();
    const sheet = sheetOf(doc, input.sheet);
    const d = scratch(h);
    const handle = d.sheet(sheet.id);
    if (!handle) throw new CommandError(`sheet: There is no sheet "${input.sheet}".`);
    let view: SheetView | undefined;
    if (input.parent !== undefined) {
      const given = (['from', 'scale', 'style', 'bodies'] as const).find(
        (k) => input[k] !== undefined,
      );
      if (given) {
        return failure(
          `${given}: a projected view takes its direction, scale, style and bodies from its parent; give them to the base view.`,
        );
      }
      if (!input.side)
        return failure(
          "side: a projected view needs the side of its parent it sits on ('below', 'right', 'iso-above-right', …).",
        );
      const parent = viewOf(sheet, input.parent, 'parent');
      view = handle.view(parent.id)?.project(input.side, input.at, {
        id: newId<SheetItemId>(),
        ...(input.name && { name: input.name }),
      }).view;
    } else {
      if (input.side) return failure('side: give the parent view a projected view is made from.');
      const from = input.from ?? 'front';
      const named =
        input.name ??
        (typeof from === 'string' ? from.charAt(0).toUpperCase() + from.slice(1) : 'View');
      const bodies = bodyIds(h, input.bodies);
      view = handle.addView(freeName(sheet, named, input.name !== undefined), {
        id: newId<SheetItemId>(),
        at: input.at,
        from: from as SheetViewFromInput,
        ...(input.scale && { scale: scaleOf(input.scale) }),
        ...(input.style && { style: input.style }),
        ...(bodies && { bodies }),
      }).view;
    }
    if (!view) throw new CommandError("The view couldn't be made.");
    const made = view;
    return change(ctx, h, `Add view ${made.name}`, () => {
      h.store.getState().dispatch(addSheetView({ sheet: sheet.id, view: made }));
      return { id: made.id, name: made.name, sheet: sheet.name };
    });
  },

  add_dimension: async (input, ctx, h) => {
    const kernel = kernelOf(h);
    await settled(h, ctx.settleMs);
    if (!liveBodies(h)) return failure(NOT_COMPUTED);
    const { doc } = h.store.getState();
    const sheet = sheetOf(doc, input.sheet);
    const view = viewOf(sheet, input.view);
    const anchors: SheetAnchorInput[] = [];
    for (const [i, anchor] of input.anchors.entries()) {
      anchors.push(await anchorInput(h, kernel, sheet, view, anchor, `anchors.${i}`));
    }
    const d = scratch(h);
    const item = d
      .sheet(sheet.id)
      ?.view(view.id)
      ?.addDimension(input.type, anchors, input.at, {
        id: newId<SheetItemId>(),
        ...(input.direction && { direction: input.direction }),
        ...(input.decimals !== undefined && { decimals: input.decimals }),
        ...(input.before !== undefined && { before: input.before }),
        ...(input.after !== undefined && { after: input.after }),
      }).item;
    const probe = d.sheet(sheet.id)?.sheet;
    if (item?.kind !== 'dimension' || !probe) {
      throw new CommandError("The dimension couldn't be made.");
    }
    // Measured before it goes in: anchors that are lost or measure nothing change nothing.
    const reports = await kernel.resolveSheet(probe, { quiet: true });
    if (!reports) return failure(NOT_COMPUTED);
    const sheets = await import('@extrudo/sheets');
    const units = doc.settings.units;
    const measured = sheets.measureSheetDimension(probe, item, reports, { units });
    if (measured.state === 'detached' || measured.state === 'invalid') {
      return failure(
        `anchors: ${measured.message ?? `It measures nothing as a ${input.type} dimension.`}`,
      );
    }
    return change(ctx, h, `Dimension ${measured.text}`, () => {
      h.store.getState().dispatch(addSheetItem({ sheet: sheet.id, item }));
      return {
        id: item.id,
        ...(measured.value !== undefined && { value: round3(measured.value) }),
        text: measured.text,
        state: measured.state,
        ...(measured.message && { message: measured.message }),
      };
    });
  },

  add_note: async (input, ctx, h) => {
    const { doc } = h.store.getState();
    const sheet = sheetOf(doc, input.sheet);
    const d = scratch(h);
    let item: SheetItem | undefined;
    if (input.view !== undefined || input.anchor !== undefined) {
      if (input.view === undefined)
        return failure('view: a leader note needs the view it points into.');
      if (!input.anchor) return failure('anchor: a leader note needs what its arrow points at.');
      if (input.size !== undefined)
        return failure("size: a leader note's text has the sheet's size.");
      const kernel = kernelOf(h);
      await settled(h, ctx.settleMs);
      if (!liveBodies(h)) return failure(NOT_COMPUTED);
      const view = viewOf(sheet, input.view);
      const anchor = await anchorInput(h, kernel, sheet, view, input.anchor, 'anchor');
      item = d.sheet(sheet.id)?.view(view.id)?.addLeader(anchor, input.at, input.text, {
        id: newId<SheetItemId>(),
      }).item;
      const probe = d.sheet(sheet.id)?.sheet;
      if (!item || !probe) throw new CommandError("The note couldn't be made.");
      const reports = await kernel.resolveSheet(probe, { quiet: true });
      if (!reports) return failure(NOT_COMPUTED);
      const sheets = await import('@extrudo/sheets');
      const status = sheets.sheetItemStatus(probe, item, reports, { units: doc.settings.units });
      if (status.state === 'detached' || status.state === 'invalid') {
        return failure(`anchor: ${status.message ?? 'It points at nothing in the view.'}`);
      }
    } else {
      item = d.sheet(sheet.id)?.addText(input.text, input.at, {
        id: newId<SheetItemId>(),
        ...(input.size !== undefined && { size: input.size }),
      }).item;
    }
    if (!item) throw new CommandError("The note couldn't be made.");
    const made = item;
    return change(ctx, h, `Add note on ${sheet.name}`, () => {
      h.store.getState().dispatch(addSheetItem({ sheet: sheet.id, item: made }));
      return { id: made.id, kind: made.kind };
    });
  },

  export_sheet: async (input, ctx, h) => {
    const kernel = kernelOf(h);
    await ctx.exportTurn();
    await settled(h, ctx.settleMs);
    const { doc } = h.store.getState();
    const all = doc.sheets ?? [];
    if (all.length === 0) return failure('The design has no sheet: add_sheet makes one.');
    const chosen = input.sheets
      ? [...new Set(input.sheets.map((name, i) => sheetOf(doc, name, `sheets.${i}`)))]
      : input.format === 'png'
        ? [openSheet(h) ?? (all[0] as Sheet)]
        : all;
    // Page order is the design's.
    const ordered = all.filter((s) => chosen.includes(s));
    if (input.format === 'png' && ordered.length > MOST_PICTURES) {
      return failure(`sheets: at most ${MOST_PICTURES} pictures at a time.`);
    }
    const bodies = Object.keys(h.model.getState().bodies) as BodyId[];
    const model = await sheetModelNow(kernel, doc, ordered, bodies);
    const sheets = await import('@extrudo/sheets');
    await ensureUiFonts(sheets.SHEET_FONTS);
    const extras = await h.sheetFields();
    const options = {
      sheets: ordered.map((s) => s.id),
      date: isoDate(new Date()),
      ...(extras.version !== undefined && { version: extras.version }),
      ...(extras.density !== undefined && { density: extras.density }),
      ...(input.stickies && { stickies: true }),
    };
    // What the file can't show as the screen does: lost anchors, views not drawn, notes left out.
    const notes: string[] = [];
    for (const sheet of ordered) {
      const measures = { anchors: model.anchors, parts: model.parts };
      const lost = sheet.items
        .map((item) => readableItem(sheets, doc, sheet, item, measures))
        .filter((item) => item.state === 'detached');
      if (lost.length > 0) {
        notes.push(
          `${sheet.name}: ${lost.length} detached (written with ?): ${lost.map((i) => i.id).join(', ')}`,
        );
      }
      for (const view of sheet.views) {
        const error = model.errors.get(view.id);
        if (error) notes.push(`${sheet.name}: ${view.name} couldn't be drawn: ${error}`);
      }
    }
    const leftOut = input.stickies ? 0 : sheets.sheetStickiesLeftOut(ordered);
    if (leftOut > 0) {
      notes.push(`${leftOut} sticky ${leftOut === 1 ? 'note' : 'notes'} on screen only left out`);
    }
    const said = notes.length > 0 ? `\n${notes.join('\n')}` : '';
    if (input.format === 'pdf') {
      const written = sheets.sheetFiles(doc, model, { format: 'pdf', ...options });
      if (written.format !== 'pdf') throw new Error('Expected a PDF.');
      const pages = ordered.length;
      const one = pages === 1 && all.length > 1 ? ordered[0] : undefined;
      const design = one ? `${doc.name} - ${one.name}` : doc.name;
      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Exported ${pages} ${pages === 1 ? 'page' : 'pages'} of ${doc.name} as PDF.${said}`,
            },
          ],
        },
        file: { design, format: 'pdf', bytes: written.pdf },
      };
    }
    const written = sheets.sheetFiles(doc, model, { format: 'svg', ...options });
    if (written.format !== 'svg') throw new Error('Expected SVGs.');
    const content: AgentContent[] = [];
    for (const [i, sheet] of ordered.entries()) {
      const png = await h.sheetPng(
        written.svgs[i] ?? '',
        sheetPaperSize(sheet),
        input.size ?? 1600,
      );
      if (!png) return failure(`${sheet.name} couldn't be drawn as a picture.`);
      content.push({ type: 'text', text: `${sheet.name}:` });
      content.push({ type: 'image', data: await base64(png), mimeType: 'image/png' });
    }
    content.push({
      type: 'text',
      text: `Every view drawn from the model now; values as list_sheets gives them.${said}`,
    });
    return { result: { content } };
  },
};

/** `name`, or the first of "name 2", "name 3", … no view of `sheet` has (unless `kept`). */
function freeName(sheet: Sheet, name: string, kept: boolean): string {
  const taken = new Set(sheet.views.map((v) => v.name.toLowerCase()));
  if (kept || !taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const next = `${name} ${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}

/** A PNG's bytes as base64, as MCP's image content carries them. */
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
