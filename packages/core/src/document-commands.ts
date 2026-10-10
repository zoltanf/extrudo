/**
 * The built-in document commands: document settings, parameters, timeline
 * features, the timeline marker, body metadata. Feature-specific commands
 * (edit a sketch, change an extrude) come with their features.
 */
import { CommandError, type DocumentDraft, defineCommand } from './commands';
import { isReservedName } from './expr/evaluate';
import { mentions, parameterNames, renameReferences } from './expr/parameters';
import { dropFeatureFromGroups, normalizeGroupsInPlace } from './groups';
import type { BodyId, FeatureId, ParameterId } from './ids';
import { makesFeatures } from './plugin-feature';
import {
  type BodyMeta,
  type ExtrudoDocument,
  type Feature,
  type FeatureInputs,
  PARAMETER_NAME,
  type Parameter,
  type Settings,
} from './schema';
import { referencedFeatures } from './timeline';

export const renameDocument = defineCommand<{ name: string }>(
  'document.rename',
  'Rename document',
  (draft, { name }) => {
    draft.name = requireName(name);
  },
);

/**
 * Brings back a saved version's content (FR-PRJ-03, P2-14): its settings,
 * parameters, timeline, groups, bodies, views, configurations and attachments.
 * The document's ID, name and dates stay, so the project stays the same
 * project. One undo step. Attachments come back with the rest: a version's
 * texts need the fonts it carried (P4-03b), and its groups come back with the
 * timeline they were folds of (ADR-0065 §1).
 */
export const restoreVersion = defineCommand<{ doc: ExtrudoDocument }>(
  'document.restoreVersion',
  'Restore version',
  (draft, { doc }) => {
    draft.settings = doc.settings;
    draft.parameters = doc.parameters;
    draft.features = doc.features;
    draft.timelineMarker = doc.timelineMarker;
    draft.bodies = doc.bodies;
    draft.views = doc.views;
    draft.configurations = doc.configurations;
    draft.attachments = doc.attachments;
    draft.groups = doc.groups;
    normalizeGroupsInPlace(draft);
  },
);

export const updateSettings = defineCommand<Partial<Settings>>(
  'document.settings',
  'Change document settings',
  (draft, changes) => {
    Object.assign(draft.settings, changes);
  },
);

export const addParameter = defineCommand<{ parameter: Parameter }>(
  'parameter.add',
  'Add parameter',
  (draft, { parameter }) => {
    checkParameterName(draft, parameter.name);
    if (draft.parameters.some((p) => p.id === parameter.id)) {
      throw new CommandError(`Parameter ${parameter.id} already exists.`);
    }
    draft.parameters.push(parameter);
  },
);

export const updateParameter = defineCommand<{
  id: ParameterId;
  changes: Partial<Omit<Parameter, 'id'>>;
}>('parameter.update', 'Edit parameter', (draft, { id, changes }) => {
  const parameter = findParameter(draft, id);
  const oldName = parameter.name;
  if (changes.name !== undefined && changes.name !== oldName) {
    checkParameterName(draft, changes.name);
  }
  Object.assign(parameter, changes);
  // A rename carries over to every expression that uses the parameter,
  // sketch dimensions included.
  const newName = parameter.name;
  if (newName !== oldName) {
    for (const p of draft.parameters) {
      if (mentions(p.expression, oldName)) {
        p.expression = renameReferences(p.expression, oldName, newName);
      }
    }
    for (const { holder } of featureExpressions(draft)) {
      if (mentions(holder.expr, oldName))
        holder.expr = renameReferences(holder.expr, oldName, newName);
    }
  }
});

/**
 * Deletes a parameter and every value a configuration stored for it, so no
 * configuration is left naming something that isn't there (ADR-0059 §2). One
 * undo step.
 */
export const removeParameter = defineCommand<{ id: ParameterId }>(
  'parameter.remove',
  'Delete parameter',
  (draft, { id }) => {
    const { name } = findParameter(draft, id);
    refuseIfUsed(draft, name);
    draft.parameters = draft.parameters.filter((p) => p.id !== id);
    for (const configuration of draft.configurations ?? []) {
      if (id in configuration.values) delete configuration.values[id];
    }
  },
);

