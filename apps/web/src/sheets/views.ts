/**
 * Views on a sheet (P6-24 S2, plan §4.3, §4.5): where a view looks from, its scale and
 * name, placing one with the pointer and changing one from its card. Plain functions over
 * the stores, like `mode.ts`: every change is one command and one undo step with its own
 * label, and ends an open sketch first (`leaveSketch`).
 *
 * **Where `at` sits** (ADR-0143's S2 view-tools amendment): a view's `at` is where the
 * world origin lands on the sheet (the view's own frame is the world projected, origin at
 * 0, 0), not the middle of its lines. So views projected from one another share a sheet
 * coordinate exactly (a view above keeps its parent's `right`, so the same `at.x` lines
 * them up), a dimension's `at` in view mm needs no rewrite, and a model change that
 * grows the part never moves the view. Placing puts the middle of the lines (the quick
 * view's bounds, known before the click) under the pointer and stores the origin that
 * gives, so the view does not jump when its lines arrive.
 */
import {
  addSheetView,
  type BodyId,
  type Command,
  CommandError,
  type ExtrudoDocument,
  type NamedView,
  newId,
  projectedFrom,
  SHEET_STANDARD_VIEWS,
  type Sheet,
  type SheetScale,
  type SheetStandardView,
  type SheetView,
  type SheetViewChanges,
  type SheetViewFrom,
  type SheetViewId,
  type SheetViewSide,
  type SheetViewStyle,
  sheetBaseFrame,
  sheetProjectedFrame,
  updateSheetView,
  type Vec2,
  type Vec3,
} from '@extrudo/core';
import { leaveSketch, type SheetModeStores } from './mode';
import { runAsOneStep } from './selection';

type BaseFrom = Extract<SheetViewFrom, { kind: 'base' }>;

/** A choice of the card's and the tool's "Looking from". */
export interface LookingFrom {
  /** `front` … `bottom`, `iso-…`, `current`, `named:<id>`. */
  value: string;
  label: string;
  /** The name a new view from it gets ("Front", "Isometric"). */
  name: string;
  from: BaseFrom;
}

const STANDARD_LABELS: Record<SheetStandardView, string> = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
};

/** The four isometrics, from the front's frame: which faces each shows. */
const ISOMETRICS = [
  ['iso-above-right', 'Isometric: top, front, right'],
  ['iso-above-left', 'Isometric: top, front, left'],
  ['iso-below-right', 'Isometric: bottom, front, right'],
  ['iso-below-left', 'Isometric: bottom, front, left'],
] as const;

type Xyz = [number, number, number];
const tidy = (v: readonly number[]): Xyz => v.map((x) => Math.round(x * 1e9) / 1e9 + 0) as Xyz;

function standard(name: SheetStandardView): LookingFrom {
  const { direction, up } = SHEET_STANDARD_VIEWS[name];
  return {
    value: name,
    label: STANDARD_LABELS[name],
    name: STANDARD_LABELS[name],
    from: { kind: 'base', direction: [...direction], up: [...up] },
  };
}

/** The six standard views and the four isometrics, in the card's order. */
export const LOOKING_FROM: readonly LookingFrom[] = [
  ...(Object.keys(STANDARD_LABELS) as SheetStandardView[]).map(standard),
  ...ISOMETRICS.map(([side, label]) => {
    const front = SHEET_STANDARD_VIEWS.front;
    const frame = sheetProjectedFrame(
      sheetBaseFrame([...front.direction], [...front.up]),
      'third',
      side,
    );
    return {
      value: side,
      label,
      name: 'Isometric',
      from: { kind: 'base', direction: tidy(frame.direction), up: tidy(frame.up) } as BaseFrom,
    };
  }),
];

const dot = (a: readonly number[], b: readonly number[]) =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
const unit = (v: readonly number[]): Xyz => {
  const l = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0) || 1;
  return tidy([(v[0] ?? 0) / l, (v[1] ?? 0) / l, (v[2] ?? 0) / l]);
};

/** A named view's camera as a base view's `from`: from the eye to the target, its up. */
export function namedViewFrom(view: NamedView): BaseFrom | undefined {
  const { position, target, up } = view.camera;
  const direction = unit([
    target[0] - position[0],
    target[1] - position[1],
    target[2] - position[2],
  ]);
  try {
    const frame = sheetBaseFrame(direction, up);
    return { kind: 'base', direction: tidy(frame.direction), up: tidy(frame.up) };
  } catch {
    return undefined;
  }
}

/**
 * Every "Looking from" choice: the standard views, the isometrics, the model's current
 * view (`current`, when the caller can say it) and each named view of the design.
 */
