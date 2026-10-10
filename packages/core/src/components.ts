/**
 * Components (P6-05, ADR-0081): named, user-made sets of bodies in one design.
 *
 * A component is metadata over bodies: `doc.components` holds the records
 * (name and display state, no transform) and each body's metadata names the
 * component it belongs to (`BodyMeta.component`), so a body is in at most one
 * by construction. A body with no `component` is **loose**. Where a body that
 * has no metadata yet belongs is §2's rule, `componentOfBody`; the app stores
 * its answer when it first names the body, and the CLI and the API read the
 * same rule, so a component's bodies agree everywhere.
 *
 * Nothing in the recompute, the cache keys or the naming reads components:
 * every command here changes metadata only and recomputes nothing.
 */
import { CommandError, type CommandFactory, type DocumentDraft, defineCommand } from './commands';
import { bodyDisplay, newBodyNames } from './document-commands';
import type { BodyId, ComponentId, FeatureId } from './ids';
import type { BodyMeta, Component, ExtrudoDocument } from './schema';
import { scriptOfGenerated } from './script';

/** A piece's body ID → the body it was broken off (the kernel's `origins`, ADR-0081 §8). */
export type BodyOrigins = Readonly<Record<BodyId, BodyId>>;

/** How a body or a component is drawn: shown, as a ghost, or hidden. */
export type ComponentDisplay = 'shown' | 'ghost' | 'hidden';

/** The longest component name (the schema's limit). */
export const COMPONENT_NAME_MAX = 100;

/**
 * The component body `id` belongs to, by ADR-0081 §2's rule:
 *
 * 1. the body has stored metadata: its `component` (absent = loose);
 * 2. else it is a piece broken off another body (`origins`): that body's
 *    component, by this same rule (a cycle gives `undefined`);
 * 3. else the stamp of the feature that made it (the ID up to its last `:`;
 *    a Script's or plugin's generated feature takes its stored feature's,
 *    `scriptOfGenerated`);
 * 4. else loose (`undefined`).
 */
export function componentOfBody(
  doc: Pick<ExtrudoDocument, 'bodies' | 'features'>,
  id: BodyId,
  origins?: BodyOrigins,
): ComponentId | undefined {
  const seen = new Set<BodyId>();
  let body = id;
  for (;;) {
    const meta = doc.bodies[body];
    if (meta) return meta.component;
    const source = origins?.[body];
    if (source === undefined) return stampOfBody(doc, body);
    seen.add(body);
    if (seen.has(source)) return undefined;
    body = source;
  }
}

/**
 * The making feature's stamp alone (§2 rule 3), whatever the body's stored
 * metadata says: what the emitter compares a stored membership with.
 */
export function stampOfBody(
  doc: Pick<ExtrudoDocument, 'features'>,
  id: BodyId,
): ComponentId | undefined {
  const at = id.lastIndexOf(':');
  if (at <= 0) return undefined;
  const featureId = id.slice(0, at);
  const own = doc.features.find((f) => f.id === featureId);
  if (own) return own.component;
  const script = scriptOfGenerated(featureId, new Set(doc.features.map((f) => f.id)));
  return script === undefined ? undefined : doc.features.find((f) => f.id === script)?.component;
}

/**
 * The live bodies grouped by component: every component in `doc.components`
 * order (an empty one too, with no bodies), then the loose bodies. Bodies keep
 * the order of `live` within each group; a body naming a component the design
 * doesn't have is loose.
 */
export function componentMembers(
  doc: Pick<ExtrudoDocument, 'bodies' | 'features' | 'components'>,
  live: readonly BodyId[],
  origins?: BodyOrigins,
): { components: { id: ComponentId; bodies: BodyId[] }[]; loose: BodyId[] } {
  const components = (doc.components ?? []).map((c) => ({ id: c.id, bodies: [] as BodyId[] }));
  const byId = new Map(components.map((c) => [c.id, c]));
  const loose: BodyId[] = [];
  for (const id of live) {
    const component = componentOfBody(doc, id, origins);
    const group = component === undefined ? undefined : byId.get(component);
    if (group) group.bodies.push(id);
    else loose.push(id);
  }
  return { components, loose };
}

/** "Component1", "Component2"…: the lowest number no component's name uses (case-insensitively). */
export function newComponentName(doc: Pick<ExtrudoDocument, 'components'>): string {
  const taken = takenNames(doc);
  let n = 1;
  while (taken.has(`component${n}`)) n++;
  return `Component${n}`;
}

/** "Lid (2)", "Lid (3)"…: the lowest free copy name of `name` (Copy Component, ADR-0081 §3). */
export function copyComponentName(doc: Pick<ExtrudoDocument, 'components'>, name: string): string {
  const taken = takenNames(doc);
  let n = 2;
  while (taken.has(`${name} (${n})`.toLowerCase())) n++;
  return `${name} (${n})`;
}

/**
 * How a body is drawn given its component (ADR-0081 §6): a hidden component
 * hides its bodies, a ghost component draws them as ghosts unless the body
 * itself is hidden, and otherwise the body's own state holds. The body keeps
 * its own state underneath, so showing the component again restores it.
 */
export function effectiveBodyDisplay(
  meta: BodyMeta | undefined,
  component: Component | undefined,
): ComponentDisplay {
  const own = bodyDisplay(meta);
  if (!component || component.visible) return own;
  if (!component.ghost) return 'hidden';
  return own === 'hidden' ? 'hidden' : 'ghost';
}

