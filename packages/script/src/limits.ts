/**
 * The limits and the words for them (ADR-0070 §2).
 *
 * Every limit a run works under has one message here, so the feature status a
 * script fails with is worded in one place: "The script ran longer than 2 s.",
 * "The script used more than 64 MB of memory.", "The script added more than
 * 1,000 features."
 */
import type { ScriptFailure, ScriptLimits } from './types';

/** The ADR's limits: two seconds, 64 MB, a thousand features, bounded output. */
export const DEFAULT_LIMITS: Readonly<ScriptLimits> = {
  timeMs: 2_000,
  memoryBytes: 64 * 1024 * 1024,
  features: 1_000,
  logLines: 200,
  logCharacters: 100_000,
  code: 100_000,
};

/** One run's limits: what the caller gave, over the defaults. */
export function limitsOf(overrides: Partial<ScriptLimits> | undefined): ScriptLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

/** A failure of the script itself, carrying where in it happened. */
export class ScriptError extends Error {
  override readonly name: string;
  readonly line: number | undefined;
  readonly column: number | undefined;

  constructor(message: string, position: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'ScriptError';
    this.line = position.line;
    this.column = position.column;
  }
}

/** What a host-side throw becomes in a `ScriptResult`. */
export function failureOf(error: unknown): ScriptFailure {
  if (error instanceof ScriptError) {
    return {
      message: error.message,
      ...(error.line === undefined ? {} : { line: error.line }),
      ...(error.column === undefined ? {} : { column: error.column }),
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

/** "The script ran longer than 2 s." */
export function timeMessage(ms: number): string {
  const seconds = ms / 1_000;
  return `The script ran longer than ${trim(seconds)} s.`;
}

/** "The script used more than 64 MB of memory." */
export function memoryMessage(bytes: number): string {
  const megabyte = 1024 * 1024;
  const size = bytes % megabyte === 0 ? `${bytes / megabyte} MB` : `${Math.round(bytes / 1024)} kB`;
  return `The script used more than ${size} of memory.`;
}

/** "The script added more than 1,000 features." */
export function featureCountMessage(count: number): string {
  return `The script added more than ${grouped(count)} features.`;
}

/** "The script's output stopped at 200 lines." */
export function logLineMessage(count: number): string {
  return `The script's output stopped at ${grouped(count)} lines.`;
}

/** "The script's output stopped at 100,000 characters." */
export function logCharacterMessage(count: number): string {
  return `The script's output stopped at ${grouped(count)} characters.`;
}

/** "The script is longer than 100,000 characters." */
export function codeLengthMessage(count: number): string {
  return `The script is longer than ${grouped(count)} characters.`;
}

/**
 * A script that ends in a promise tried to be asynchronous: it used
 * `import()`, or awaited something. There is nothing to await in the sandbox
 * (ADR-0070 §2), so this is a failure rather than a silently empty design.
 */
export const ASYNC_MESSAGE =
  'The script runs on its own, with nothing to wait for: it cannot use import() or await.';

/**
 * QuickJS's own "out of memory" and "interrupted" errors are our memory and
 * time limits; anything else of its own is a failure of the run itself.
 */
export function quickJsLimitMessage(
  error: { name?: string; message?: string },
  limits: ScriptLimits,
): string | undefined {
  const message = error.message ?? '';
  if (/out of memory/i.test(message)) return memoryMessage(limits.memoryBytes);
  if (/interrupted/i.test(message)) return timeMessage(limits.timeMs);
  return undefined;
}

/** `1,000` — thousands in groups, so a count reads as a count. */
function grouped(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `2`, `0.5`, `2.5` — seconds with no trailing zeros. */
function trim(seconds: number): string {
  return String(Math.round(seconds * 100) / 100);
}
