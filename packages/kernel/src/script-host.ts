/**
 * What the kernel needs from a script runner (P5-02, ADR-0070 §2): one call
 * that runs a Script feature's code and gives back the features it made.
 *
 * The kernel never imports the runner (`@extrudo/script`) or the document API
 * it builds on: whoever starts the kernel injects a `ScriptHost` — the app's
 * kernel worker loads one lazily (QuickJS is a WASM of its own, like
 * manifold-3d), the CLI loads it in Node — so `@extrudo/kernel` stays free of
 * both and a design without a script never loads QuickJS.
 */
import type { ExtrudoDocument, Feature, FeatureId } from '@extrudo/core';
import { KernelError } from './kernel';

/** One run of a Script feature. */
export interface ScriptRunRequest {
  /** The script's source. */
  code: string;
  language: 'ts' | 'js';
  /**
   * The document as it is before the script: the features before it in the
   * timeline, every parameter. The script reads it and adds to a copy.
   */
  doc: ExtrudoDocument;
  /** The script's own feature ID: its generated IDs start with it (`<id>.f3`), and it seeds `Math.random`. */
  featureId: FeatureId;
  /** The script's name ("Script1"): its generated features are named "Script1 › Extrude1". */
  featureName: string;
  /** Every parameter's value by name, in mm, degrees or plain units: what `params` holds. */
  params: Readonly<Record<string, number>>;
}

/** Where a script failed: 1-based, as the editor counts. */
export interface ScriptRunFailure {
  message: string;
  line?: number;
  column?: number;
}

/**
 * What a run gives back: the features the script made — IDs `<script id>.<n>`,
 * in the order it made them — or the failure that stopped it, and what it
 * printed either way.
 */
export type ScriptRunResult =
  | { ok: true; features: Feature[]; log: string[] }
  | { ok: false; error: ScriptRunFailure; log: string[] };

/**
 * One run of a plugin's handler (P6-03, ADR-0077 §2-§3): the module as the
 * plugin file holds it, which handler, and a feature's inputs as the plain
 * values the handler reads. IDs and names are a script's (`<feature>.f1`,
 * "Name plate1 › Extrude1").
 */
export interface PluginRunRequest {
  /** The module's source, `main.ts` or `main.js`. */
  code: string;
  language: 'ts' | 'js';
  /** A command (`exports.commands[name]`) or a custom feature (`exports.features[name]`). */
  handler: { kind: 'command' | 'feature'; name: string };
  /** The document before the feature. */
  doc: ExtrudoDocument;
  featureId: FeatureId;
  featureName: string;
  params: Readonly<Record<string, number>>;
  /**
   * A feature's inputs by their manifest names: an `expr` as its number (mm,
   * degrees or plain), a `bool`, an `enum`'s value, a `ref` as `{ kind, id,
   * fingerprint? }` with a face, edge or vertex resolved to its current name,
   * or a list of them for a `multiple` input.
   */
  inputs?: Readonly<Record<string, unknown>>;
  /** A command's model selection, as references. */
  selection?: readonly unknown[];
}

/** Runs scripts and plugins' handlers. Synchronous: the engine runs one between two features. */
export interface ScriptHost {
  run(request: ScriptRunRequest): ScriptRunResult;
  runPlugin(request: PluginRunRequest): ScriptRunResult;
}

/** Loads a script host, once, when a design first needs one (`KernelApi.enableScripts`). */
export type ScriptHostLoader = () => Promise<ScriptHost>;

/** What a script's or a plugin feature's status says when nobody gave the kernel a runner. */
export const NO_SCRIPT_HOST =
  "Scripts and plugins can't run here: this Extrudo was started without the script runner.";

/**
 * A Script feature that couldn't run, or whose output the engine refused: the
 * feature's error, with the line of the source when there is one ("Line 12: …").
 */
export class ScriptRunError extends KernelError {
  override readonly name = 'ScriptRunError';
  // Fields, not constructor parameter properties: Node runs this package's
  // TypeScript as it is (P5-03's CLI).
  readonly line: number | undefined;
  readonly column: number | undefined;
  readonly log: readonly string[];
  /**
   * `where` names the code for a plugin (ADR-0077 §2: "the plugin's name and
   * the line in main.ts"): "Name plate 1.0.0, main.ts line 12: …".
   */
  constructor(failure: ScriptRunFailure, log: readonly string[] = [], where?: string) {
    super(
      where === undefined
        ? failure.line === undefined
          ? failure.message
          : `Line ${failure.line}: ${failure.message}`
        : failure.line === undefined
          ? `${where}: ${failure.message}`
          : `${where} line ${failure.line}: ${failure.message}`,
    );
    this.line = failure.line;
    this.column = failure.column;
    this.log = log;
  }
}
