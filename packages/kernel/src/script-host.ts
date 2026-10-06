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

/** Runs scripts. Synchronous: the engine runs a script between two features. */
export interface ScriptHost {
  run(request: ScriptRunRequest): ScriptRunResult;
}

/** Loads a script host, once, when a design first needs one (`KernelApi.enableScripts`). */
export type ScriptHostLoader = () => Promise<ScriptHost>;

/** What a script's status says when nobody gave the kernel a runner. */
export const NO_SCRIPT_HOST =
  "Scripts can't run here: this Extrudo was started without the script runner.";

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
  constructor(failure: ScriptRunFailure, log: readonly string[] = []) {
    super(
      failure.line === undefined ? failure.message : `Line ${failure.line}: ${failure.message}`,
    );
    this.line = failure.line;
    this.column = failure.column;
    this.log = log;
  }
}
