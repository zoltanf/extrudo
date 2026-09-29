/**
 * The marking menu's geometry (P3-11, ADR-0042): eight wedges round the
 * pointer, numbered clockwise from the top (0 = up, 1 = up-right, 2 = right
 * ...), and where the menu goes so it never leaves the window. Pure, so the
 * gesture and the placement are unit tested; `MarkingMenu.tsx` draws it.
 */

/** Wedges in the ring. */
export const SLOT_COUNT = 8;
/** Inner and outer radius of the ring, px. */
export const RING_INNER = 36;
export const RING_OUTER = 132;
/** Distance from the ring's centre to a wedge's label, px. */
export const LABEL_RADIUS = 92;
/** The overflow list under the ring: width, row height, and padding, px. */
export const LIST_WIDTH = 232;
export const LIST_ROW = 32;
export const LIST_SEPARATOR = 9;
export const LIST_PADDING = 8;
/** The list never grows taller than this, px; it scrolls instead. */
export const LIST_MAX_HEIGHT = 320;
/** Space between the ring and the list, and the window's edge, px. */
export const GAP = 6;
export const MARGIN = 8;

/**
 * The wedge a pointer offset from the ring's centre points at, or
 * `undefined` inside the dead zone (a press and release without a flick).
 * Screen coordinates (y down); wedge 0 is centred on straight up, and each
 * wedge spans 45 degrees.
 */
export function slotAt(dx: number, dy: number, deadZone = RING_INNER): number | undefined {
  if (Math.hypot(dx, dy) < deadZone) return undefined;
  // Clockwise from up, in [0, 360).
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const clockwise = (degrees + 360) % 360;
  return Math.floor(((clockwise + 22.5) % 360) / 45);
}

/** The centre of wedge `index` at `radius` from the ring's centre (y down). */
export function slotCenter(index: number, radius = LABEL_RADIUS): { x: number; y: number } {
  const angle = (index * 45 * Math.PI) / 180;
  return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius };
}

/** The wedge that an arrow key jumps to from anywhere in the ring: up is 0, right 2, down 4, left 6. */
export const ARROW_SLOT: Readonly<Record<string, number>> = {
  ArrowUp: 0,
  ArrowRight: 2,
  ArrowDown: 4,
  ArrowLeft: 6,
};

/**
 * The outline of wedge `index` as an SVG path in a square of `2 * outer`
 * centred on (outer, outer): an annular sector between the radii, pulled in
 * by `gap` px on each side so neighbours show a hairline between them.
 */
export function wedgePath(
  index: number,
  inner = RING_INNER,
  outer = RING_OUTER,
  gap = 1.5,
): string {
  const start = (index * 45 - 22.5) * (Math.PI / 180);
  const end = (index * 45 + 22.5) * (Math.PI / 180);
  const point = (radius: number, angle: number, sideGap: number) => {
    // Shift along the arc by `gap` px so the seam has a constant width.
    const a = angle + sideGap / radius;
    return [outer + Math.sin(a) * radius, outer - Math.cos(a) * radius] as const;
  };
  const fmt = (n: number) => Math.round(n * 100) / 100;
  const [x1, y1] = point(outer, start, gap);
  const [x2, y2] = point(outer, end, -gap);
  const [x3, y3] = point(inner, end, -gap);
  const [x4, y4] = point(inner, start, gap);
  return [
    `M${fmt(x1)} ${fmt(y1)}`,
    `A${outer} ${outer} 0 0 1 ${fmt(x2)} ${fmt(y2)}`,
    `L${fmt(x3)} ${fmt(y3)}`,
    `A${inner} ${inner} 0 0 0 ${fmt(x4)} ${fmt(y4)}`,
    'Z',
  ].join(' ');
}

/** The height of the overflow list for `rows` entries with `separators` group breaks. */
export function listHeight(rows: number, separators: number): number {
  if (rows === 0) return 0;
  return Math.min(LIST_MAX_HEIGHT, rows * LIST_ROW + separators * LIST_SEPARATOR + LIST_PADDING);
}

export interface Placement {
  /** The ring's centre in window px. */
  center: { x: number; y: number };
  /** The list's top-left corner and size in window px (`height` 0: no list). */
  list: { left: number; top: number; width: number; height: number };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * Places the ring on `at` and the list below it. The ring keeps clear of
 * the window's edges; the list goes below the ring, or above it when there
 * is no room below, and is shortened (it scrolls) when neither fits.
 * Without a ring (`null`: the plain list), the list opens at the pointer.
 */
export function placeMenu(
  at: { x: number; y: number },
  view: { width: number; height: number },
  list: { rows: number; separators: number },
  ring: number | null = RING_OUTER,
): Placement {
  const width = Math.min(LIST_WIDTH, view.width - 2 * MARGIN);
  const wanted = listHeight(list.rows, list.separators);
  if (ring === null) {
    const height = Math.min(wanted, view.height - 2 * MARGIN);
    return {
      center: at,
      list: {
        left: clamp(at.x, MARGIN, view.width - width - MARGIN),
        top: clamp(at.y, MARGIN, view.height - height - MARGIN),
        width,
        height,
      },
    };
  }
  const cx = clamp(at.x, ring + MARGIN, view.width - ring - MARGIN);
  const cy = clamp(at.y, ring + MARGIN, view.height - ring - MARGIN);
  const left = clamp(cx - width / 2, MARGIN, view.width - width - MARGIN);
  const center = { x: cx, y: cy };
  if (wanted === 0) return { center, list: { left, top: cy, width, height: 0 } };
  const below = view.height - MARGIN - (cy + ring + GAP);
  const above = cy - ring - GAP - MARGIN;
  if (wanted <= below)
    return { center, list: { left, top: cy + ring + GAP, width, height: wanted } };
  if (wanted <= above) {
    return { center, list: { left, top: cy - ring - GAP - wanted, width, height: wanted } };
  }
  // Neither side fits the whole list: the roomier side, shortened.
  const height = Math.max(LIST_ROW * 2, Math.min(wanted, Math.max(below, above)));
  return below >= above
    ? { center, list: { left, top: cy + ring + GAP, width, height } }
    : { center, list: { left, top: cy - ring - GAP - height, width, height } };
}
