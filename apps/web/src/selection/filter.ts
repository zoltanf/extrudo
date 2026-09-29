/**
 * The selection filter (P2-03, FR-VP-05, UI spec §3.2): which kinds a
 * click, a box or "Select other…" may take in model mode. It lives with the
 * nav bar's Select button and in the viewport store, for the session only:
 * a filter left on from yesterday would make clicks seem broken.
 */
import type { SelectionItem } from '@extrudo/core';

export type FilterKind =
  | 'bodies'
  | 'faces'
  | 'edges'
  | 'vertices'
  | 'sketches'
  | 'profiles'
  | 'construction';

export type SelectionFilter = Readonly<Record<FilterKind, boolean>>;

export const FILTER_KINDS: readonly { value: FilterKind; label: string; hint: string }[] = [
  { value: 'bodies', label: 'Bodies', hint: 'Whole bodies: a box takes them first' },
  { value: 'faces', label: 'Faces', hint: 'Body faces' },
  { value: 'edges', label: 'Edges', hint: 'Body edges' },
  { value: 'vertices', label: 'Vertices', hint: 'Body corners' },
  { value: 'sketches', label: 'Sketches', hint: 'Sketch curves' },
  { value: 'profiles', label: 'Profiles', hint: 'Closed sketch regions' },
  {
    value: 'construction',
    label: 'Construction',
    hint: 'Construction planes, axes, points and sketch curves',
  },
];

export const DEFAULT_FILTER: SelectionFilter = {
  bodies: true,
  faces: true,
  edges: true,
  vertices: true,
  sketches: true,
  profiles: true,
  construction: true,
};

/** Whether a filter differs from the default (the nav bar marks it). */
export function isFiltered(filter: SelectionFilter): boolean {
  return FILTER_KINDS.some(({ value }) => filter[value] !== DEFAULT_FILTER[value]);
}

/** The filter kind that governs a selection item, if any. */
export function filterKindOf(item: SelectionItem): FilterKind | undefined {
  switch (item.kind) {
    case 'body':
      return 'bodies';
    case 'face':
      return 'faces';
    case 'edge':
      return 'edges';
    case 'vertex':
      return 'vertices';
    case 'profile':
      return 'profiles';
    case 'sketchEntity':
      return 'sketches';
    case 'plane':
    case 'axis':
    case 'point':
      return 'construction';
    default:
      return undefined;
  }
}

/**
 * The filter picking uses: the user's, narrowed by a feature dialog's
 * selection field while it takes picks (P2-05). Both must allow a kind.
 */
export function combineFilters(
  user: SelectionFilter,
  field: SelectionFilter | undefined,
): SelectionFilter {
  if (!field) return user;
  return Object.fromEntries(
    FILTER_KINDS.map(({ value }) => [value, user[value] && field[value]]),
  ) as SelectionFilter;
}