export function lookingFromChoices(
  doc: Pick<ExtrudoDocument, 'views'>,
  current?: { direction: Vec3; up: Vec3 },
): LookingFrom[] {
  const out = [...LOOKING_FROM];
  if (current) {
    try {
      const frame = sheetBaseFrame(current.direction, current.up);
      out.push({
        value: 'current',
        label: 'The model’s current view',
        name: 'View',
        from: { kind: 'base', direction: tidy(frame.direction), up: tidy(frame.up) },
      });
    } catch {
      // A degenerate camera: not offered.
    }
  }
  for (const view of doc.views) {
    const from = namedViewFrom(view);
    if (from) out.push({ value: `named:${view.id}`, label: view.name, name: view.name, from });
  }
  return out;
}

/** The choice a base view's `from` is (the same direction and up), or `undefined`. */
export function lookingFromOf(
  from: BaseFrom,
  choices: readonly LookingFrom[],
): LookingFrom | undefined {
  try {
    const frame = sheetBaseFrame(from.direction, from.up);
    return choices.find((c) => {
      const other = sheetBaseFrame(c.from.direction, c.from.up);
      return dot(frame.direction, other.direction) > 1 - 1e-9 && dot(frame.up, other.up) > 1 - 1e-9;
    });
  } catch {
    return undefined;
  }
}

/** The scales the card and the tool offer besides the sheet's (plan §4.3). */
export const STANDARD_SCALES: readonly SheetScale[] = [
  [1, 1],
  [1, 2],
  [1, 5],
  [1, 10],
  [1, 20],
  [1, 50],
  [2, 1],
  [5, 1],
];

export const scaleText = ([a, b]: SheetScale) =>
  `${Math.round(a * 1000) / 1000}:${Math.round(b * 1000) / 1000}`;

