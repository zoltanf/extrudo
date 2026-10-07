/**
 * The runner as the kernel sees it (P5-02 slice 2, ADR-0070 §1-§2): one call
 * that runs a Script feature's code against the document before it and gives
 * back the features it made, ready for the engine to evaluate.
 *
 * The kernel defines the interface (`ScriptHost` in `@extrudo/kernel`) and
 * never imports this package; the shapes here are the same by structure, and
 * whoever starts a kernel (the app's worker entry, the CLI) hands it one of
 * these. So neither package depends on the other.
 *
 * - **IDs** are the API's own counter (ADR-0068 §2) behind the script's ID:
 *   `<script>.f1`, `<script>.f2`… for features, the plain counter for what
 *   lives inside one (sketch entities, constraints, dimensions). The counter
 *   starts afresh every run and is *not* seeded from the document, so a
 *   feature added before the script never shifts the IDs a later fillet's
 *   references are built from; the script's own ID keeps them apart from every
 *   other feature's.
 * - **Names** are "Script1 › Extrude1": the script's name, then the type's
 *   label counted within the script.
 */
import { CounterIds, Design, type IdKind } from '@extrudo/api';
import {
  documentFeatures,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  generatedFeatureId,
} from '@extrudo/core';
import { type LoadScriptRunnerOptions, loadScriptRunner, type ScriptRunner } from './runner';
import type { PluginHandler, ScriptFailure, ScriptLanguage, ScriptResult } from './types';

/** One run, as the kernel asks for it (`ScriptRunRequest` in `@extrudo/kernel`). */
export interface ScriptHostRequest {
  code: string;
  language: ScriptLanguage;
  /** The document before the script: the features before it, every parameter. */
  doc: ExtrudoDocument;
  featureId: FeatureId;
  featureName: string;
  params: Readonly<Record<string, number>>;
}

/**
 * One run of a plugin's handler, as the kernel asks for it (`PluginRunRequest`
 * in `@extrudo/kernel`, ADR-0077 §2-§3): the module's source as the plugin file
 * holds it, the handler, and what a script's run has besides.
 */
export interface PluginHostRequest {
  code: string;
  language: ScriptLanguage;
  handler: PluginHandler;
  /** The document before the feature (or, for a command, the design as it is). */
  doc: ExtrudoDocument;
  /** The plugin feature's ID (a command's caller picks one): generated IDs start with it. */
  featureId: FeatureId;
  /** Its name ("Name plate1"): generated features are named "Name plate1 › Extrude1". */
  featureName: string;
  params: Readonly<Record<string, number>>;
  /** A feature's inputs as plain values, by their manifest names. */
  inputs?: Readonly<Record<string, unknown>>;
  /** A command's model selection. */
  selection?: readonly unknown[];
}

/** What a run gives the kernel (`ScriptRunResult` in `@extrudo/kernel`). */
export type ScriptHostResult =
  | { ok: true; features: Feature[]; log: string[] }
  | { ok: false; error: ScriptFailure; log: string[] };

/** The runner behind the kernel's `ScriptHost` interface. */
export interface ScriptHostAdapter {
  run(request: ScriptHostRequest): ScriptHostResult;
  runPlugin(request: PluginHostRequest): ScriptHostResult;
}

/** What separates the script's name from a generated feature's own: "Script1 › Extrude1". */
export const GENERATED_NAME_SEPARATOR = ' › ';

/** The kernel's script host over a runner. */
export function scriptHost(runner: ScriptRunner): ScriptHostAdapter {
  return {
    run: (request) => runScript(runner, request),
    runPlugin: (request) => runPlugin(runner, request),
  };
}

/**
 * Loads QuickJS and returns the host: what the kernel's `enableScripts` calls
 * through its loader. `wasmUrl` as for `loadScriptRunner` (the browser's asset).
 */
export async function loadScriptHost(
  options: LoadScriptRunnerOptions = {},
): Promise<ScriptHostAdapter> {
  return scriptHost(await loadScriptRunner(options));
}

/** One run: a design over the document, the code, and the features it added. */
export function runScript(runner: ScriptRunner, request: ScriptHostRequest): ScriptHostResult {
  return generate(request, 'script', (design) =>
    runner.run({
      code: request.code,
      language: request.language,
      design,
      featureId: request.featureId,
      params: request.params,
    }),
  );
}

/**
 * One run of a plugin's handler (ADR-0077 §2): the same design, IDs and names
 * as a script's run, and the handler called by `ScriptRunner.runPlugin`.
 */
export function runPlugin(runner: ScriptRunner, request: PluginHostRequest): ScriptHostResult {
  return generate(request, 'plugin', (design) =>
    runner.runPlugin({
      code: request.code,
      language: request.language,
      handler: request.handler,
      design,
      featureId: request.featureId,
      params: request.params,
      ...(request.inputs !== undefined && { inputs: request.inputs }),
      ...(request.selection !== undefined && { selection: request.selection }),
    }),
  );
}

/**
 * A run of either kind: a design over the document whose feature IDs are the
 * API's counter behind the feature's ID, the run, and the features it added,
 * named after the feature.
 */
function generate(
  request: { doc: ExtrudoDocument; featureId: FeatureId; featureName: string },
  what: 'script' | 'plugin',
  run: (design: Design) => ScriptResult,
): ScriptHostResult {
  const counter = new CounterIds();
  const ids = (kind: IdKind): string =>
    kind === 'feature'
      ? generatedFeatureId(request.featureId, counter.next(kind))
      : counter.next(kind);
  let design: Design;
  try {
    // The document's own clock, so nothing of the run depends on when it ran.
    design = Design.from(request.doc, { ids, now: request.doc.meta.modified });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: { message: `The ${what} can't read this design: ${message}` },
      log: [],
    };
  }
  const result = run(design);
  if (!result.ok) return result;
  const made = new Set<string>(result.added);
  const features = design.doc.features.filter((feature) => made.has(feature.id));
  return { ok: true, features: named(features, request.featureName), log: result.log };
}

/** The features with the script's names: "Script1 › Extrude1", counted per type within the script. */
function named(features: readonly Feature[], script: string): Feature[] {
  const registry = documentFeatures();
  const counts = new Map<string, number>();
  return features.map((feature) => {
    const label = registry.get(feature.type)?.label ?? feature.type;
    const n = (counts.get(label) ?? 0) + 1;
    counts.set(label, n);
    // A plain copy: the design's document is frozen, the engine keeps these.
    return {
      ...structuredClone(feature),
      name: `${script}${GENERATED_NAME_SEPARATOR}${label}${n}`,
    };
  });
}
