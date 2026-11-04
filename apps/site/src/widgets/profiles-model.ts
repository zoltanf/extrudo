/**
 * The `profiles` widget, the pure part (ADR-0116 §1): a plate with a hole, an
 * island in the hole, a slot, two overlapping circles, a line with a free end and
 * an open shape, and the regions the app's profile finder makes of them
 * (`packages/sketch/src/profiles/profiles.ts`): construction never bounds a
 * profile, crossing curves split each other, curves with a free end make none, and
 * a loop inside another is a hole in it. Three switches change the sketch, one
 * hides the shading. State in, the stage's SVG and the result line out; no DOM.
 */
import type { Switch } from './controls';
import { el, escapeText } from './svg';

export const VIEW_BOX = '0 0 500 260';
export const LABEL =
  'A plate with a round hole, an island in the hole and a slot, two overlapping circles, a line with a free end and an open shape; the closed regions are shaded as profiles';

/** One stage unit, in millimetres: the plate is 65 × 45 mm. */
const MM = 0.25;

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

const PLATE = { x0: 40, y0: 40, x1: 300, y1: 220 };
const HOLE = { cx: 110, cy: 130, r: 32 };
const ISLAND_R = 13;
const SLOT = { ax: 182, bx: 250, y: 130, r: 18 };
/** Two circles of radius 42, 50 apart. */
const PAIR = { ax: 370, bx: 420, y: 110, r: 42 };
const HALF = (PAIR.bx - PAIR.ax) / 2;
const MID = PAIR.ax + HALF;
const LENS_H = Math.sqrt(PAIR.r ** 2 - HALF ** 2);

const PLATE_D = `M${PLATE.x0} ${PLATE.y0}H${PLATE.x1}V${PLATE.y1}H${PLATE.x0}Z`;
const HOLE_D = circle(HOLE.cx, HOLE.cy, HOLE.r);
const ISLAND_D = circle(HOLE.cx, HOLE.cy, ISLAND_R);
const SLOT_D = `M${SLOT.ax} ${SLOT.y - SLOT.r}H${SLOT.bx}A${SLOT.r} ${SLOT.r} 0 0 1 ${SLOT.bx} ${SLOT.y + SLOT.r}H${SLOT.ax}A${SLOT.r} ${SLOT.r} 0 0 1 ${SLOT.ax} ${SLOT.y - SLOT.r}Z`;
/** The slot without its right end: two lines and the left arc. */
const SLOT_OPEN_D = `M${SLOT.bx} ${SLOT.y - SLOT.r}H${SLOT.ax}A${SLOT.r} ${SLOT.r} 0 0 0 ${SLOT.ax} ${SLOT.y + SLOT.r}H${SLOT.bx}`;
const TOP = PAIR.y - LENS_H;
const BOTTOM = PAIR.y + LENS_H;
const R = PAIR.r;
const LENS_D = `M${MID} ${TOP}A${R} ${R} 0 0 1 ${MID} ${BOTTOM}A${R} ${R} 0 0 1 ${MID} ${TOP}Z`;
const LEFT_D = `M${MID} ${TOP}A${R} ${R} 0 1 0 ${MID} ${BOTTOM}A${R} ${R} 0 0 1 ${MID} ${TOP}Z`;
const RIGHT_D = `M${MID} ${TOP}A${R} ${R} 0 1 1 ${MID} ${BOTTOM}A${R} ${R} 0 0 0 ${MID} ${TOP}Z`;
const PAIR_D = circle(PAIR.ax, PAIR.y, R) + circle(PAIR.bx, PAIR.y, R);
const DANGLE_D = 'M270 40V92';
const OPEN_D = 'M340 180V232H460V180';

/** Areas in square stage units. */
const AREA = {
  plate: (PLATE.x1 - PLATE.x0) * (PLATE.y1 - PLATE.y0),
  hole: Math.PI * HOLE.r ** 2,
  island: Math.PI * ISLAND_R ** 2,
  slot: (SLOT.bx - SLOT.ax) * 2 * SLOT.r + Math.PI * SLOT.r ** 2,
  lens: 2 * R * R * Math.acos(HALF / R) - HALF * Math.sqrt(4 * R * R - (2 * HALF) ** 2),
  circle: Math.PI * R * R,
};

export interface ProfilesState {
  /** The small circle inside the hole. */
  island: boolean;
  /** The slot's right arc; without it the slot is open. */
  slotEnd: boolean;
  /** The hole's circle as construction geometry. */
  construction: boolean;
  /** The palette's Show profiles: the shading. */
  show: boolean;
  /** The regions clicked, by id. */
  picked: readonly string[];
}