/** `name`, or `name 2`, `name 3` … : unique among the sheet's views, case-insensitively. */
export function freeViewName(sheet: Pick<Sheet, 'views'>, name: string): string {
  const taken = new Set(sheet.views.map((v) => v.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const next = `${name} ${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}

/**
 * The `at` that puts the middle of `bounds` (view mm, y up) at the sheet point `point`
 * at scale `k`: the world origin's place on the sheet.
 */
export function placedAt(
  point: Vec2,
  bounds: { min: readonly number[]; max: readonly number[] } | undefined,
  k: number,
): [number, number] {
  if (!bounds) return [round(point[0]), round(point[1])];
  const cx = ((bounds.min[0] ?? 0) + (bounds.max[0] ?? 0)) / 2;
  const cy = ((bounds.min[1] ?? 0) + (bounds.max[1] ?? 0)) / 2;
  return [round(point[0] - k * cx), round(point[1] + k * cy)];
}

const round = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * The `at` that keeps the middle of a view's lines where it is on the sheet when its scale
 * goes from `k` to `next` (its lines' `bounds`, view mm); `at` itself without bounds.
 */
export function rescaledAt(
  at: readonly [number, number],
  bounds: { min: readonly number[]; max: readonly number[] } | undefined,
  k: number,
  next: number,
): [number, number] {
  if (!bounds) return [at[0], at[1]];
  const cx = ((bounds.min[0] ?? 0) + (bounds.max[0] ?? 0)) / 2;
  const cy = ((bounds.min[1] ?? 0) + (bounds.max[1] ?? 0)) / 2;
  return [round(at[0] + (k - next) * cx), round(at[1] - (k - next) * cy)];
}

/** What a new base view is made of: the tool's choices. */
export interface NewBaseView {
  from: BaseFrom;
  name: string;
  at: [number, number];
  /** Absent: the sheet's. */
  scale?: SheetScale;
  style?: SheetViewStyle;
  bodies?: BodyId[];
}

function run(stores: SheetModeStores, command: Command): string | undefined {
  try {
    leaveSketch(stores);
    stores.store.getState().dispatch(command);
    return undefined;
  } catch (error) {
    if (error instanceof CommandError) return error.message;
    throw error;
  }
}

/** Places a base view on sheet `sheet` (one undo step, "Base view"); returns its ID. */
export function placeBaseView(
  stores: SheetModeStores,
  sheet: Sheet,
  view: NewBaseView,
): { id: SheetViewId } | { error: string } {
  const id = newId<SheetViewId>();
  const made: SheetView = {
    id,
    name: freeViewName(sheet, view.name),
    at: view.at,
    from: view.from,
    ...(view.scale && scaleText(view.scale) !== scaleText(sheet.scale) && { scale: view.scale }),
    ...(view.style && view.style !== 'hidden' && { style: view.style }),
    ...(view.bodies && { bodies: view.bodies }),
  };
  const error = run(stores, {
    ...addSheetView({ sheet: sheet.id, view: made }),
    label: 'Base view',
  });
  return error ? { error } : { id };
}

/** One change of a view's card as one undo step called `label`; returns a refusal's message. */
export function changeSheetView(
  stores: SheetModeStores,
  id: SheetViewId,
  changes: SheetViewChanges,
  label: string,
): string | undefined {
  return run(stores, { ...updateSheetView({ id, changes }), label });
}

// Projected views (S2 part 2) -----------------------------------------------------

/**
 * Where a projected view goes from where the pointer is against its parent's middle
 * (`dx`, `dy` sheet mm, y down): mostly across gives left or right, mostly up or down gives
 * above or below (plan §4.5), a diagonal (within a factor of two) an isometric corner.
 */
export function projectedSide(dx: number, dy: number): SheetViewSide {
  const [ax, ay] = [Math.abs(dx), Math.abs(dy)];
  if (ax >= 2 * ay) return dx >= 0 ? 'right' : 'left';
  if (ay >= 2 * ax) return dy < 0 ? 'above' : 'below';
  return `iso-${dy < 0 ? 'above' : 'below'}-${dx >= 0 ? 'right' : 'left'}`;
}

/**
 * A projected view's `at` for the sheet point under the pointer: the middle of its lines
 * there, but on its parent's line, exactly: one beside it shares the parent's `at.y`, one
 * above or below its `at.x` (their frames share `up` or `right`, so the views line up). An
 * isometric one goes where the pointer is.
 */
export function projectedAt(
  side: SheetViewSide,
  point: Vec2,
  parentAt: readonly [number, number],
  bounds: { min: readonly number[]; max: readonly number[] } | undefined,
  k: number,
): [number, number] {
  const [x, y] = placedAt(point, bounds, k);
  if (side === 'left' || side === 'right') return [x, parentAt[1]];
  if (side === 'above' || side === 'below') return [parentAt[0], y];
  return [x, y];
}

/** A projected view's name: the standard view it is ("Top", "Left"), else "Isometric" or "Projected". */
export function projectedName(side: SheetViewSide, direction: Vec3): string {
  if (side.startsWith('iso-')) return 'Isometric';
  const match = LOOKING_FROM.slice(0, 6).find(
    (c) => dot(unit(c.from.direction), direction) > 1 - 1e-9,
  );
  return match?.name ?? 'Projected';
}

/** Places a view projected from `parent` on `side` (one undo step, "Projected view"). */
export function placeProjectedView(
  stores: SheetModeStores,
  sheet: Sheet,
  parent: SheetViewId,
  side: SheetViewSide,
  at: [number, number],
  name: string,
): { id: SheetViewId } | { error: string } {
  const id = newId<SheetViewId>();
  const view: SheetView = {
    id,
    name: freeViewName(sheet, name),
    at,
    from: { kind: 'projected', parent, side },
  };
  const error = run(stores, {
    ...addSheetView({ sheet: sheet.id, view }),
    label: 'Projected view',
  });
  return error ? { error } : { id };
}

/**
 * A base view's new scale as one undo step ("View scale"): the middle of its lines stays
 * where it is (`rescaledAt`), and every view projected from it keeps its place against it,
 * scaled with it, so the views stay lined up. `undefined` is the sheet's scale.
 */
export function rescaleSheetView(
  stores: SheetModeStores,
  sheet: Sheet,
  id: SheetViewId,
  scale: SheetScale | undefined,
  bounds: { min: readonly number[]; max: readonly number[] } | undefined,
  label = 'View scale',
): string | undefined {
  const view = sheet.views.find((v) => v.id === id);
  if (!view) return undefined;
  const [a, b] = view.scale ?? sheet.scale;
  const [c, d] = scale ?? sheet.scale;
  const [k, next] = [a / b, c / d];
  const at = rescaledAt(view.at, bounds, k, next);
  const r = next / k;
  const steps = [
    updateSheetView({ id, changes: { scale: scale ?? null, at } }),
    ...projectedFrom(sheet, id).flatMap((child) => {
      const v = sheet.views.find((w) => w.id === child);
      if (!v) return [];
      const moved: [number, number] = [
        round(at[0] + (v.at[0] - view.at[0]) * r),
        round(at[1] + (v.at[1] - view.at[1]) * r),
      ];
      return [updateSheetView({ id: child, changes: { at: moved } })];
    }),
  ];
  try {
    leaveSketch(stores);
    runAsOneStep(
      stores.store,
      label,
      steps.map((command) => () => command),
    );
    return undefined;
  } catch (error) {
    if (error instanceof CommandError) return error.message;
    throw error;
  }
}

/** The standard scales from the largest down: what "fit" tries in turn. */
export const SCALES_DOWN: readonly SheetScale[] = [...STANDARD_SCALES].sort(
  (p, q) => q[0] / q[1] - p[0] / p[1],
);

/**
 * The largest standard scale at which something `width` × `height` mm (model size) fits in
 * `room` × `roomHeight` sheet mm; the smallest standard one when none does.
 */
export function fitScale(
  width: number,
  height: number,
  room: number,
  roomHeight: number,
): SheetScale {
  const fits = SCALES_DOWN.find(
    ([a, b]) => (width * a) / b <= room && (height * a) / b <= roomHeight,
  );
  return [...(fits ?? (SCALES_DOWN.at(-1) as SheetScale))] as SheetScale;
}
