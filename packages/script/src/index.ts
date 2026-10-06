/**
 * `@extrudo/script`: the script runner (ADR-0070).
 *
 * ```
 * const runner = await loadScriptRunner();
 * const result = runner.run({
 *   code: 'design.box({ length: params.width, width: "20 mm", height: "5 mm" });',
 *   language: 'ts',
 *   design,           // a Design over the document before the script
 *   featureId: 's1',  // what seeds Math.random
 * });
 * ```
 *
 * The code runs in QuickJS (WebAssembly, ADR-0070 §2), stripped from TypeScript
 * by sucrase, and builds ordinary features through `@extrudo/api` (ADR-0068):
 * the same calls the same document would give from Node, byte for byte and run
 * after run, which is what lets a script be re-run on every recompute.
 *
 * The sandbox has nothing but what this gives it — `design` (add only), `params`
 * (frozen), `console`, a seeded `Math.random`, a `Date` at 0 — and it works under
 * limits: two seconds, 64 MB, a thousand features, bounded output. **Every
 * QuickJS handle a run makes is disposed** before the run returns, the same rule
 * the OCCT shapes follow.
 */
export { Bridge, HANDLE_CLASSES } from './bridge';
export {
  GENERATED_NAME_SEPARATOR,
  loadScriptHost,
  runScript,
  type ScriptHostAdapter,
  type ScriptHostRequest,
  type ScriptHostResult,
  scriptHost,
} from './host';
export {
  ASYNC_MESSAGE,
  codeLengthMessage,
  DEFAULT_LIMITS,
  featureCountMessage,
  limitsOf,
  logCharacterMessage,
  logLineMessage,
  memoryMessage,
  ScriptError,
  timeMessage,
} from './limits';
export { ScriptLog } from './log';
export { seededRandom } from './random';
export {
  REFUSAL_RULE,
  REFUSED_METHODS,
  SCRIPT_IN_SCRIPT,
  SCRIPT_METHODS,
  ScriptDesign,
} from './restricted';
export {
  type LoadScriptRunnerOptions,
  loadScriptRunner,
  ScriptRunner,
} from './runner';
export type {
  ScriptFailure,
  ScriptLanguage,
  ScriptLimits,
  ScriptRequest,
  ScriptResult,
} from './types';
export { parameterValues } from './values';