/**
 * Inserts a feature at the timeline marker (FR-TL-02), or at `index`. The
 * marker moves past the new feature when it lands in the active part.
 */
export const insertFeature = defineCommand<{ feature: Feature; index?: number }>(
  'feature.insert',
  'Add feature',
  (draft, { feature, index = draft.timelineMarker }) => {
    if (draft.features.some((f) => f.id === feature.id)) {
      throw new CommandError(`Feature ${feature.id} already exists.`);
    }
    if (!Number.isInteger(index) || index < 0 || index > draft.features.length) {
      throw new CommandError(`Can't insert a feature at position ${index}.`);
    }
    draft.features.splice(index, 0, feature);
    if (index <= draft.timelineMarker) draft.timelineMarker += 1;
  },
);

/**
 * Replaces the named inputs; inputs not named keep their values. With
 * `replace`, the feature's inputs become exactly `inputs` (a feature dialog's
 * OK, P2-05: an input its dialog now hides goes away).
 */
export const updateFeatureInputs = defineCommand<{
  id: FeatureId;
  inputs: FeatureInputs;
  replace?: boolean;
}>('feature.inputs', 'Edit feature', (draft, { id, inputs, replace = false }) => {
  const feature = findFeature(draft, id);
  if (replace) feature.inputs = { ...inputs };
  else Object.assign(feature.inputs, inputs);
});

export const renameFeature = defineCommand<{ id: FeatureId; name: string }>(
  'feature.rename',
  'Rename feature',
  (draft, { id, name }) => {
    findFeature(draft, id).name = requireName(name);
  },
);

export const setFeatureSuppressed = defineCommand<{ id: FeatureId; suppressed: boolean }>(
  'feature.suppress',
  'Suppress feature',
  (draft, { id, suppressed }) => {
    findFeature(draft, id).suppressed = suppressed;
  },
);

/** Shows or hides features' own geometry in the view (P1-12): a browser eye, one undo step. */
export const setFeatureVisibility = defineCommand<{ ids: readonly FeatureId[]; visible: boolean }>(
  'feature.visibility',
  'Change visibility',
  (draft, { ids, visible }) => {
    for (const id of ids) {
      const feature = findFeature(draft, id);
      if (visible) delete feature.visible;
      else feature.visible = false;
    }
  },
);

/** Whether a feature's own geometry is shown (`visible` is absent or `true`). */
export function isFeatureVisible(feature: Pick<Feature, 'visible'>): boolean {
  return feature.visible !== false;
}

/**
 * Deletes a feature. Refused, with a message, while other features refer to
 * its geometry, or while an expression outside it uses one of its named
 * dimensions: those would break (P1-12). The timeline's groups follow the
 * deletion (ADR-0065 §1): a group that loses a member keeps it, a group that
 * was one feature long is dropped.
 */
export const removeFeature = defineCommand<{ id: FeatureId }>(
  'feature.remove',
  'Delete feature',
  (draft, { id }) => {
    const index = draft.features.findIndex((f) => f.id === id);
    if (index < 0) throw new CommandError(`Feature ${id} doesn't exist.`);
    const feature = draft.features[index] as Feature;
    const users = featuresReferring(draft, id);
    if (users.length > 0) {
      throw new CommandError(
        `Can't delete ${feature.name}: ${listOf(users)} ${users.length === 1 ? 'uses' : 'use'} it. Change or delete ${users.length === 1 ? 'that' : 'those'} first.`,
      );
    }
    const own = new Set<object>();
    for (const input of Object.values(feature.inputs)) {
      if (input.kind === 'sketchData')
        for (const d of Object.values(input.sketch.dimensions)) own.add(d);
    }
    for (const holder of own as Set<{ paramName?: string }>) {
      if (!holder.paramName) continue;
      try {
        refuseIfUsed(draft, holder.paramName, own);
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        throw new CommandError(`Can't delete ${feature.name}: ${error.message}`);
      }
    }
    dropFeatureFromGroups(draft, index);
    draft.features.splice(index, 1);
    if (index < draft.timelineMarker) draft.timelineMarker -= 1;
    normalizeGroupsInPlace(draft);
  },
);

