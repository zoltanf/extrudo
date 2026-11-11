/**
 * New drawing's "Start with" (P6-24 S2, plan §4.5, mock-up 2): Standard views (front, top,
 * the side and an isometric, laid out for the sheet's projection angle at the largest
 * standard scale that fits), One view (the sheet's scale fitted to the front view; Base View
 * then places it) or Empty sheet. Loaded lazily (it holds `@extrudo/sheets` for the title
 * block's size); `standardLayout` and `fitScale` are pure.
 *
 * The four views are one base view (Front) and three views projected from it, so they stay
 * lined up when moved or rescaled; the top view shares the front's `at.x`, the side view its
 * `at.y`, exactly. Sizes come from the exact lines (the quick ones' bounds can hold stray
 * pieces), computed before Create.
 */
import {
  type BodyId,
  type ExtrudoDocument,
  newId,
  type Sheet,
  type SheetScale,
  type SheetView,
  type SheetViewFrame,
  type SheetViewId,
  type SheetViewSide,
  sheetBaseFrame,
  sheetPaperSize,
  sheetProjectedFrame,
  sheetStandardFrom,
} from '@extrudo/core';
import { shownBodies } from '@extrudo/kernel';
import { SHEET_TITLE_BLOCKS, sheetMargin } from '@extrudo/sheets';
import type { SheetTitleChoice } from './defaults';
import { sheetViewWant } from './viewLines';
import { type SheetViewsKernel, sheetViewRunner } from './viewRunner';
import { fitScale, placedAt, projectedName, SCALES_DOWN } from './views';

export type SheetStart = 'standard' | 'one' | 'empty';
export type StandardRole = 'front' | 'top' | 'side' | 'iso';

/** A view's extent in its own frame (mm at model size, y up). */
export interface ViewBox {
  min: readonly number[];
  max: readonly number[];
}

