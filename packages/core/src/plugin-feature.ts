/**
 * The `plugin` feature (P6-03, ADR-0077 §3): a plugin's custom feature in the
 * timeline. Like a Script (ADR-0070), it **makes features** — the kernel runs
 * the plugin's handler in the script sandbox and evaluates what it added right
 * after it — but its code is a plugin file the design carries as an attachment,
 * and what changes between two of them is a dialog's typed inputs, not code.
 *
 * | Input | Type | Default |
 * |---|---|---|
 * | `plugin` | file: an attachment of media type `application/x-extrudo-plugin` | – |
 * | `handler` | enum, the manifest's feature `type` (no listed values) | – |
 * | `in:<name>` | the stored form of the manifest input's kind: `expr`, `bool`, `enum` or `ref` | – |
 *
 * The plugin's own inputs are stored under their manifest names prefixed `in:`
 * (`in:width`), each in the stored form of its kind, so an expression is
 * driven by parameters and a reference is named, fingerprinted and fixed like
 * any other. Core can't know a plugin's inputs, so the schema takes **any key
 * starting `in:`** whose value is one of those four kinds; the kernel checks
 * them against the manifest when it runs the plugin.
 *
 * Generated IDs and names are a Script's: `<feature>.f<n>`, "Name plate1 ›
 * Extrude1", and a stored reference into them is a dependency on the plugin
 * feature (`scriptOfGenerated`).
 */
import type { FeatureDefinition } from './features';
import type { FeatureId } from './ids';
import { PLUGIN_INPUT_NAME, PLUGIN_NAME } from './plugin';
import {
  type BoolInput,
  type EnumInput,
  type ExprInput,
  type Feature,
  type FeatureInputs,
  type FileInput,
  FileInputSchema,
  type Input,
  InputSchema,
  type RefInput,
} from './schema';
import { SCRIPT_TYPE } from './script';
import { z } from './zod';

export const PLUGIN_TYPE = 'plugin';

/** The feature type's label, and the base of its default names when a manifest gives none. */
export const PLUGIN_LABEL = 'Plugin feature';

/** What a plugin's own input names are stored under: `in:width`. */
export const PLUGIN_INPUT_PREFIX = 'in:';

/** The stored key of a plugin input: `in:<name>`. */
export const pluginInputKey = (name: string) => `${PLUGIN_INPUT_PREFIX}${name}`;

/** The stored kinds a plugin input may have (the manifest's `kind`s). */
const PLUGIN_STORED_KINDS: readonly Input['kind'][] = ['expr', 'bool', 'enum', 'ref'];

/** A key of a plugin input as it is stored. */
const PLUGIN_KEY = new RegExp(`^${PLUGIN_INPUT_PREFIX}${PLUGIN_INPUT_NAME.source.slice(1)}`);

/** One plugin input as it is stored: an expression, a toggle, a choice or references. */
export type PluginInputValue = ExprInput | BoolInput | EnumInput | RefInput;

/** A plugin feature's stored inputs. */
export type PluginInputs = {
  plugin: FileInput;
  handler: EnumInput;
} & { [key: `in:${string}`]: PluginInputValue };

const PluginHandlerSchema = z
  .strictObject({
    kind: z.literal('enum'),
    value: z.string().regex(PLUGIN_NAME, 'a custom feature type of the plugin, like name-plate'),
  })
  .meta({ input: { kind: 'enum' } });

const FIXED = new Set(['plugin', 'handler']);