export const START: ProfilesState = {
  island: true,
  slotEnd: true,
  construction: false,
  show: true,
  picked: [],
};

export const SWITCH_KEYS = ['island', 'slotEnd', 'construction', 'show'] as const;
export type SwitchKey = (typeof SWITCH_KEYS)[number];

export const SWITCHES: readonly Omit<Switch, 'checked'>[] = [
  {
    key: 'island',
    label: 'Island in the hole',
    icon: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/>',
  },
  {
    key: 'slotEnd',
    label: "Slot's right end",
    icon: '<path d="M11 4H5a4 4 0 0 0 0 8h6a4 4 0 0 0 0-8"/>',
  },
  {
    key: 'construction',
    label: 'Hole as construction',
    icon: '<circle cx="8" cy="8" r="6" stroke-dasharray="3 2"/>',
  },
  {
    key: 'show',
    label: 'Show profiles',
    icon: '<rect class="widget-icon-fill" x="2" y="3" width="12" height="10" rx="1"/>',
  },
];

/** One profile: its outline (holes as further loops, filled even-odd) and its area. */
export interface Region {
  id: string;
  name: string;
  d: string;
  /** In square stage units. */
  area: number;
  holes: number;
  /** Why it is a profile, when there is more to say than its loops. */
  note?: string;
}

const SPLIT = 'Crossing curves split each other into separate profiles.';

/** The profiles the app finds in the sketch, in drawing order. */
export function regions(state: ProfilesState): Region[] {
  const hole = !state.construction;
  const plateHoles = [
    hole ? HOLE_D : undefined,
    !hole && state.island ? ISLAND_D : undefined,
    state.slotEnd ? SLOT_D : undefined,
  ].filter((d): d is string => d !== undefined);
  const plateArea =
    AREA.plate -
    (hole ? AREA.hole : 0) -
    (!hole && state.island ? AREA.island : 0) -
    (state.slotEnd ? AREA.slot : 0);
  const out: Region[] = [
    {
      id: 'plate',
      name: 'Plate',
      d: [PLATE_D, ...plateHoles].join(' '),
      area: plateArea,
      holes: plateHoles.length,
    },
  ];
  if (hole) {
    out.push({
      id: 'hole',
      name: 'Inside the hole',
      d: state.island ? `${HOLE_D} ${ISLAND_D}` : HOLE_D,
      area: AREA.hole - (state.island ? AREA.island : 0),
      holes: state.island ? 1 : 0,
      note: 'The circle is a hole in the plate and a profile of its own.',
    });
  }
  if (state.island) {
    out.push({
      id: 'island',
      name: 'Island',
      d: ISLAND_D,
      area: AREA.island,
      holes: 0,
      note: hole
        ? 'A circle inside the hole: a profile of its own, and a hole in the one around it.'
        : 'With the hole construction, the island is a hole in the plate.',
    });
  }
  if (state.slotEnd) {
    out.push({
      id: 'slot',
      name: 'Slot',
      d: SLOT_D,
      area: AREA.slot,
      holes: 0,
      note: 'Two lines and two arcs, joined end to end.',
    });
  }
  out.push(
    {
      id: 'left',
      name: 'Left part',
      d: LEFT_D,
      area: AREA.circle - AREA.lens,
      holes: 0,
      note: SPLIT,
    },
    { id: 'lens', name: 'Overlap', d: LENS_D, area: AREA.lens, holes: 0, note: SPLIT },
    {
      id: 'right',
      name: 'Right part',
      d: RIGHT_D,
      area: AREA.circle - AREA.lens,
      holes: 0,
      note: SPLIT,
    },
  );
  return out;
}

/** The curves that make no profile, with what the readout says about them. */
export const EXTRAS: Readonly<Record<string, { name: string; why: string }>> = {
  dangle: {
    name: 'Line with a free end',
    why: 'One end touches nothing, so it bounds no profile and changes none.',
  },
  open: { name: 'Open shape', why: "Its ends don't meet, so it encloses nothing." },
  slotOpen: {
    name: 'Open slot',
    why: "Without its right end the slot's curves have free ends: no profile, and the plate loses that hole.",
  },
  construction: {
    name: 'Construction circle',
    why: 'Construction geometry never bounds a profile.',
  },
};

/** An area in mm², one decimal. */
export function formatArea(area: number): string {
  return `${(area * MM * MM).toFixed(1)} mm²`;
}

