/**
 * The plugin feature in the kernel (P6-03, ADR-0077 §3): a plugin's custom
 * feature runs the plugin's handler in the script sandbox, through the
 * injected `ScriptHost`, and hands the engine the features it made — exactly
 * as a Script does (`features/script.ts`), with three things of its own:
 *
 * - the code comes from the **plugin file the design carries** (an attachment
 *   of media type `application/x-extrudo-plugin`), read with storage's
 *   `readPluginFile`, so a manifest is checked the same way here as when the
 *   app installs it;
 * - the feature's own inputs (`in:<name>`) are checked against the manifest's
 *   feature and turned into the plain values a handler reads: an expression's
 *   number (`ctx.value`), a toggle, a choice, and references — a face, edge or
 *   vertex **resolved** among the bodies before the feature (`ctx.resolve`), so
 *   a guess warns and a lost one is Fix References' (`LostReferenceError`);
 * - its failures name the plugin and its version, and a line is `main.ts`'s.
 */
import {
  type EnumInput,
  type ExprInput,
  evaluateExpression,
  type GeomRef,
  PLUGIN_MEDIA_TYPE,
  type PluginFeature,
  type PluginInput,
  type PluginInputs,
  type PluginInputValue,
  pluginFeature,
  pluginOwnInputs,
  pluginSettings,
  type UnitKind,
} from '@extrudo/core';
import { type PluginFile, readPluginFile } from '@extrudo/storage/plugin';
import { KernelError } from '../kernel';
import type { ExpandContext, Expansion, KernelFeatureDefinition } from '../recompute/types';
import { MissingFileError } from '../recompute/types';
import { NO_SCRIPT_HOST, ScriptRunError } from '../script-host';
import { checkedGenerated } from './script';

export const kernelPlugin: KernelFeatureDefinition<PluginInputs> = {
  ...pluginFeature,
  // It adds bodies through the features it makes, after the ones before it.
  bodyAccess: () => 'write',
  expand(ctx: ExpandContext<PluginInputs>): Expansion {
    if (!ctx.scripts) throw new KernelError(NO_SCRIPT_HOST);
    const { plugin, handler } = pluginSettings(ctx.inputs);
    const file = pluginFile(ctx, plugin);
    const what = `${file.manifest.name} ${file.manifest.version}`;
    const spec = file.manifest.features.find((feature) => feature.type === handler);
    if (!spec) {
      throw new KernelError(`The plugin ${what} has no custom feature "${handler}".`);
    }
    const inputs = handlerInputs(ctx, spec);
    const result = ctx.scripts.runPlugin({
      code: file.code,
      language: file.language,
      handler: { kind: 'feature', name: handler },
      doc: ctx.doc,
      featureId: ctx.feature.id,
      featureName: ctx.feature.name,
      params: ctx.params,
      inputs,
    });
    if (!result.ok)
      throw new ScriptRunError(result.error, result.log, `${what}, ${file.manifest.main}`);
    return {
      features: checkedGenerated(ctx.feature.id, result.features, 'plugin', ctx.doc.features),
      log: result.log,
    };
  },
  evaluate() {
    // The engine expands a plugin feature instead (see the module comment).
    throw new Error('A plugin feature is expanded, not evaluated.');
  },
};

/**
 * The plugin file the feature names, read and checked. A file the design
 * lacks, or that isn't a plugin file, is the feature's error naming the plugin
 * as the design's record of it has it ("Name plate 1.0.0").
 */
