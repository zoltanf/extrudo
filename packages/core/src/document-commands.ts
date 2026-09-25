/**
 * The built-in document commands: document settings, parameters, timeline
 * features, the timeline marker, body metadata. Feature-specific commands
 * (edit a sketch, change an extrude) come with their features.
 */
import { CommandError, type DocumentDraft, defineCommand } from './commands';
import type { BodyId, FeatureId, ParameterId } from './ids';
import {
  type BodyMeta,
  type Feature,
  type FeatureInputs,
  PARAMETER_NAME,
  type Parameter,
  type Settings,
} from './schema';

export const renameDocument = defineCommand<{ name: string }>(
  'document.rename',
  'Rename document',
  (draft, { name }) => {
    draft.name = requireName(name);
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
  if (changes.name !== undefined && changes.name !== parameter.name) {
    checkParameterName(draft, changes.name);
  }
  Object.assign(parameter, changes);
});

export const removeParameter = defineCommand<{ id: ParameterId }>(
  'parameter.remove',
  'Delete parameter',
  (draft, { id }) => {
    findParameter(draft, id);
    draft.parameters = draft.parameters.filter((p) => p.id !== id);
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

/** Replaces the named inputs; inputs not named keep their values. */
export const updateFeatureInputs = defineCommand<{ id: FeatureId; inputs: FeatureInputs }>(
  'feature.inputs',
  'Edit feature',
  (draft, { id, inputs }) => {
    Object.assign(findFeature(draft, id).inputs, inputs);
  },
);

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

export const removeFeature = defineCommand<{ id: FeatureId }>(
  'feature.remove',
  'Delete feature',
  (draft, { id }) => {
    const index = draft.features.findIndex((f) => f.id === id);
    if (index < 0) throw new CommandError(`Feature ${id} doesn't exist.`);
    draft.features.splice(index, 1);
    if (index < draft.timelineMarker) draft.timelineMarker -= 1;
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

/** Creates the body's metadata or changes part of it. */
export const updateBody = defineCommand<{ id: BodyId; changes: Partial<BodyMeta> }>(
  'body.update',
  'Change body',
  (draft, { id, changes }) => {
    const body = draft.bodies[id];
    if (body) {
      Object.assign(body, changes);
    } else {
      const { name, visible = true, ...rest } = changes;
      draft.bodies[id] = { name: requireName(name ?? ''), visible, ...rest };
    }
  },
);

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
  if (draft.parameters.some((p) => p.name === name)) {
    throw new CommandError(`A parameter named "${name}" already exists.`);
  }
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new CommandError("The name can't be empty.");
  return trimmed;
}