const loops = (holes: number) =>
  holes === 0 ? 'one loop, no holes' : `an outer loop and ${holes} hole${holes > 1 ? 's' : ''}`;

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** The state with region `id` picked or let go (an id that is no profile changes nothing). */
export function togglePick(state: ProfilesState, id: string): ProfilesState {
  if (state.picked.includes(id)) {
    return { ...state, picked: state.picked.filter((p) => p !== id) };
  }
  return regions(state).some((r) => r.id === id)
    ? { ...state, picked: [...state.picked, id] }
    : state;
}

/** The state after a switch flips; a pick whose region is gone is dropped. */
export function setSwitch(state: ProfilesState, key: SwitchKey, on: boolean): ProfilesState {
  const next = { ...state, [key]: on };
  const ids = new Set(regions(next).map((r) => r.id));
  return { ...next, picked: next.picked.filter((id) => ids.has(id)) };
}

/**
 * The result line, bold part and rest: the region or curve under the pointer
 * (`over`, a region id or an `EXTRAS` key) if any, else the picked regions' area,
 * else the count.
 */
export function result(state: ProfilesState, over?: string): { word: string; rest: string } {
  const all = regions(state);
  const region = all.find((r) => r.id === over);
  if (region) {
    return {
      word: `${region.name}, ${formatArea(region.area)}`,
      rest: region.note ?? `A profile: ${loops(region.holes)}.`,
    };
  }
  const extra = over === undefined ? undefined : EXTRAS[over];
  if (extra) return { word: extra.name, rest: extra.why };
  const picked = all.filter((r) => state.picked.includes(r.id));
  const [first] = picked;
  if (first && picked.length === 1) {
    return {
      word: `Selected: ${formatArea(first.area)}`,
      rest: `${first.name}: ${loops(first.holes)}. Click it again to let go.`,
    };
  }
  if (picked.length > 1) {
    return {
      word: `Selected: ${formatArea(picked.reduce((sum, r) => sum + r.area, 0))}`,
      rest: `${picked.length} profiles: ${picked.map((r) => r.name).join(', ')}.`,
    };
  }
  const n = all.length;
  return {
    word: `${WORDS[n] ?? n} profile${n === 1 ? '' : 's'}`,
    rest: 'Click a region to select it and see its area.',
  };
}

/** The result as markup for the build: the first part in a `<strong>`, the rest on its own line. */
export function resultMarkup(state: ProfilesState): string {
  const { word, rest } = result(state);
  return `<strong>${escapeText(word)}</strong><br>${escapeText(rest)}`;
}

/** A region's fill class: shaded, hidden (still clickable), picked; `HOVER_CLASS` is added while pointed at. */
export function regionClass(state: ProfilesState, id: string): string {
  const base = state.show ? 'sk-profile' : 'sk-profile-off';
  return state.picked.includes(id) ? `${base} sk-profile-picked` : base;
}

export const HOVER_CLASS = 'sk-profile-hover';

/**
 * The stage's inner markup. `live` makes each region a focusable checkbox and
 * names the curves that make no profile; the build draws the still picture
 * without them.
 */
export function profilesMarkup(state: ProfilesState, live: boolean): string {
  const out: string[] = [];
  for (const r of regions(state)) {
    const attributes: Record<string, string | number> = {
      class: regionClass(state, r.id),
      d: r.d,
      'fill-rule': 'evenodd',
      'data-region': r.id,
    };
    if (live) {
      Object.assign(attributes, {
        tabindex: 0,
        role: 'checkbox',
        'aria-checked': String(state.picked.includes(r.id)),
        'aria-label': `${r.name}, ${formatArea(r.area)}`,
      });
    }
    out.push(el('path', attributes));
  }

  // The curves let the pointer through, so a click on an edge reaches the region under it.
  const curve = (d: string, cls = 'sk-free') =>
    el('path', { class: cls, d, 'stroke-width': 2, 'pointer-events': 'none' });
  out.push(curve(PLATE_D), curve(PAIR_D));
  if (state.island) out.push(curve(ISLAND_D));
  const extras: [string, string, string][] = [
    ['dangle', DANGLE_D, 'sk-free'],
    ['open', OPEN_D, 'sk-free'],
  ];
  if (state.slotEnd) out.push(curve(SLOT_D));
  else extras.push(['slotOpen', SLOT_OPEN_D, 'sk-free']);
  if (state.construction) extras.push(['construction', HOLE_D, 'sk-construction']);
  else out.push(curve(HOLE_D));

  for (const [key, d, cls] of extras) {
    out.push(curve(d, cls));
    if (live) {
      out.push(
        el('path', {
          class: 'widget-hit',
          d,
          'data-extra': key,
          'stroke-width': 12,
          role: 'img',
          'aria-label': `${EXTRAS[key]?.name}: ${EXTRAS[key]?.why}`,
        }),
      );
    }
  }
  return out.join('');
}