function pluginFile(
  ctx: ExpandContext<PluginInputs>,
  id: PluginInputs['plugin']['id'],
): PluginFile {
  const record = ctx.doc.attachments?.[id];
  const named = record ? `${record.name} (${record.fileName})` : ctx.fileName(id);
  let bytes: Uint8Array;
  try {
    bytes = ctx.file(id);
  } catch (error) {
    if (error instanceof MissingFileError) {
      throw new KernelError(
        `The plugin ${named} is missing from this design, so ${ctx.feature.name} can't run.`,
      );
    }
    throw error;
  }
  if (ctx.fileType(id) !== PLUGIN_MEDIA_TYPE) {
    throw new KernelError(`${ctx.fileName(id)} isn't a plugin file.`);
  }
  try {
    return readPluginFile(bytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new KernelError(`The plugin ${named} can't be read: ${reason}`);
  }
}

/** A manifest unit as the stored one: `none` is `unitless`. */
function storedUnit(unit: 'length' | 'angle' | 'none'): UnitKind {
  return unit === 'none' ? 'unitless' : unit;
}

/** "a length", "an angle", "a plain number". */
function described(unit: UnitKind): string {
  if (unit === 'unitless') return 'a plain number';
  return unit === 'angle' ? 'an angle' : 'a length';
}

/**
 * The feature's inputs as the handler reads them, by their manifest names. An
 * input the feature lacks takes the manifest's default (a constant); a stored
 * input the manifest lacks is left out with a warning; anything of the wrong
 * kind, unit, choice or reference kind is an error naming the input.
 */
function handlerInputs(
  ctx: ExpandContext<PluginInputs>,
  spec: PluginFeature,
): Record<string, unknown> {
  const stored = pluginOwnInputs(ctx.inputs);
  const out: Record<string, unknown> = {};
  for (const input of spec.inputs) {
    const value = stored.get(input.name);
    const read = value === undefined ? fallback(ctx, input) : readInput(ctx, input, value);
    if (read !== undefined) out[input.name] = read;
  }
  const known = new Set(spec.inputs.map((input) => input.name));
  for (const name of stored.keys()) {
    if (!known.has(name)) {
      ctx.warn(`The plugin's ${spec.label} has no input "${name}", so it was left out.`);
    }
  }
  return out;
}

/** One stored input as its plain value, checked against the manifest's. */
function readInput(
  ctx: ExpandContext<PluginInputs>,
  input: PluginInput,
  value: PluginInputValue,
): unknown {
  const wrong = () =>
    new KernelError(`The input "${input.name}" must be ${anInput(input)}, not ${value.kind}.`);
  switch (input.kind) {
    case 'expr': {
      if (value.kind !== 'expr') throw wrong();
      const unit = (value as ExprInput).unit ?? 'length';
      const wanted = storedUnit(input.unit);
      if (unit !== wanted) {
        throw new KernelError(
          `The input "${input.name}" takes ${described(wanted)}, but it holds ${described(unit)}.`,
        );
      }
      return ctx.value(`in:${input.name}`);
    }
    case 'bool':
      if (value.kind !== 'bool') throw wrong();
      return value.value;
    case 'enum': {
      if (value.kind !== 'enum') throw wrong();
      const choice = (value as EnumInput).value;
      if (!input.options.includes(choice)) {
        throw new KernelError(
          `The input "${input.name}" is "${choice}", which isn't one of ${input.options.join(', ')}.`,
        );
      }
      return choice;
    }
    case 'ref': {
      if (value.kind !== 'ref') throw wrong();
      const refs = value.refs.map((ref) => {
        if (!(input.accepts as readonly string[]).includes(ref.kind)) {
          throw new KernelError(
            `The input "${input.name}" takes ${input.accepts.join(' or ')} references, not a ${ref.kind}.`,
          );
        }
        return reference(ctx, ref);
      });
      if (input.multiple) return refs;
      if (refs.length > 1) {
        throw new KernelError(`The input "${input.name}" takes one reference, not ${refs.length}.`);
      }
      return refs[0];
    }
  }
}

/**
 * A reference as the handler passes it on: `{ kind, id, fingerprint? }`, the
 * form a Script builds with `design.ref(kind, id)`. A face, edge or vertex is
 * resolved among the bodies before the feature, so the features the handler
 * makes store the name it has now and resolve it exactly.
 */
function reference(ctx: ExpandContext<PluginInputs>, ref: GeomRef): GeomRef {
  if (ref.kind !== 'face' && ref.kind !== 'edge' && ref.kind !== 'vertex') return ref;
  const resolved = ctx.resolve(ref);
  return {
    kind: ref.kind,
    id: resolved.id,
    ...(ref.fingerprint && { fingerprint: ref.fingerprint }),
  };
}

/** What an input the feature lacks reads as: the manifest's default, or nothing. */
function fallback(ctx: ExpandContext<PluginInputs>, input: PluginInput): unknown {
  switch (input.kind) {
    case 'expr': {
      if (input.default === undefined) {
        throw new KernelError(`The input "${input.name}" has no value.`);
      }
      if (typeof input.default === 'number') return input.default;
      const result = evaluateExpression(input.default, {
        kind: storedUnit(input.unit),
        lengthUnit: ctx.doc.settings.units,
      });
      if (!result.ok) {
        throw new KernelError(
          `The plugin's default for "${input.name}" (${input.default}) doesn't evaluate: ${result.error.message}`,
        );
      }
      return result.value;
    }
    case 'bool':
      return input.default ?? false;
    case 'enum':
      return input.default ?? input.options[0];
    case 'ref':
      return input.multiple ? [] : undefined;
  }
}

/** "an expression", "a toggle", "a choice", "references". */
function anInput(input: PluginInput): string {
  switch (input.kind) {
    case 'expr':
      return 'an expression';
    case 'bool':
      return 'a toggle';
    case 'enum':
      return 'a choice';
    case 'ref':
      return 'references';
  }
}