/** A new component, optionally named and with bodies in it. One undo step. */
export const addComponent = defineCommand<{
  id: ComponentId;
  name?: string;
  bodies?: readonly BodyId[];
}>('component.add', 'New component', (draft, { id, name, bodies = [] }) => {
  if ((draft.components ?? []).some((c) => c.id === id)) {
    throw new CommandError(`Component ${id} already exists.`);
  }
  const chosen = name === undefined ? newComponentName(draft) : componentName(draft, name);
  draft.components = [...(draft.components ?? []), { id, name: chosen, visible: true }];
  joinComponent(draft, bodies, id);
});

/** Renames a component (F2); its own name in another case is allowed. One undo step. */
export const renameComponent = defineCommand<{ id: ComponentId; name: string }>(
  'component.rename',
  'Rename component',
  (draft, { id, name }) => {
    const component = findComponent(draft, id);
    component.name = componentName(draft, name, id);
  },
);

/**
 * Deletes a component: the record goes, and every body and feature that names
 * it forgets it (the bodies stay, loose). One undo step.
 */
export const removeComponent = defineCommand<{ id: ComponentId }>(
  'component.remove',
  'Delete component',
  (draft, { id }) => {
    findComponent(draft, id);
    const left = (draft.components ?? []).filter((c) => c.id !== id);
    if (left.length === 0) delete draft.components;
    else draft.components = left;
    for (const meta of Object.values(draft.bodies)) {
      if (meta.component === id) delete meta.component;
    }
    for (const feature of draft.features) {
      if (feature.component === id) delete feature.component;
    }
  },
);

const moveToComponent = defineCommand<{ ids: readonly BodyId[]; component: ComponentId | null }>(
  'component.bodies',
  'Move to component',
  (draft, { ids, component }) => {
    if (component === null) {
      for (const id of ids) {
        const meta = draft.bodies[id];
        if (meta) delete meta.component;
      }
      return;
    }
    findComponent(draft, component);
    joinComponent(draft, ids, component);
  },
);

/**
 * Puts bodies into a component, or (`null`) takes them out of theirs. A body
 * with no metadata yet gets its name as well, as `addComponent` gives it. One
 * undo step, "Move to component" or "Remove from component".
 */
export const setBodyComponent: CommandFactory<{
  ids: readonly BodyId[];
  component: ComponentId | null;
}> = Object.assign(
  (payload: { ids: readonly BodyId[]; component: ComponentId | null }) => ({
    ...moveToComponent(payload),
    label: payload.component === null ? 'Remove from component' : 'Move to component',
  }),
  { type: moveToComponent.type },
);

const changeComponentDisplay = defineCommand<{
  ids: readonly ComponentId[];
  display: ComponentDisplay;
}>('component.display', 'Show component', (draft, { ids, display }) => {
  for (const id of ids) {
    const component = findComponent(draft, id);
    // The pair rule of `updateBody`: a ghost is hidden, a visible one is never a ghost.
    component.visible = display === 'shown';
    if (display === 'ghost') component.ghost = true;
    else delete component.ghost;
  }
});

/**
 * Shows, ghosts or hides components, keeping the ghost pair rule. One undo
 * step, "Show component", "Ghost components"…
 */
export const setComponentDisplay: CommandFactory<{
  ids: readonly ComponentId[];
  display: ComponentDisplay;
}> = Object.assign(
  (payload: { ids: readonly ComponentId[]; display: ComponentDisplay }) => {
    const verb = { shown: 'Show', ghost: 'Ghost', hidden: 'Hide' }[payload.display];
    const noun = payload.ids.length === 1 ? 'component' : 'components';
    return { ...changeComponentDisplay(payload), label: `${verb} ${noun}` };
  },
  { type: changeComponentDisplay.type },
);

/**
 * Stamps a feature with the component its new bodies join, or (`null`) clears
 * the stamp. Copy Component uses it inside its dialog's transaction (ADR-0081
 * §3). One undo step.
 */
export const setFeatureComponent = defineCommand<{
  id: FeatureId;
  component: ComponentId | null;
}>('component.feature', 'Change component', (draft, { id, component }) => {
  const feature = draft.features.find((f) => f.id === id);
  if (!feature) throw new CommandError(`Feature ${id} doesn't exist.`);
  if (component === null) {
    delete feature.component;
    return;
  }
  findComponent(draft, component);
  feature.component = component;
});

function findComponent(draft: DocumentDraft, id: ComponentId) {
  const component = (draft.components ?? []).find((c) => c.id === id);
  if (!component) throw new CommandError(`Component ${id} doesn't exist.`);
  return component;
}

/** Component names in lower case, the way they are compared. */
function takenNames(doc: Pick<ExtrudoDocument, 'components'>): Set<string> {
  return new Set((doc.components ?? []).map((c) => c.name.toLowerCase()));
}

/** A checked, trimmed name; `self` is the component being renamed, whose own name is free. */
function componentName(
  doc: Pick<ExtrudoDocument, 'components'>,
  name: string,
  self?: ComponentId,
): string {
  const trimmed = name.trim();
  if (!trimmed) throw new CommandError("The name can't be empty.");
  if (trimmed.length > COMPONENT_NAME_MAX) {
    throw new CommandError(`A component's name can be at most ${COMPONENT_NAME_MAX} characters.`);
  }
  const clash = (doc.components ?? []).find(
    (c) => c.id !== self && c.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) throw new CommandError(`There is already a component named ${clash.name}.`);
  return trimmed;
}

/** Puts `ids` into `component`, naming the bodies that have no metadata yet. */
function joinComponent(draft: DocumentDraft, ids: readonly BodyId[], component: ComponentId): void {
  const names = newBodyNames(
    draft,
    ids.filter((id) => !draft.bodies[id]),
  );
  for (const id of ids) {
    const meta = draft.bodies[id];
    if (meta) meta.component = component;
    else draft.bodies[id] = { name: names[id] as string, visible: true, component };
  }
}
