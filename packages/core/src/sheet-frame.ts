/**
 * The axes a sheet view draws in (P6-24 S2, ADR-0143's S2 amendment): pure
 * math both the kernel (which projects the model through them) and the app
 * (which places the result on the sheet and snaps projected views to their
 * parent) use. A view's own coordinates are mm at model scale, x to the
 * right, y up the sheet, with the world origin at (0, 0); the app applies
 * the view's scale and position and flips y for the sheet.
 *
 * Third angle: a view placed to the right of its parent shows the model as
 * seen from the right. First angle: as seen from the left. Isometric sides
 * are pictorial and the same in both: `iso-above-right` looks from above,
 * from the right and from the parent's viewer.
 */
import type { Sheet, SheetViewFrom, SheetViewSide } from './sheet-schema';
import type { Vec2, Vec3 } from './sketch/planes';

/** A view's axes in the world: unit length, square to each other, `right = direction × up`. */
export interface SheetViewFrame {
  /** The way the view looks: from the eye into the model. */
  direction: Vec3;
  /** Up the sheet. */
  up: Vec3;
  /** To the right on the sheet. */
  right: Vec3;
}

/** The six standard base views (Z up, the front faces −Y), as `from.base` stores them. */
export const SHEET_STANDARD_VIEWS = {
  front: { direction: [0, 1, 0], up: [0, 0, 1] },
  back: { direction: [0, -1, 0], up: [0, 0, 1] },
  left: { direction: [1, 0, 0], up: [0, 0, 1] },
  right: { direction: [-1, 0, 0], up: [0, 0, 1] },
  top: { direction: [0, 0, -1], up: [0, 1, 0] },
  bottom: { direction: [0, 0, 1], up: [0, -1, 0] },
} as const satisfies Record<string, { direction: Vec3; up: Vec3 }>;
export type SheetStandardView = keyof typeof SHEET_STANDARD_VIEWS;

/** A standard view as a fresh `from` for a base view. */
export function sheetStandardFrom(
  name: SheetStandardView,
): Extract<SheetViewFrom, { kind: 'base' }> {
  const { direction, up } = SHEET_STANDARD_VIEWS[name];
  return { kind: 'base', direction: [...direction], up: [...up] };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scaled = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const sum = (...vs: Vec3[]): Vec3 =>
  vs.reduce<Vec3>((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]], [0, 0, 0]);
/** Rounds away floating noise, so −0 and 1e-17 read as 0 in keys and goldens. */
const tidy = (v: Vec3): Vec3 => v.map((x) => Math.round(x * 1e12) / 1e12 + 0) as unknown as Vec3;
function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-12)) throw new Error('A view direction has no length.');
  return scaled(v, 1 / l);
}

/**
 * A base view's frame: `direction` as given (made unit length) and `up`
 * turned square to it. Throws when either is zero or they are parallel
 * (`sheetProblems` refuses such a view).
 */
export function sheetBaseFrame(direction: Vec3, up: Vec3): SheetViewFrame {
  const d = unit(direction);
  const along = sum(up, scaled(d, -dot(up, d)));
  if (!(Math.hypot(...along) > 1e-9 * Math.max(1, Math.hypot(...up)))) {
    throw new Error("A view's up direction is parallel to the direction it looks along.");
  }
  const u = unit(along);
  return { direction: tidy(d), up: tidy(u), right: tidy(cross(d, u)) };
}

/** The direction a view on `side` of its parent looks along, third angle, and its up. */
function orthographic(
  parent: SheetViewFrame,
  side: 'left' | 'right' | 'above' | 'below',
): { direction: Vec3; up: Vec3 } {
  const { direction: d, up: u, right: r } = parent;
  switch (side) {
    case 'right':
      return { direction: scaled(r, -1), up: u };
    case 'left':
      return { direction: r, up: u };
    case 'above':
      return { direction: scaled(u, -1), up: d };
    case 'below':
      return { direction: u, up: scaled(d, -1) };
  }
}

const OPPOSITE = { left: 'right', right: 'left', above: 'below', below: 'above' } as const;

/**
 * The frame of a view projected from `parent` on its `side`, for the
 * sheet's projection angle. Orthographic sides keep the parent's right
 * (above, below) or up (left, right), so the two views line up on the
 * sheet. An isometric side looks along the parent's direction tilted
 * towards both its sides equally (35.26° up or down, 45° across) whatever
 * the angle, with the parent's up kept as close as it can be.
 */
export function sheetProjectedFrame(
  parent: SheetViewFrame,
  projection: Sheet['projection'],
  side: SheetViewSide,
): SheetViewFrame {
  if (side.startsWith('iso-')) {
    const [vertical, across] = side.slice(4).split('-') as ['above' | 'below', 'left' | 'right'];
    // From above and from the right means looking down and to the left: the
    // third-angle directions of those two neighbours, plus the parent's own.
    const direction = sum(
      parent.direction,
      orthographic(parent, vertical).direction,
      orthographic(parent, across).direction,
    );
    return sheetBaseFrame(direction, parent.up);
  }
  const placed = side as 'left' | 'right' | 'above' | 'below';
  const seen = projection === 'third' ? placed : OPPOSITE[placed];
  const { direction, up } = orthographic(parent, seen);
  return sheetBaseFrame(direction, up);
}

/**
 * The frame of view `id` of `sheet`, through its parents for a projected
 * view; `undefined` when the view, a parent or a base direction is missing
 * or broken, or the parents go round in a cycle.
 */
export function sheetViewFrame(
  sheet: Pick<Sheet, 'views' | 'projection'>,
  id: string,
): SheetViewFrame | undefined {
  const chain: { side: SheetViewSide }[] = [];
  const seen = new Set<string>();
  let at: string = id;
  for (;;) {
    if (seen.has(at)) return undefined;
    seen.add(at);
    const view = sheet.views.find((v) => v.id === at);
    if (!view) return undefined;
    if (view.from.kind === 'base') {
      try {
        let frame = sheetBaseFrame(view.from.direction, view.from.up);
        for (let i = chain.length - 1; i >= 0; i--) {
          frame = sheetProjectedFrame(
            frame,
            sheet.projection,
            (chain[i] as { side: SheetViewSide }).side,
          );
        }
        return frame;
      } catch {
        return undefined;
      }
    }
    chain.push({ side: view.from.side });
    at = view.from.parent;
  }
}

/** A world point in a view's own coordinates (mm at model scale, y up). */
export function toSheetView(frame: SheetViewFrame, p: Vec3): Vec2 {
  return [dot(p, frame.right), dot(p, frame.up)];
}
