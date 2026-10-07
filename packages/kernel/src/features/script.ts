/**
 * The Script feature in the kernel (P5-02, ADR-0070 §1): it runs the user's
 * code through the injected `ScriptHost` and hands the engine the features the
 * code made. It never evaluates anything itself — the engine evaluates the
 * generated features after it (`KernelFeatureDefinition.expand`), each under
 * its own cache key, so their bodies, names and reports are the ones those
 * features make anywhere else.
 */
import {
  type Feature,
  type FeatureId,
  GENERATED_SEPARATOR,
  PLUGIN_TYPE,
  SCRIPT_TYPE,
  type ScriptInputs,
  scriptFeature,
  scriptSettings,
} from '@extrudo/core';
import { KernelError } from '../kernel';
import type { ExpandContext, Expansion, KernelFeatureDefinition } from '../recompute/types';
import { NO_SCRIPT_HOST, ScriptRunError } from '../script-host';

export const kernelScript: KernelFeatureDefinition<ScriptInputs> = {
  ...scriptFeature,
  // It adds bodies through the features it makes, after the ones before it.
  bodyAccess: () => 'write',
  expand(ctx: ExpandContext<ScriptInputs>): Expansion {
    if (!ctx.scripts) throw new KernelError(NO_SCRIPT_HOST);
    const { code, language } = scriptSettings(ctx.inputs);
    const result = ctx.scripts.run({
      code,
      language,
      doc: ctx.doc,
      featureId: ctx.feature.id,
      featureName: ctx.feature.name,
      params: ctx.params,
    });
    if (!result.ok) throw new ScriptRunError(result.error, result.log);
    return {
      features: checkedGenerated(ctx.feature.id, result.features, 'script'),
      log: result.log,
    };
  },
  evaluate() {
    // The engine expands a script instead (see the module comment).
    throw new Error('A script is expanded, not evaluated.');
  },
};

/**
 * The features a run made, once checked: the runner is trusted to keep these
 * rules, and checked anyway — a wrong ID would collide with a stored
 * feature's, or be read back as another script's, and a script or plugin
 * feature among them could only run another one there, which nothing could
 * store or edit. Shared by the Script and the plugin feature (ADR-0077 §3).
 */
export function checkedGenerated(
  owner: FeatureId,
  features: readonly Feature[],
  what: 'script' | 'plugin',
): readonly Feature[] {
  const prefix = `${owner}${GENERATED_SEPARATOR}`;
  const seen = new Set<string>();
  for (const feature of features) {
    if (!feature.id.startsWith(prefix) || seen.has(feature.id)) {
      throw new ScriptRunError({
        message: `The ${what} made a feature with the ID ${feature.id}.`,
      });
    }
    if (feature.type === SCRIPT_TYPE) {
      throw new ScriptRunError({ message: `A ${what} can't add a script.` });
    }
    if (feature.type === PLUGIN_TYPE) {
      throw new ScriptRunError({ message: `A ${what} can't add a plugin feature.` });
    }
    seen.add(feature.id);
  }
  return features;
}
