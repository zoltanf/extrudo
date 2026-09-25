// Splits a sketch into independent components: primitives that share no
// unknowns. Geometry is linked to the points it references, constraints to
// every geometry they reference. A constraint that references only one
// geometry (a coordinate to a constant, a radius) links nothing, so anchoring
// to the origin doesn't couple components. Sketch parameters (driving
// dimensions) are fixed values, not unknowns, so each component gets a copy.
import type { SketchParam, SketchPrimitive } from '@salusoft89/planegcs';

type Prim = SketchPrimitive | SketchParam;

function referencedIds(p: SketchPrimitive): string[] {
  const ids: string[] = [];
  for (const [key, value] of Object.entries(p)) {
    if (key === 'id') continue;
    if (key.endsWith('_id') && typeof value === 'string') ids.push(value);
    else if (key.endsWith('_ids') && Array.isArray(value)) ids.push(...value);
    else if (value && typeof value === 'object' && 'o_id' in value) ids.push(String(value.o_id));
  }
  return ids;
}

export function splitComponents(prims: Prim[]): Prim[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  };
  const params: SketchParam[] = [];
  for (const p of prims) {
    if (p.type === 'param') {
      params.push(p);
      continue;
    }
    if (!parent.has(p.id)) parent.set(p.id, p.id);
    for (const ref of referencedIds(p)) union(p.id, ref);
  }
  const groups = new Map<string, Prim[]>();
  for (const p of prims) {
    if (p.type === 'param') continue;
    const root = find(p.id);
    let group = groups.get(root);
    if (!group) {
      group = [...params];
      groups.set(root, group);
    }
    group.push(p);
  }
  return [...groups.values()];
}
