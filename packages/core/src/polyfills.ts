/**
 * Explicit resource management for engines that lack it (Safari and iOS
 * browsers until the WebKit 26 cycle: 26.0 lacks the symbol, 26.6 has it;
 * Firefox before 141, Chrome before 125). Vite lowers a `using` declaration (the
 * kernel's `using scope = kernel.scope()`) to Babel's `usingCtx` helper, which
 * looks the disposer up under `Symbol.dispose || Symbol.for('Symbol.dispose')`,
 * but leaves the classes and object literals that define `[Symbol.dispose]`
 * as they are. Without the symbol their key becomes the string "undefined",
 * and the first `using` throws "Object is not disposable." (the first one a
 * user meets is the sketch feature's profile detection: drawing a closed
 * loop). Giving those engines the registry symbol the helper falls back to
 * makes both sides agree.
 *
 * Import this module first in every entry (the web and desktop entries, the
 * kernel's workers and index): it must run before any module that defines a
 * disposer is evaluated.
 */

/** The part of `Symbol` this touches, so a test can pass a stand-in. */
export interface DisposeSymbols {
  dispose?: symbol;
  asyncDispose?: symbol;
  for(key: string): symbol;
}

/** Defines `dispose` and `asyncDispose` on `target` where they are missing. */
export function installDisposeSymbols(target: DisposeSymbols): void {
  target.dispose ??= target.for('Symbol.dispose');
  target.asyncDispose ??= target.for('Symbol.asyncDispose');
}

installDisposeSymbols(Symbol);
