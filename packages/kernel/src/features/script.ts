/**
 * The Script feature in the kernel (P5-02, ADR-0070 §1): it runs the user's
 * code through the injected `ScriptHost` and hands the engine the features the
 * code made. It never evaluates anything itself — the engine evaluates the
 * generated features after it (`KernelFeatureDefinition.expand`), each under
 * its own cache key, so their bodies, names and reports are the ones those
 * features make anywhere else.
 */
import {
  GENERATED_SEPARATOR,
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
    // The runner is trusted to keep these rules, and checked anyway: a wrong ID
    // would collide with a stored feature's, or be read back as another script's.
    const prefix = `${ctx.feature.id}${GENERATED_SEPARATOR}`;
    const seen = new Set<string>();
    for (const feature of result.features) {
      if (!feature.id.startsWith(prefix) || seen.has(feature.id)) {
        throw new ScriptRunError({
          message: `The script made a feature with the ID ${feature.id}.`,
        });
      }
      if (feature.type === SCRIPT_TYPE) {
        throw new ScriptRunError({ message: "A script can't add a script." });
      }
      seen.add(feature.id);
    }
    return { features: result.features, log: result.log };
  },
  evaluate() {
    // The engine expands a script instead (see the module comment).
    throw new Error('A script is expanded, not evaluated.');
  },
};
