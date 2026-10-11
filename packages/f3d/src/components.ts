/**
 * The file's components as Extrudo components (ADR-0081): one per component
 * of the file but the root (the root is the design itself, so its bodies stay
 * loose), named as in the file.
 *
 * Membership follows ADR-0081 §2: every Extrudo feature a timeline step makes
 * is stamped with that step's component, so the bodies it makes join it, and
 * a body that "Body to Component" moved elsewhere is put there explicitly.
 * An Extrudo component has no placement, nesting or second occurrence: a
 * component the file places away from its own origin, places more than once
 * or nests in another is imported once, where its own features make its
 * bodies, and the report says so.
 */
import type { ComponentHandle, Design } from '@extrudo/api';
import {
  type BodyId,
  type ComponentId,
  componentOfBody,
  setBodyComponent,
  setComponentDisplay,
  setFeatureComponent,
  updateBody,
} from '@extrudo/core';
import type { F3dBodyMove, F3dComponent } from './decode/component';
import type { ImportReport } from './map';
import type { F3dBody, F3dDesign, F3dFeature } from './model';

/** An f3d body as Extrudo knows it (the only body of an imported feature). */
export type BodyOf = (record: number) => { id: BodyId; index: number } | undefined;

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const isIdentity = (m: readonly number[]) =>
  m.every((v, i) => Math.abs(v - (IDENTITY[i] as number)) < 1e-9);

export class ComponentMapping {
  readonly #d: Design;
  readonly #f3d: F3dDesign;
  /** f3d component record → its Extrudo component. */
  readonly #handles = new Map<number, ComponentHandle>();
  readonly #moves = new Map<number, F3dBodyMove>();
  #current: ComponentId | undefined;
  /** How many Extrudo features there were when the current step began. */
  #count = 0;
  readonly #byId = new Map<number, F3dComponent>();
  /** A body record → the bodies a "Body to Component" made of it. */
  readonly #copies = new Map<number, number[]>();
  /**
   * A body record a "Body to Component" made → the body record it took
   * (one for one only): the same body to Extrudo, which moves none.
   */
  readonly aliases = new Map<number, number>();

  constructor(d: Design, f3d: F3dDesign, report: ImportReport) {
    this.#d = d;
    this.#f3d = f3d;
    for (const move of f3d.bodyMoves ?? []) {
      this.#moves.set(move.id, move);
      const [source] = move.sources;
      const [made] = move.made;
      if (move.sources.length === 1 && move.made.length === 1 && source !== undefined) {
        this.aliases.set(made as number, source);
        this.#copies.set(source, [...(this.#copies.get(source) ?? []), made as number]);
      }
    }
    const components = f3d.components ?? [];
    const byId = this.#byId;
    for (const c of components) byId.set(c.id, c);
    const taken = new Set<string>();
    const nested = new Map<number, string[]>();
    for (const c of components) {
      if (c.root) continue;
      const name = uniqueName(c.name, taken);
      const handle = d.component(name);
      this.#handles.set(c.id, handle);
      if (!c.visible) {
        d.state.dispatch(setComponentDisplay({ ids: [handle.id], display: 'hidden' }));
        report.notes.push(`Component ${name} is hidden, as in the file.`);
      }
      for (const note of placementNotes(c)) report.notes.push(`Component ${name}: ${note}`);
      const parent = c.parent === undefined ? undefined : byId.get(c.parent);
      if (parent && !parent.root) {
        const names = nested.get(parent.id) ?? [];
        names.push(name);
        nested.set(parent.id, names);
      }
    }
    // Extrudo components don't nest (ADR-0081 §9): the ones inside another stand alone.
    for (const [parent, names] of nested) {
      const inside = this.#handles.get(parent)?.name ?? 'another component';
      report.notes.push(
        names.length === 1
          ? `Component ${names[0]} is inside ${inside} in the file; here it stands alone.`
          : `Components ${list(names)} are inside ${inside} in the file; here they stand alone.`,
      );
    }
    this.#count = d.toJSON().features.length;
  }

  /** The Extrudo component of an f3d component record (none for the root). */
  of(record: number | undefined): ComponentHandle | undefined {
    return record === undefined ? undefined : this.#handles.get(record);
  }

