/**
 * A plugin's custom features as feature dialogs (P6-03 slice 3, ADR-0077 §4,
 * §6): one `FeatureDialogSpec` per manifest feature, generated from its
 * inputs, so the dialog framework (pre-selection, picks as persistent refs,
 * parameter names, live preview, OK as one undo step) runs it like any built-in
 * dialog. Every spec has `type: 'plugin'`; what tells them apart is their
 * command (`plugin:<plugin id>:feature:<type>`, not a toolbar tool) and, for a
 * stored feature, its `handler` input and the plugin file it names.
 *
 * The design **carries the plugin file** (ADR-0077 §3): adding a feature writes
 * the file as an attachment, in the same undo step (`commitWith`), after its
 * bytes are stored and cached (`preparePluginAttachment`, the Import dialog's
 * pattern, ADR-0066 §0), so the preview finds them before OK.
 */
import {
  type Attachment,
  type AttachmentId,
  addAttachment,
  type Command,
  type ExtrudoDocument,
  type Feature,
  type FeatureInputs,
  type GeomRefKind,
  newId,
  PLUGIN_MEDIA_TYPE,
  type PluginFeature as PluginFeatureManifest,
  type PluginInput,
  pluginFeature,
  pluginFileOf,
  pluginInputKey,
  pluginSettings,
  type UnitKind,
} from '@extrudo/core';
import type { ProjectStore } from '@extrudo/storage';
import { type InstalledPlugin, type PluginFile, sha256Hex } from '@extrudo/storage';
import { ICON_NAMES, type IconName } from '../design-system';
import {
  commandId,
  type DialogContext,
  type DialogField,
  type DialogValues,
  type FeatureDialogSpec,
} from '../features/spec';
import { defaultFromInputs, defaultInputs } from '../features/values';
import { putAttachmentBytes } from '../sketch/fonts';
import { clearPendingPlugin, type PendingPlugin, pendingFor, pendingPluginStore } from './pending';
import type { PluginEntry } from './plugins';

/** What names a plugin: enough of an installed plugin or a design's copy. */
export type PluginIdentity = Pick<InstalledPlugin, 'id' | 'name' | 'version'>;

const UNITS: Record<'length' | 'angle' | 'none', UnitKind> = {
  length: 'length',
  angle: 'angle',
  none: 'unitless',
};

/** The command ID of a plugin's custom feature (`plugin:name-plate:feature:name-plate`). */
export const pluginFeatureCommand = (plugin: string, type: string) =>
  `plugin:${plugin}:feature:${type}`;

