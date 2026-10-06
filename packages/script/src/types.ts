/**
 * What a script run is and what it gives back (ADR-0070 §2).
 *
 * A script is user code that calls the document API (ADR-0068) inside QuickJS;
 * this module holds the words for it: the request a caller makes, the limits a
 * run works under, and the result it gives back. Everything else is the
 * mechanics (`runner.ts`) and the sandbox (`bridge.ts`, `restricted.ts`).
 */
import type { Design, FeatureId } from '@extrudo/api';

/** What a script's source is written in: TypeScript (stripped by sucrase) or JavaScript. */
export type ScriptLanguage = 'ts' | 'js';

/**
 * What one run may do. Every limit is its own message (ADR-0070 §2), and the
 * defaults are the ADR's: two seconds, 64 MB, a thousand features.
 */
export interface ScriptLimits {
  /** Wall-clock time for the run, in milliseconds. */
  timeMs: number;
  /** QuickJS's own heap, in bytes. */
  memoryBytes: number;
  /** How many features one run may add to the design. */
  features: number;
  /** How many `console.log` lines are kept. */
  logLines: number;
  /** How many characters of output are kept, over all the lines. */
  logCharacters: number;
  /** How long the source may be, in characters (ADR-0070 §1's `code` input). */
  code: number;
}

/** One run of a script. */
export interface ScriptRequest {
  /** The script's source. */
  code: string;
  /** What it is written in; TypeScript is stripped before it runs. */
  language: ScriptLanguage;
  /**
   * The design the script adds to: a `Design` over the document as it is before
   * the script (ADR-0070 §1). The run adds features to it; it may not remove,
   * move, rename or suppress any.
   */
  design: Design;
  /** The script's own feature ID, which seeds `Math.random` (ADR-0070 §2). */
  featureId: string;
  /**
   * The parameter values `params` holds; the document's own parameters by
   * default (`parameterValues`). A caller that has already evaluated them (the
   * kernel evaluator, P5-02 slice 2) passes them in.
   */
  params?: Readonly<Record<string, number>>;
  /** Overrides for the limits above; anything left out is the default. */
  limits?: Partial<ScriptLimits>;
}

/** What went wrong, and where in the script: 1-based lines, as the editor counts. */
export interface ScriptFailure {
  /** What to show, worded for the user (no stack, no QuickJS names). */
  message: string;
  /** The line of the user's source, when the engine could say which. */
  line?: number;
  /** The column, when the engine gave one (QuickJS's release build does not). */
  column?: number;
}

/**
 * What a run gives back: the features it added (their IDs, in the order it made
 * them) and what it logged, or the failure that stopped it. `log` is there
 * either way, so a dialog can show what a failing script printed.
 */
export type ScriptResult =
  | { ok: true; added: FeatureId[]; log: string[] }
  | { ok: false; error: ScriptFailure; log: string[] };