  /**
   * Called at the start of each timeline step and once after the last one:
   * stamps the Extrudo features the previous step made with its component.
   */
  enter(feature: F3dFeature | undefined): void {
    // The import adds features at the end of the timeline.
    const features = this.#d.toJSON().features;
    if (this.#current !== undefined)
      for (const f of features.slice(this.#count))
        this.#d.state.dispatch(setFeatureComponent({ id: f.id, component: this.#current }));
    this.#count = features.length;
    this.#current = this.of(feature?.component)?.id;
  }

  /** Whether a timeline item is a "Body to Component". */
  isBodyMove(feature: F3dFeature): boolean {
    return this.#moves.has(feature.id);
  }

  /**
   * A "Body to Component": imported when Extrudo knows every body it takes
   * (the membership itself is set by {@link finish}); else why not.
   */
  bodyMove(feature: F3dFeature, bodyOf: BodyOf): string | undefined {
    const move = this.#moves.get(feature.id);
    if (!move || move.sources.length === 0) return 'the bodies it moves were not found';
    if (move.target === undefined) return 'the component it moves them to was not found';
    if (move.sources.some((b) => !bodyOf(b))) return 'a body it moves was not imported';
    return undefined;
  }

  /** Whether a body is shown: a body that was moved on is shown as its moved copy is. */
  shown(body: F3dBody): boolean {
    const moved = this.#movedTo(body.id);
    if (moved.length === 0) return body.visible;
    return this.#f3d.bodies.some((b) => moved.includes(b.id) && b.visible);
  }

  /** Whether a body can be seen: shown itself, in a component the file shows. */
  seen(body: F3dBody): boolean {
    const component = body.component === undefined ? undefined : this.#byId.get(body.component);
    return this.shown(body) && (component?.visible ?? true);
  }

  /** The bodies a body was moved on as (empty: it was not moved). */
  #movedTo(record: number): number[] {
    return this.#copies.get(record) ?? [];
  }

  /**
   * After the timeline: puts each body Extrudo knows into the component the
   * file has it in, where the stamp of the feature that made it says
   * otherwise (a moved body; a hidden body, whose stored metadata has no
   * component yet).
   */
  finish(bodyOf: BodyOf): void {
    const want = new Map<BodyId, { component: ComponentId | undefined; index: number }>();
    for (const body of this.#f3d.bodies) {
      // A body that was moved on: its moved copy says where it is.
      if (this.#movedTo(body.id).length > 0) continue;
      const known = bodyOf(body.id);
      if (!known) continue;
      want.set(known.id, { component: this.of(body.component)?.id, index: known.index });
    }
    for (const [id, { component, index }] of want) {
      const doc = this.#d.toJSON();
      if (componentOfBody(doc, id) === component) continue;
      if (component === undefined && !doc.bodies[id])
        this.#d.state.dispatch(updateBody({ id, changes: { name: `Body${index}` } }));
      else this.#d.state.dispatch(setBodyComponent({ ids: [id], component: component ?? null }));
    }
  }
}

/** A component name Extrudo takes: non-empty, at most 100 characters, unique in any case. */
function uniqueName(name: string, taken: Set<string>): string {
  // Trimmed again after the cut: Extrudo trims a name before it checks it is unique.
  const base = name.trim().slice(0, 90).trim();
  let chosen = base || 'Component1';
  for (let n = 2; taken.has(chosen.toLowerCase()); n++)
    chosen = base ? `${base} (${n})` : `Component${n}`;
  taken.add(chosen.toLowerCase());
  return chosen;
}

/** What the file says about a component's placement that an Extrudo component can't hold. */
function placementNotes(c: F3dComponent): string[] {
  const notes: string[] = [];
  if (c.occurrences.some((o) => o.transform && !isIdentity(o.transform)))
    notes.push(
      'the file places it away from its own origin; it is imported where its own features make its bodies.',
    );
  if (c.occurrences.length > 1)
    notes.push(`the file places it ${c.occurrences.length} times; it is imported once.`);
  return notes;
}

/** "A", "A and B", "A, B and C". */
function list(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
