/**
 * Part containers as components (P6-25 S12b, ADR-0144, ADR-0081). Each
 * `App::Part` from which a body came into the design is one Extrudo
 * component named by its label; components don't nest, so a body joins its
 * **innermost** part's, and an outer part with no body of its own gets none
 * (as `packages/f3d` makes a nested component stand alone). A compound's
 * members (two bodies or more) and a link to a part's copies form a
 * component of their own, named by the compound's or the link's label.
 * Membership is stamped on the bodies and on the features that make them
 * (ADR-0081 §2), in one undo step; placements and visibility are untouched.
 */
import type { Design } from '@extrudo/api';
import { COMPONENT_NAME_MAX, type ComponentId, setFeatureComponent } from '@extrudo/core';
import { append } from './lists';
import type { FcDocument, FcObject } from './model';
import { cleanName } from './names';
import { parentsOf } from './sketch-place';

/** The most components one import makes; past it the bodies stay loose. */
export const MAX_IMPORT_COMPONENTS = 1_000;
/** How deep containers are followed to find a body's parts. */
const MAX_DEPTH = 64;

/** What one group of bodies is: a part's, a compound's members, a link to a part's copies. */
export interface BodyGroup {
  readonly kind: 'part' | 'compound' | 'link';
  /** The FreeCAD object it is named after. */
  readonly object: FcObject;
  readonly bodies: readonly string[];
}

export interface ComponentMade {
  readonly id: string;
  readonly name: string;
  readonly kind: BodyGroup['kind'];
  readonly object: string;
  readonly bodies: number;
}

export interface ComponentsReport {
  /** The components made, in browser order. */
  readonly made: readonly ComponentMade[];
  /**
   * How many `App::Part`s the file has, and how many gave no component: empty, holding only
   * other parts, none of whose shapes came in as bodies, or past `MAX_IMPORT_COMPONENTS`.
   */
  readonly parts: number;
  readonly partsWithout: number;
  /** Groups past `MAX_IMPORT_COMPONENTS`, whose bodies stay loose. */
  readonly overLimit: number;
}

/**
 * The groups the final shapes' bodies form: a link to a part's copies, a
 * compound's members (two bodies or more), else the innermost part around
 * the final shape's object, if any.
 */
export function componentGroups(
  doc: FcDocument,
  shapes: readonly { readonly object: FcObject }[],
  bodiesOf: ReadonlyMap<string, readonly string[]>,
  partial: ReadonlyMap<string, readonly string[]>,
  linksToParts: ReadonlySet<string>,
  compoundsAsMembers: ReadonlySet<string>,
): BodyGroup[] {
  const out: BodyGroup[] = [];
  const parts = new Map<string, { object: FcObject; bodies: string[] }>();
  for (const f of shapes) {
    const name = f.object.name;
    const bodies = [...(bodiesOf.get(name) ?? []), ...(partial.get(name) ?? [])];
    if (bodies.length === 0) continue;
    if (linksToParts.has(name)) out.push({ kind: 'link', object: f.object, bodies });
    else if (compoundsAsMembers.has(name) && bodies.length >= 2)
      out.push({ kind: 'compound', object: f.object, bodies });
    else {
      const part = partsAround(doc, f.object)?.[0];
      if (!part) continue;
      const g = parts.get(part.name) ?? { object: part, bodies: [] };
      append(g.bodies, bodies);
      parts.set(part.name, g);
    }
  }
  for (const g of parts.values()) out.push({ kind: 'part', ...g });
  return out;
}

/** The `App::Part`s around `o`, innermost first; `undefined` for containers in a loop. */
export function partsAround(doc: FcDocument, o: FcObject): FcObject[] | undefined {
  const parent = parentsOf(doc);
  const out: FcObject[] = [];
  const seen = new Set<string>([o.name]);
  for (let p = parent.get(o.name), depth = 0; p; p = parent.get(p.name), depth++) {
    if (seen.has(p.name) || depth >= MAX_DEPTH) return undefined;
    seen.add(p.name);
    if (p.type === 'App::Part') out.push(p);
  }
  return out;
}

/**
 * A component name from a label, under ADR-0081's rules as `packages/f3d`
 * makes them: cleaned, cut to 90 characters (room for " (12)" within the
 * 100), unique ignoring case ("Name (2)", "Name (3)" …), "Component1" for an
 * empty one.
 */
export function uniqueComponentName(label: string, taken: Set<string>): string {
  // Cut in UTF-16 units (the schema's count), never inside a surrogate pair (S13).
  let cut = label.trim().slice(0, COMPONENT_NAME_MAX - 10);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  const base = cut.trim();
  const at = (n: number) => (base ? (n === 1 ? base : `${base} (${n})`) : `Component${n}`);
  let n = 1;
  while (taken.has(at(n).toLowerCase())) n++;
  const chosen = at(n);
  taken.add(chosen.toLowerCase());
  return chosen;
}

/**
 * Makes one component per group with bodies, in document order of the
 * objects they are named after, and stamps every feature whose live bodies
 * all joined one component. One undo step; nothing when there is no group.
 */
export function makeComponents(
  design: Design,
  doc: FcDocument,
  groups: readonly BodyGroup[],
  live: readonly string[],
  maxComponents = MAX_IMPORT_COMPONENTS,
): ComponentsReport {
  const order = new Map(doc.objects.map((o, i) => [o.name, i]));
  const withBodies = groups
    .filter((g) => g.bodies.length > 0)
    .sort((a, b) => (order.get(a.object.name) ?? 0) - (order.get(b.object.name) ?? 0));
  const kept = withBodies.slice(0, maxComponents);
  const named = new Set(kept.filter((g) => g.kind === 'part').map((g) => g.object.name));
  const parts = doc.objects.filter((o) => o.type === 'App::Part').length;
  const report = (made: ComponentMade[]): ComponentsReport => ({
    made,
    parts,
    partsWithout: parts - named.size,
    overLimit: withBodies.length - kept.length,
  });
  if (kept.length === 0) return report([]);
  const taken = new Set((design.doc.components ?? []).map((c) => c.name.toLowerCase()));
  const made: ComponentMade[] = [];
  const of = new Map<string, ComponentId>();
  design.transaction('Group the bodies into components', () => {
    for (const g of kept) {
      const name = uniqueComponentName(cleanName(g.object.label, g.object.name), taken);
      const { id } = design.component(name, { bodies: [...g.bodies] });
      for (const b of g.bodies) of.set(b, id);
      made.push({ id, name, kind: g.kind, object: g.object.name, bodies: g.bodies.length });
    }
    // A feature joins when every live body it makes (`<feature>:<n>`) is in one component.
    const byFeature = new Map<string, Set<ComponentId | undefined>>();
    for (const b of live) {
      const at = b.lastIndexOf(':');
      if (at <= 0) continue;
      const f = b.slice(0, at);
      const set = byFeature.get(f) ?? new Set();
      set.add(of.get(b));
      byFeature.set(f, set);
    }
    const features = new Set(design.doc.features.map((f) => f.id as string));
    for (const [feature, set] of byFeature) {
      const [only] = set;
      if (set.size !== 1 || only === undefined) continue;
      if (!features.has(feature)) continue;
      design.state.dispatch(setFeatureComponent({ id: feature as never, component: only }));
    }
  });
  return report(made);
}
