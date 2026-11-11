/**
 * Where the sheet lies on screen (P6-24, ADR-0143): pure pan and zoom math for
 * `SheetCanvas`, which writes the result straight to the paper's element, so moving the
 * sheet never renders React (ADR-0102).
 *
 * A view is the paper's top-left corner on screen (`x`, `y`, px from the canvas's
 * top-left) and its `scale` in px per sheet mm. 100 % is the true size on a 96 dpi screen.
 */

export interface SheetView {
  x: number;
  y: number;
  /** px per sheet mm. */
  scale: number;
}

/** The free room round the sheet's sides, px: the browser on the left, the card on the right. */
export interface SheetInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** px per mm at 100 %: CSS's 96 px to the inch. */
export const TRUE_SIZE = 96 / 25.4;

/** The zoom's range, as a share of the true size: 5 % to 800 %. */
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;

/** The space `fitSheet` leaves between the paper and the free room's edges, px. */
const FIT_MARGIN = 28;

const clampScale = (scale: number) =>
  Math.min(Math.max(scale, ZOOM_MIN * TRUE_SIZE), ZOOM_MAX * TRUE_SIZE);

/** The view that shows the whole paper, centred in the free room of a `width` × `height` canvas. */
export function fitSheet(
  paper: { width: number; height: number },
  canvas: { width: number; height: number },
  insets: SheetInsets,
): SheetView {
  const roomW = Math.max(canvas.width - insets.left - insets.right - 2 * FIT_MARGIN, 40);
  const roomH = Math.max(canvas.height - insets.top - insets.bottom - 2 * FIT_MARGIN, 40);
  const scale = clampScale(Math.min(roomW / paper.width, roomH / paper.height));
  const left = insets.left + FIT_MARGIN;
  const top = insets.top + FIT_MARGIN;
  return {
    scale,
    x: left + (roomW - paper.width * scale) / 2,
    y: top + (roomH - paper.height * scale) / 2,
  };
}

/** Zooms by `factor` (above 1 zooms in) keeping the sheet point under (`px`, `py`) in place. */
export function zoomSheetAt(view: SheetView, factor: number, px: number, py: number): SheetView {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** Moves the sheet by (`dx`, `dy`) px. */
export function panSheet(view: SheetView, dx: number, dy: number): SheetView {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/** The sheet point (mm from its top-left, y down) under the canvas point (`px`, `py`). */
export function sheetPoint(view: SheetView, px: number, py: number): [number, number] {
  return [(px - view.x) / view.scale, (py - view.y) / view.scale];
}

/** The zoom as the floating bar shows it: "62%". */
export function zoomText(view: SheetView): string {
  return `${Math.round((view.scale / TRUE_SIZE) * 100)}%`;
}