export const PluginInputsSchema = z
  .object({
    plugin: FileInputSchema.describe(
      "The plugin file: an attachment of this design with the media type `application/x-extrudo-plugin`. The design carries its own copy, so it opens where the plugin isn't installed. Required.",
    ),
    handler: PluginHandlerSchema.describe(
      "Which of the plugin's custom features this is: a `type` its manifest lists under `features` (`name-plate`). Required.",
    ),
  })
  // Any stored input here, so a key this version doesn't know is reported as
  // one (the engine leaves it out with a warning, ADR-0050) instead of failing
  // on its shape first.
  .catchall(InputSchema)
  .superRefine((inputs, ctx) => {
    const unknown: string[] = [];
    for (const [key, input] of Object.entries(inputs)) {
      if (FIXED.has(key)) continue;
      if (!PLUGIN_KEY.test(key)) {
        unknown.push(key);
        continue;
      }
      if (!PLUGIN_STORED_KINDS.includes((input as Input).kind)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          // The engine words a schema issue as the feature's error ("Invalid inputs: …"); the
          // document itself still opens (ADR-0050).
          message: "has a kind this plugin can't take",
        });
      }
    }
    if (unknown.length > 0) {
      ctx.addIssue({ code: 'unrecognized_keys', keys: unknown, path: [], input: inputs });
    }
  }) as unknown as z.ZodType<PluginInputs>;

export const pluginFeature: FeatureDefinition<PluginInputs> = {
  type: PLUGIN_TYPE,
  label: PLUGIN_LABEL,
  category: 'create',
  icon: 'script',
  inputsSchema: PluginInputsSchema,
  openInputs: {
    name: 'inputs',
    prefix: PLUGIN_INPUT_PREFIX,
    description:
      "The plugin's own inputs by their manifest names: an expression as a string (its unit read off it, a length unless it ends in an angle unit) or a parameter handle, a plain number as a number, a toggle as a boolean, references as one or a list, and a choice as `{ kind: 'enum', value }`. Stored as `in:<name>`.",
  },
  // No `faceRoles`: its generated features name their faces under their own
  // IDs (`extrude:<feature>.f1:cap:end`), as a Script's do.
};

/** A plugin feature's fixed settings. */
export interface PluginSettings {
  plugin: FileInput['id'];
  handler: string;
}

export function pluginSettings(inputs: FeatureInputs): PluginSettings {
  const plugin = inputs.plugin?.kind === 'file' ? inputs.plugin.id : ('' as FileInput['id']);
  const handler = inputs.handler?.kind === 'enum' ? inputs.handler.value : '';
  return { plugin, handler };
}

/** A plugin feature's own inputs (`in:<name>`), by their manifest names. */
export function pluginOwnInputs(inputs: FeatureInputs): Map<string, PluginInputValue> {
  const own = new Map<string, PluginInputValue>();
  for (const [key, input] of Object.entries(inputs)) {
    if (!key.startsWith(PLUGIN_INPUT_PREFIX) || !input) continue;
    if (PLUGIN_STORED_KINDS.includes(input.kind)) {
      own.set(key.slice(PLUGIN_INPUT_PREFIX.length), input as PluginInputValue);
    }
  }
  return own;
}

/**
 * The plugin file a plugin feature names, which the kernel must have before it
 * computes it (ADR-0077 §4: the app's `Recomputer` and the CLI send it, as an
 * import's file); `undefined` for any other feature.
 */
export function pluginFileOf(feature: Feature): FileInput['id'] | undefined {
  if (feature.type !== PLUGIN_TYPE) return undefined;
  const plugin = feature.inputs.plugin;
  return plugin?.kind === 'file' ? plugin.id : undefined;
}

/** A plugin feature. The caller makes the ID and the name. */
export function pluginFeatureOf(
  id: FeatureId,
  name: string,
  settings: PluginSettings,
  own: Readonly<Record<string, PluginInputValue>> = {},
): Feature {
  const inputs: FeatureInputs = {
    plugin: { kind: 'file', id: settings.plugin },
    handler: { kind: 'enum', value: settings.handler },
  };
  for (const [name, input] of Object.entries(own)) inputs[pluginInputKey(name)] = input;
  return { id, type: PLUGIN_TYPE, name, suppressed: false, inputs };
}

/**
 * The feature types that make features instead of a result (ADR-0070 §1,
 * ADR-0077 §3): a Script and a plugin feature. A design with one needs the
 * script runner, and a reference into what one made is a dependency on it.
 */
export const GENERATING_TYPES: readonly string[] = [SCRIPT_TYPE, PLUGIN_TYPE];

/** Whether a feature type makes features (`GENERATING_TYPES`). */
export function makesFeatures(type: string): boolean {
  return GENERATING_TYPES.includes(type);
}