/** Rolls the model back to `index` features (FR-TL-02). */
export const moveTimelineMarker = defineCommand<{ index: number }>(
  'timeline.marker',
  'Move timeline marker',
  (draft, { index }) => {
    if (!Number.isInteger(index) || index < 0 || index > draft.features.length) {
      throw new CommandError(`Can't move the timeline marker to ${index}.`);
    }
    draft.timelineMarker = index;
  },
);

/** Body metadata fields that can be cleared back to their defaults. */
export type ClearableBodyField = 'color' | 'opacity' | 'ghost';

/**
 * How a body is shown: `'shown'`, `'ghost'` (a grey see-through shape that
 * takes no part in picking or anything else) or `'hidden'` (ADR-0030's
 * amendment, 2026-10-09). A body with no metadata at all is `'shown'`. The
 * stored form is `visible: false` plus `ghost: true` for a ghost; the pair is
 * kept by `updateBody`, so no caller can store an invalid one.
 */
export function bodyDisplay(meta?: BodyMeta): 'shown' | 'ghost' | 'hidden' {
  if (!meta || meta.visible) return 'shown';
  return meta.ghost ? 'ghost' : 'hidden';
}

/**
 * Creates the body's metadata or changes part of it; `clear` removes
 * optional fields (the default colour, opaque again, a ghost). A name is
 * trimmed and can't be empty.
 *
 * The ghost pair rule (ADR-0030's amendment): `ghost: true` makes the body
 * hidden (`visible: false`), and a body that ends up `visible: true` never
 * keeps `ghost`. So `ghost` is stored only as `true` and only with
 * `visible: false`; hiding a ghost passes `clear: ['ghost']` (what
 * `BodyActions.setDisplay` does).
 */
export const updateBody = defineCommand<{
  id: BodyId;
  changes: Partial<BodyMeta>;
  clear?: readonly ClearableBodyField[];
}>('body.update', 'Change body', (draft, { id, changes, clear = [] }) => {
  const { name, visible, ghost, ...rest } = changes;
  let body = draft.bodies[id];
  if (!body) {
    body = { name: requireName(name ?? ''), visible: visible ?? true };
    draft.bodies[id] = body;
  } else {
    if (name !== undefined) body.name = requireName(name);
    if (visible !== undefined) body.visible = visible;
  }
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) Object.assign(body, { [key]: value });
  }
  for (const key of clear) delete body[key];
  if (ghost !== undefined) {
    if (ghost) body.ghost = true;
    else delete body.ghost;
  }
  // The pair rule: a ghost is hidden, and a visible body is never a ghost.
  if (ghost === true) body.visible = false;
  if (body.visible) delete body.ghost;
});

/**
 * Stores metadata for bodies that have none (ADR-0030): the names the app
 * gave them when they first appeared ("Body3"). Bodies that already have
 * metadata keep it. The app amends this into the undo step that made the
 * bodies (`DocumentState.amend`), so undo and redo take the names with them.
 */
export const nameBodies = defineCommand<{ bodies: Readonly<Record<BodyId, BodyMeta>> }>(
  'body.name',
  'Name bodies',
  (draft, { bodies }) => {
    for (const [id, meta] of Object.entries(bodies) as [BodyId, BodyMeta][]) {
      if (draft.bodies[id]) continue;
      draft.bodies[id] = { ...meta, name: requireName(meta.name) };
    }
  },
);

/**
 * The names new bodies get, in the order given: "Body1", "Body2"…, the
 * lowest numbers that no stored body (live or gone) and no earlier new body
 * uses. Pure, so the name the browser shows before it is stored is the one
 * that gets stored.
 */
export function newBodyNames(
  doc: Pick<ExtrudoDocument, 'bodies'>,
  ids: readonly BodyId[],
): Record<BodyId, string> {
  const taken = new Set(Object.values(doc.bodies).map((m) => m.name));
  const names = {} as Record<BodyId, string>;
  let next = 1;
  for (const id of ids) {
    while (taken.has(`Body${next}`)) next++;
    const name = `Body${next}`;
    names[id] = name;
    taken.add(name);
  }
  return names;
}

