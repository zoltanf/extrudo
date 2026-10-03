/**
 * Between selection fields and the view (ADR-0027): a picked session item
 * becomes a persistent `GeomRef`, a field's refs become items the view
 * highlights, and a field's accepted kinds become a selection filter.
 */
import type { BodyId, GeomRef, GeomRefKind, SelectionItem } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { DEFAULT_FILTER, type FilterKind, type SelectionFilter } from '../selection/filter';
import { readTopology, selectionRefs, topologyItem } from '../selection/items';

/**
 * The reference a selection field stores for a picked item: from the
 * mesh's persistent IDs for faces, edges and vertices (never an index
 * reference), the item's own ID for profiles, sketch curves, planes, axes,
 * points and bodies. Undefined if there is none (a mesh without IDs).
 */
export function itemRef(
  item: SelectionItem,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
): GeomRef | undefined {
  return selectionRefs([item], bodies)[0];
}

const TOPOLOGY: ReadonlySet<string> = new Set(['face', 'edge', 'vertex']);

function idsOf(mesh: BodyMesh, kind: string): readonly string[] | undefined {
  return kind === 'face' ? mesh.faceIds : kind === 'edge' ? mesh.edgeIds : mesh.vertexIds;
}

/**
 * The items the view highlights for references: a face, edge or vertex
 * where a body's mesh has its persistent ID (references that no longer
 * name anything shown are left out), other kinds by their IDs.
 */
export function refItems(
  refs: readonly GeomRef[],
  bodies: Readonly<Record<BodyId, BodyMesh>>,
): SelectionItem[] {
  const out: SelectionItem[] = [];
  for (const ref of refs) {
    if (!TOPOLOGY.has(ref.kind)) {
      out.push({ kind: ref.kind, id: ref.id });
      continue;
    }
    for (const [body, mesh] of Object.entries(bodies) as [BodyId, BodyMesh][]) {
      const index = idsOf(mesh, ref.kind)?.indexOf(ref.id) ?? -1;
      if (index < 0) continue;
      out.push(topologyItem({ kind: ref.kind as 'face' | 'edge' | 'vertex', body, index }));
      break;
    }
  }
  return out;
}

/** The filter kind each reference kind is picked through. */
const FILTER_OF: Record<GeomRefKind, FilterKind[]> = {
  body: ['bodies'],
  face: ['faces'],
  edge: ['edges'],
  vertex: ['vertices'],
  profile: ['profiles'],
  sketchEntity: ['sketches', 'construction'],
  plane: ['construction'],
  axis: ['construction'],
  point: ['construction'],
  // Features are ticked in the dialog, not picked in the view.
  feature: [],
};

/**
 * The selection filter of a field: only what it accepts. A field for
 * sketch points (`sketchPoints`, a hole's Points) takes those and no
 * curves: sketch entity picks become points. A field that takes whole texts
 * (`wholeTexts`, P4-03) leaves the sketch curves out: an extrude sweeps a
 * text's ink, not a line.
 */
export function fieldFilter(
  accepts: readonly GeomRefKind[],
  options: { sketchPoints?: boolean; wholeTexts?: boolean } = {},
): SelectionFilter {
  const allowed = new Set<FilterKind>(accepts.flatMap((kind) => FILTER_OF[kind]));
  if (options.sketchPoints) {
    allowed.delete('sketches');
    allowed.delete('construction');
    allowed.add('sketchPoints');
  }
  if (options.wholeTexts) {
    allowed.delete('sketches');
    // Ink regions come with the profiles, and each of them is a whole text.
    allowed.add('profiles');
  }
  return Object.fromEntries(
    (Object.keys(DEFAULT_FILTER) as FilterKind[]).map((kind) => [kind, allowed.has(kind)]),
  ) as SelectionFilter;
}

/** Whether a picked item is a kind the field accepts. */
export function accepts(kinds: readonly GeomRefKind[], item: SelectionItem): boolean {
  const topology = readTopology(item);
  const kind = topology ? topology.kind : item.kind;
  return (kinds as readonly string[]).includes(kind);
}