/** The room the views are laid out in, sheet mm from the top-left. */
export interface SheetRoom {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Between two views, sheet mm (whatever the scale). */
export const VIEW_GAP = 20;
/** Kept clear inside the border, mm. */
const PAD = 10;

/** The sides the standard views sit on from the front: top, side, isometric. */
export function standardSides(
  projection: Sheet['projection'],
): Record<Exclude<StandardRole, 'front'>, SheetViewSide> {
  return { top: projection === 'first' ? 'below' : 'above', side: 'right', iso: 'iso-above-right' };
}

/** The four frames: the standard front and the views projected from it. */
export function standardFrames(
  projection: Sheet['projection'],
): Record<StandardRole, SheetViewFrame> {
  const { direction, up } = sheetStandardFrom('front');
  const front = sheetBaseFrame(direction, up);
  const sides = standardSides(projection);
  return {
    front,
    top: sheetProjectedFrame(front, projection, sides.top),
    side: sheetProjectedFrame(front, projection, sides.side),
    iso: sheetProjectedFrame(front, projection, sides.iso),
  };
}

/** Inside the border, clear of it, above the title block. */
export function sheetRoom(
  sheet: Pick<Sheet, 'size' | 'orientation'>,
  titleBlock: SheetTitleChoice,
): SheetRoom {
  const { width, height } = sheetPaperSize(sheet);
  const m = sheetMargin(sheet) + PAD;
  const block = titleBlock === 'none' ? 0 : SHEET_TITLE_BLOCKS[titleBlock].height + 5;
  return { x: m, y: m, width: width - 2 * m, height: height - 2 * m - block };
}

const size = (b: ViewBox): [number, number] => [
  (b.max[0] ?? 0) - (b.min[0] ?? 0),
  (b.max[1] ?? 0) - (b.min[1] ?? 0),
];

/**
 * The four views in a 2 × 2 grid at `scale` (the largest standard one that fits when
 * absent, enlarging ones included): the front with the side view beside it, the top view in
 * the front's column (below it in first angle, above it in third) and the isometric in the
 * corner left free, diagonal from the front (mock-up 2's picture). The grid is centred in
 * `room`. Returns the scale, the fitted one and each view's `at`.
 */
export function standardLayout(
  room: SheetRoom,
  boxes: Record<StandardRole, ViewBox>,
  projection: Sheet['projection'],
  scale?: SheetScale,
): { scale: SheetScale; fit: SheetScale; at: Record<StandardRole, [number, number]> } {
  const [wF, hF] = size(boxes.front);
  const [wT, hT] = size(boxes.top);
  const [wS, hS] = size(boxes.side);
  const [wI, hI] = size(boxes.iso);
  // Columns: front and top; side and isometric. Rows: front and side; top and isometric.
  const c1 = Math.max(wF, wT);
  const c2 = Math.max(wS, wI);
  const r1 = Math.max(hF, hS);
  const r2 = Math.max(hT, hI);
  const fits = SCALES_DOWN.find(([a, b]) => {
    const k = a / b;
    return k * (c1 + c2) + VIEW_GAP <= room.width && k * (r1 + r2) + VIEW_GAP <= room.height;
  });
  const fit = [...(fits ?? (SCALES_DOWN.at(-1) as SheetScale))] as SheetScale;
  const chosen = scale ?? fit;
  const k = chosen[0] / chosen[1];
  const x0 = room.x + (room.width - (k * (c1 + c2) + VIEW_GAP)) / 2;
  const y0 = room.y + (room.height - (k * (r1 + r2) + VIEW_GAP)) / 2;
  const firstY = projection === 'first' ? y0 : y0 + k * r2 + VIEW_GAP;
  const secondY = projection === 'first' ? y0 + k * r1 + VIEW_GAP : y0;
  const left = x0 + (k * c1) / 2;
  const right = x0 + k * c1 + VIEW_GAP + (k * c2) / 2;
  const front = placedAt([left, firstY + (k * r1) / 2], boxes.front, k);
  const side = placedAt([right, firstY + (k * r1) / 2], boxes.side, k);
  const top = placedAt([left, secondY + (k * r2) / 2], boxes.top, k);
  const iso = placedAt([right, secondY + (k * r2) / 2], boxes.iso, k);
  return {
    scale: chosen,
    fit,
    at: {
      front,
      // Exactly on the front's lines.
      side: [side[0], front[1]],
      top: [front[0], top[1]],
      iso,
    },
  };
}

/** What New drawing makes: the sheet's scale, the fitted one it offers, and the views. */
export interface SheetStartPlan {
  scale: SheetScale;
  fit: SheetScale;
  views: SheetView[];
}

/** New drawing's choices that the views depend on. */
export interface SheetStartRequest {
  size: Sheet['size'];
  orientation: Sheet['orientation'];
  titleBlock: SheetTitleChoice;
  projection: Sheet['projection'];
  /** Absent: every shown body. */
  bodies?: BodyId[];
  /** Absent: the largest standard scale that fits. */
  scale?: SheetScale;
}

/**
 * The plan for `start`: measures the views' quick lines through the project's view runner
 * and lays them out. `undefined` when there is nothing to draw (no shown body, the model
 * still being computed) or for an empty sheet.
 */
export async function planSheetStart(
  kernel: SheetViewsKernel,
  doc: ExtrudoDocument,
  modelBodies: readonly BodyId[],
  start: SheetStart,
  request: SheetStartRequest,
): Promise<SheetStartPlan | undefined> {
  if (start === 'empty') return undefined;
  const bodies = request.bodies ?? shownBodies(doc, modelBodies);
  if (bodies.length === 0) return undefined;
  const runner = sheetViewRunner(kernel);
  const frames = standardFrames(request.projection);
  const roles: StandardRole[] = start === 'one' ? ['front'] : ['front', 'top', 'side', 'iso'];
  const boxes: Partial<Record<StandardRole, ViewBox>> = {};
  for (const role of roles) {
    // Exact: the quick lines' bounds can be off (stray pieces of the polygonal run).
    const lines = await runner.peek(sheetViewWant(`new-${role}`, frames[role], bodies), true);
    if (!lines?.bounds) return undefined;
    boxes[role] = lines.bounds;
  }
  const room = sheetRoom(request, request.titleBlock);
  if (start === 'one') {
    const [w, h] = size(boxes.front as ViewBox);
    const fit = fitScale(w, h, room.width, room.height);
    return { scale: request.scale ?? fit, fit, views: [] };
  }
  const layout = standardLayout(
    room,
    boxes as Record<StandardRole, ViewBox>,
    request.projection,
    request.scale,
  );
  const sides = standardSides(request.projection);
  const front = newId<SheetViewId>();
  const projected = (role: Exclude<StandardRole, 'front'>): SheetView => ({
    id: newId<SheetViewId>(),
    name: projectedName(sides[role], frames[role].direction),
    at: layout.at[role],
    from: { kind: 'projected', parent: front, side: sides[role] },
  });
  return {
    scale: layout.scale,
    fit: layout.fit,
    views: [
      {
        id: front,
        name: 'Front',
        at: layout.at.front,
        from: sheetStandardFrom('front'),
        ...(request.bodies && { bodies: request.bodies }),
      },
      projected('top'),
      projected('side'),
      projected('iso'),
    ],
  };
}