/**
 * Names of the features whose references point into feature `id`: `<id>/…`
 * reference IDs (a sketch's profiles), and bodies it made (`<id>:<n>`, a
 * Remove or an extrude's picked bodies, ADR-0030).
 */
function featuresReferring(draft: DocumentDraft, id: FeatureId): string[] {
  const prefix = `${id}/`;
  const bodies = `${id}:`;
  // A script's geometry is its generated features' (ADR-0070 §1), and a
  // plugin feature's (ADR-0077 §3): any stored reference into it — a face's
  // name, an edge's, a body, a profile — uses it.
  const type = draft.features.find((f) => f.id === id)?.type;
  const script = type !== undefined && makesFeatures(type);
  const ids = new Set<string>(draft.features.map((f) => f.id));
  return draft.features
    .filter(
      (f) =>
        f.id !== id &&
        ((script && referencedFeatures(f as Feature, ids).includes(id)) ||
          Object.values(f.inputs).some(
            (input) =>
              input.kind === 'ref' &&
              input.refs.some(
                (ref) =>
                  ref.id === id ||
                  ref.id.startsWith(prefix) ||
                  (ref.kind === 'body' && ref.id.startsWith(bodies)),
              ),
          )),
    )
    .map((f) => f.name);
}

function findFeature(draft: DocumentDraft, id: FeatureId) {
  const feature = draft.features.find((f) => f.id === id);
  if (!feature) throw new CommandError(`Feature ${id} doesn't exist.`);
  return feature;
}

function findParameter(draft: DocumentDraft, id: ParameterId) {
  const parameter = draft.parameters.find((p) => p.id === id);
  if (!parameter) throw new CommandError(`Parameter ${id} doesn't exist.`);
  return parameter;
}

function checkParameterName(draft: DocumentDraft, name: string): void {
  if (!PARAMETER_NAME.test(name)) {
    throw new CommandError(
      `"${name}" isn't a valid parameter name: use a letter or _ followed by letters, digits or _.`,
    );
  }
  if (isReservedName(name)) {
    throw new CommandError(`"${name}" is a unit, function or constant; pick another name.`);
  }
  if (parameterNames(draft).has(name)) {
    throw new CommandError(`A parameter named "${name}" already exists.`);
  }
}

/** Every expression inside features: `expr` inputs and sketch dimensions. */
function* featureExpressions(draft: DocumentDraft): Generator<{
  feature: Feature;
  holder: { expr: string; paramName?: string; driven?: boolean };
  dimension: boolean;
}> {
  for (const feature of draft.features) {
    for (const input of Object.values(feature.inputs)) {
      if (input.kind === 'expr') yield { feature, holder: input, dimension: false };
      else if (input.kind === 'sketchData') {
        for (const holder of Object.values(input.sketch.dimensions)) {
          yield { feature, holder, dimension: true };
        }
      }
    }
  }
}

/**
 * Refuses, with a message naming them, if any expression outside `except`
 * refers to the parameter `name` (before deleting it, or the dimensions
 * that carry it). Parameters and named sketch dimensions are listed by
 * name, feature inputs and other dimensions by their feature.
 */
export function refuseIfUsed(
  draft: DocumentDraft,
  name: string,
  except: ReadonlySet<object> = new Set(),
): void {
  const users = new Set<string>();
  for (const p of draft.parameters) {
    if (p.name !== name && mentions(p.expression, name)) users.add(`\`${p.name}\``);
  }
  for (const { feature, holder, dimension } of featureExpressions(draft)) {
    // A driven dimension's expression only records what it measured.
    if (except.has(holder) || holder.driven || holder.paramName === name) continue;
    if (!mentions(holder.expr, name)) continue;
    users.add(dimension && holder.paramName ? `\`${holder.paramName}\`` : feature.name);
  }
  if (users.size > 0) {
    const list = [...users];
    throw new CommandError(
      `\`${name}\` is used by ${listOf(list)}. Change ${list.length === 1 ? 'that' : 'those'} first.`,
    );
  }
}

function listOf(items: string[]): string {
  return items.length === 1
    ? (items[0] as string)
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new CommandError("The name can't be empty.");
  return trimmed;
}
