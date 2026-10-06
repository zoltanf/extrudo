/**
 * `@extrudo/script/browser`: the script host for the app's kernel worker
 * (P5-02, ADR-0070 §2). QuickJS's WebAssembly is a build asset of the app
 * (`?url`), fetched from the app's own origin the first time a design with a
 * script recomputes, so the content policy needs nothing but the
 * `'wasm-unsafe-eval'` the other two WASM builds already have (ADR-0067).
 */
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import { loadScriptHost, type ScriptHostAdapter } from './host';

/** Loads QuickJS from the app's asset and returns the kernel's script host. */
export function loadBrowserScriptHost(): Promise<ScriptHostAdapter> {
  return loadScriptHost({ wasmUrl });
}
