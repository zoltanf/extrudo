/**
 * The runner: one QuickJS runtime per run, the sandbox in it, and the result
 * back out (ADR-0070 §2).
 *
 * ```
 * const runner = await loadScriptRunner();
 * const result = runner.run({ code, language: 'ts', design, featureId: 's1' });
 * ```
 *
 * A run owns its runtime, its context and every QuickJS handle in them, and
 * frees all of it before it returns — a script's features are the output, not
 * its VM. The WASM itself is loaded once (ADR-0070 §2: lazily, next to
 * manifold-3d, only for a design that has a script) and shared by the runs.
 */
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import {
  isFail,
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import { Bridge, LINE_OFFSET } from './bridge';
import { ASYNC_MESSAGE, failureOf, limitsOf, quickJsLimitMessage } from './limits';
import { ScriptLog } from './log';
import { ScriptDesign } from './restricted';
import { giveGlobals } from './sandbox';
import { checkCodeLength, compileScript } from './transform';
import type { ScriptRequest, ScriptResult } from './types';

/** How to load the runner's QuickJS. */
export interface LoadScriptRunnerOptions {
  /**
   * Where QuickJS's own WebAssembly file is: in the browser a Vite asset URL
   * (`import wasmUrl from '…/emscripten-module.wasm?url'`), so the file is served
   * as WebAssembly and fetched by the same origin the app is on (ADR-0067 keeps
   * `'wasm-unsafe-eval'` and nothing else out of the policy). Without one, the
   * release-sync build loads its own file out of the npm package, which is what
   * Node (P5-03's CLI) and the tests use.
   */
  wasmUrl?: string;
  /** A module that is loaded already, to share one between several runners. */
  quickJSWASM?: QuickJSWASMModule;
}

/** Runs scripts. One WASM module, one runtime per run. */
export class ScriptRunner {
  readonly #wasm: QuickJSWASMModule;

  constructor(wasm: QuickJSWASMModule) {
    this.#wasm = wasm;
  }

  /**
   * Runs one script against `request.design`, which it may only add to. Never
   * throws for anything the script did: the failure comes back in the result,
   * with the line it happened on. The features it added stay in the design (the
   * kernel evaluator of slice 2 evaluates them in the script's own context).
   */
  run(request: ScriptRequest): ScriptResult {
    const limits = limitsOf(request.limits);
    const log = new ScriptLog(limits);
    let source: string;
    try {
      checkCodeLength(request.code, limits.code);
      source = compileScript(request.code, request.language);
    } catch (error) {
      return { ok: false, error: failureOf(error), log: log.out() };
    }
    const script = new ScriptDesign(request.design, limits.features);
    const deadline = performance.now() + limits.timeMs;
    const runtime = this.#wasm.newRuntime();
    runtime.setMemoryLimit(limits.memoryBytes);
    // The one limit a script cannot get past: QuickJS asks between its steps,
    // and past the deadline every step is refused (ADR-0070 §2).
    runtime.setInterruptHandler(() => performance.now() > deadline);
    const filename = request.language === 'js' ? 'script.js' : 'script.ts';
    const ctx = runtime.newContext();
    const bridge = new Bridge(ctx, filename);
    try {
      giveGlobals(ctx, bridge, script, request, log);
      // The newlines put the source one line lower than the user wrote it, so
      // QuickJS's own line numbers (which leave out the first line's) come out
      // as the editor's; `strict` so a script can't quietly write to a frozen
      // `params` or to a global it didn't declare, and `global` so `import()`
      // never becomes a module load.
      const result = ctx.evalCode('\n'.repeat(LINE_OFFSET) + source, filename, {
        type: 'global',
        strict: true,
      });
      if (isFail(result)) {
        const error = bridge.readError(result.error);
        result.error.dispose();
        const limit = quickJsLimitMessage(error, limits);
        return {
          ok: false,
          error: limit === undefined ? failureOf(error) : { message: limit },
          log: log.out(),
        };
      }
      // A script runs on its own: a value that is a promise, or a job QuickJS
      // still has (what `import()` leaves behind, since no module loader is
      // ever set), means it tried to be asynchronous. Nothing would ever settle
      // it, so it is a failure rather than a quietly empty design.
      const settled = ctx.getPromiseState(result.value);
      result.value.dispose();
      const asynchronous =
        runtime.hasPendingJob() ||
        settled.type === 'rejected' ||
        (settled.type === 'fulfilled' && !settled.notAPromise);
      return asynchronous
        ? { ok: false, error: { message: ASYNC_MESSAGE }, log: log.out() }
        : { ok: true, added: [...script.added], log: log.out() };
    } catch (error) {
      return { ok: false, error: failureOf(error), log: log.out() };
    } finally {
      // The handles, then the context, then the runtime: QuickJS asserts that
      // nothing of its own is still alive when a runtime is freed.
      bridge.dispose();
      ctx.dispose();
      runtime.dispose();
    }
  }
}

/** The WASM each URL loads once per process, and the default (the package's). */
const modules = new Map<string, Promise<QuickJSWASMModule>>();

/**
 * Loads QuickJS (once per process for the package's own file) and returns the
 * runner. This is the call the kernel worker and the CLI make when a design has
 * a script (ADR-0070 §2); nothing in `@extrudo/kernel` depends on it.
 */
export async function loadScriptRunner(
  options: LoadScriptRunnerOptions = {},
): Promise<ScriptRunner> {
  return new ScriptRunner(await quickJSModule(options));
}

/** The shared WASM module for these options. */
function quickJSModule(options: LoadScriptRunnerOptions): Promise<QuickJSWASMModule> {
  if (options.quickJSWASM) return Promise.resolve(options.quickJSWASM);
  const key = options.wasmUrl ?? '';
  const loading = modules.get(key);
  if (loading) return loading;
  const module =
    options.wasmUrl === undefined
      ? newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
      : newQuickJSWASMModuleFromVariant(
          newVariant(RELEASE_SYNC, { wasmLocation: options.wasmUrl }),
        );
  modules.set(key, module);
  return module;
}