/** The icon a manifest names, if the design system has it; the Script's otherwise. */
export function pluginIcon(name: string | undefined): IconName {
  return name && (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : 'script';
}

/** "Min 1, max 10." for an `expr` input's hint (not enforced). */
function rangeHint(input: Extract<PluginInput, { kind: 'expr' }>): string | undefined {
  const { min, max } = input;
  if (min !== undefined && max !== undefined) return `Between ${min} and ${max}.`;
  if (min !== undefined) return `At least ${min}.`;
  if (max !== undefined) return `At most ${max}.`;
  return undefined;
}

const joinHint = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ') || undefined;

function fieldOf(input: PluginInput): DialogField {
  const base = { name: input.name, label: input.label };
  switch (input.kind) {
    case 'expr': {
      const hint = joinHint(input.hint, rangeHint(input));
      return {
        ...base,
        ...(hint && { hint }),
        kind: 'expression',
        unit: UNITS[input.unit],
        default: input.default === undefined ? '' : String(input.default),
      };
    }
    case 'bool':
      return {
        ...base,
        ...(input.hint && { hint: input.hint }),
        kind: 'toggle',
        default: input.default ?? false,
      };
    case 'enum':
      return {
        ...base,
        ...(input.hint && { hint: input.hint }),
        kind: 'choice',
        options: input.options.map((value) => ({ value, label: value })),
        default: input.default ?? input.options[0] ?? '',
      };
    case 'ref':
      return {
        ...base,
        ...(input.hint && { hint: input.hint }),
        kind: 'selection',
        accepts: input.accepts as readonly GeomRefKind[],
        min: 1,
        ...(!input.multiple && { max: 1 }),
      };
  }
}

/**
 * Puts a plugin's file with the design, ready for its dialog to preview
 * (ADR-0061 §2: bytes before the record that names them): the attachment the
 * design already has with this hash, else a new ID with the bytes stored and
 * cached. Returns the pending file; throws what the store throws.
 */
export async function preparePluginAttachment(deps: {
  plugin: PluginIdentity;
  bytes: Uint8Array;
  doc: ExtrudoDocument;
  projects: Pick<ProjectStore, 'writeAttachment'>;
}): Promise<PendingPlugin> {
  const pending = await storePluginAttachment(deps);
  pendingPluginStore.setState({
    pending: { ...pendingPluginStore.getState().pending, [deps.plugin.id]: pending },
  });
  return pending;
}

/** `preparePluginAttachment` without making the file pending (Update to <version> adds it itself). */
export async function storePluginAttachment(deps: {
  plugin: PluginIdentity;
  bytes: Uint8Array;
  doc: ExtrudoDocument;
  projects: Pick<ProjectStore, 'writeAttachment'>;
}): Promise<PendingPlugin> {
  const { plugin, bytes, doc } = deps;
  const sha256 = sha256Hex(bytes);
  const stored = Object.entries(doc.attachments ?? {}).find(
    ([, a]) => a.mediaType === PLUGIN_MEDIA_TYPE && a.sha256 === sha256,
  );
  let pending: PendingPlugin;
  if (stored) {
    pending = { id: stored[0] as AttachmentId, attachment: stored[1] as Attachment };
  } else {
    const id = newId<AttachmentId>();
    await deps.projects.writeAttachment(doc.id, sha256, bytes);
    pending = {
      id,
      attachment: {
        name: `${plugin.name} ${plugin.version}`,
        fileName: `${plugin.id}.extrudo-plugin`,
        mediaType: PLUGIN_MEDIA_TYPE,
        sha256,
        size: bytes.length,
      },
    };
    // In the cache before the document names it, so the preview's `addFile` finds it.
    putAttachmentBytes(id, bytes);
  }
  return pending;
}

/** The attachment a new feature of this plugin names: the pending one. */
function attachmentFor(plugin: string, ctx: DialogContext): AttachmentId {
  const stored = ctx.feature?.inputs.plugin;
  if (stored?.kind === 'file') return stored.id;
  return pendingFor(plugin)?.id ?? ('' as AttachmentId);
}

/**
 * The dialog of one custom feature of a plugin. `plugin` is who offers it (an
 * installed plugin, or the design's own copy of the file), `file` the plugin
 * read from its bytes.
 */
export function pluginFeatureSpec(
  plugin: PluginIdentity,
  file: PluginFile,
  feature: PluginFeatureManifest,
): FeatureDialogSpec {
  const fields: DialogField[] = [
    ...feature.inputs.map(fieldOf),
    {
      kind: 'info',
      name: '_plugin',
      label: 'Plugin',
      text: () => `Plugin: ${file.manifest.name} ${file.manifest.version}`,
    },
  ];
  const spec: FeatureDialogSpec = {
    ...pluginFeature,
    label: feature.label,
    icon: pluginIcon(feature.icon),
    type: 'plugin',
    command: {
      id: pluginFeatureCommand(plugin.id, feature.type),
      label: feature.label,
      icon: pluginIcon(feature.icon),
      category: 'create',
      group: `Plugins › ${plugin.name}`,
      hint: feature.hint ?? `${feature.label}, from the ${plugin.name} plugin.`,
    },
    fields,
    previewStyle: () => 'new',
    toInputs(values: DialogValues, ctx: DialogContext): FeatureInputs {
      const own = defaultInputs({ ...spec, fields }, values, ctx);
      const inputs: FeatureInputs = {
        plugin: { kind: 'file', id: attachmentFor(plugin.id, ctx) },
        handler: { kind: 'enum', value: feature.type },
      };
      for (const [name, input] of Object.entries(own)) inputs[pluginInputKey(name)] = input;
      return inputs;
    },
    fromInputs(inputs: FeatureInputs) {
      const named: FeatureInputs = {};
      for (const input of feature.inputs) {
        const stored = inputs[pluginInputKey(input.name)];
        if (stored) named[input.name] = stored;
      }
      return defaultFromInputs({ ...spec, fields }, named);
    },
    validate(values: DialogValues) {
      for (const input of feature.inputs) {
        if (input.kind === 'ref' && (values.refs[input.name]?.length ?? 0) === 0) {
          return { message: `Pick the ${input.label.toLowerCase()}.`, field: input.name };
        }
      }
      return undefined;
    },
    // The plugin file, in the same undo step as the first feature that names it.
    commitWith(_values: DialogValues, ctx: DialogContext): readonly Command<unknown>[] {
      if (ctx.feature) return [];
      const pending = pendingFor(plugin.id);
      if (!pending || ctx.doc.attachments?.[pending.id]) return [];
      clearPendingPlugin(plugin.id);
      return [addAttachment({ id: pending.id, attachment: pending.attachment })];
    },
  };
  return spec;
}

/** A custom feature an enabled plugin offers: its command, its dialog and who offers it. */
export interface PluginFeatureEntry {
  /** The command ID (`plugin:<plugin>:feature:<type>`). */
  command: string;
  spec: FeatureDialogSpec;
  plugin: InstalledPlugin;
}

/** Every custom feature of the enabled plugins (ADR-0077 §6's dynamic registry). */
export function pluginFeatureEntries(
  installed: readonly PluginEntry[] | undefined,
): PluginFeatureEntry[] {
  return (installed ?? [])
    .filter((entry) => entry.plugin.enabled && entry.file)
    .flatMap((entry) =>
      (entry.file?.manifest.features ?? []).map((feature) => {
        const spec = pluginFeatureSpec(entry.plugin, entry.file as PluginFile, feature);
        return { command: commandId(spec), spec, plugin: entry.plugin };
      }),
    );
}

/** The specs of `pluginFeatureEntries`. */
export const pluginDialogs = (installed: readonly PluginEntry[] | undefined) =>
  pluginFeatureEntries(installed).map((entry) => entry.spec);

/** The plugin file of a stored feature's attachment, read from the design (`loadDesignPlugins`). */
export type DesignPluginFiles = ReadonlyMap<AttachmentId, PluginFile>;

/**
 * The dialog of a stored `plugin` feature: the manifest feature its `handler`
 * names, from **the design's own copy** of the file (so a plugin that isn't
 * installed, or is installed in another version, still opens what was made).
 * `undefined` while the copy isn't read, or when it lacks the handler (the
 * feature's own error says why).
 */
export function specForPluginFeature(
  feature: Feature,
  files: DesignPluginFiles,
): FeatureDialogSpec | undefined {
  const id = pluginFileOf(feature);
  const file = id && files.get(id);
  if (!file) return undefined;
  const { handler } = pluginSettings(feature.inputs);
  const manifest = file.manifest.features.find((f) => f.type === handler);
  return manifest ? pluginFeatureSpec(file.manifest, file, manifest) : undefined;
}
