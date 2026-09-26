/**
 * Splits a mapped sketch into independent components (ADR-0002): sets of
 * items that share unknowns. A union-find joins the entities each item links;
 * fixed entities have no unknowns and link nothing, so dimensioning many
 * features from one fixed point keeps them apart. Each component gets a copy
 * of the fixed geometry it uses.
 */
import type { Item, MappedSketch } from './mapping';

export interface Component {
  /** The entities with unknowns in this component, in sketch order. */
  entities: string[];
  /** What to push, in order: points, curves (fixed ones used included), constraints, dimensions. */
  items: Item[];
  /** Changes when the equations change (not when values do): rebuild the system. */
  structure: string;
}

export interface Split {
  components: Component[];
  /**
   * Constraints and dimensions on fixed geometry only. They remove no degree
   * of freedom, so they're redundant whatever their values.
   */
  overdetermined: string[];
}

const RANK = { point: 0, curve: 1, constraint: 2, dimension: 2 } as const;

/** Values that change without the equations changing. */
const VALUE_KEYS = new Set(['x', 'y', 'radius', 'start_angle', 'end_angle', 'radmin']);

export function splitComponents(mapped: MappedSketch): Split {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    for (
      let next = parent.get(root);
      next !== undefined && next !== root;
      next = parent.get(root)
    ) {
      root = next;
    }
    // Path compression keeps the next lookups short.
    for (let node = x; node !== root; ) {
      const next = parent.get(node) as string;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra, rb);
  };

  const shared = new Map<string, Item>();
  const overdetermined: string[] = [];
  for (const item of mapped.items) {
    const [first, ...rest] = item.links;
    if (first === undefined) {
      if (item.kind === 'point' || item.kind === 'curve') shared.set(item.id, item);
      else overdetermined.push(item.id);
      continue;
    }
    union(first, first);
    for (const other of rest) union(first, other);
  }

  const groups = new Map<string, Item[]>();
  for (const item of mapped.items) {
    const first = item.links[0];
    if (first === undefined) continue;
    const root = find(first);
    const group = groups.get(root);
    if (group) group.push(item);
    else groups.set(root, [item]);
  }

  const components: Component[] = [];
  for (const group of groups.values()) {
    // Copy in the fixed geometry the group uses, and the fixed points that geometry uses.
    const copies = new Map<string, Item>();
    const addShared = (id: string) => {
      const item = shared.get(id);
      if (!item || copies.has(id)) return;
      copies.set(id, item);
      for (const use of item.uses) if (use !== id) addShared(use);
    };
    for (const item of group) for (const use of item.uses) addShared(use);
    const items = [...copies.values(), ...group].sort((a, b) => RANK[a.kind] - RANK[b.kind]);
    components.push({
      entities: group.filter((i) => i.kind === 'point' || i.kind === 'curve').map((i) => i.id),
      items,
      structure: structureOf(items, mapped.fixedCurves),
    });
  }
  return { components, overdetermined };
}

function structureOf(items: Item[], fixedCurves: ReadonlySet<string>): string {
  const prims = items.flatMap((item) =>
    item.prims.map((prim) =>
      Object.fromEntries(Object.entries(prim).filter(([key]) => !VALUE_KEYS.has(key))),
    ),
  );
  const fixed = items.filter((i) => fixedCurves.has(i.id)).map((i) => i.id);
  return JSON.stringify([prims, fixed]);
}
