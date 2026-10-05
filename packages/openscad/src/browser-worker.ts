/**
 * The compiler's worker in a browser (ADR-0071 §3): the WASM is a build asset
 * compiled while it streams in, the glue a module of its own. Neither
 * evaluates a string, so the app's content policy needs nothing new
 * (`'wasm-unsafe-eval'` is there for OCCT already).
 */
import type { CompileMessage, CompileReply } from './compiler';
import { type OpenscadFactory, runOpenscad } from './run';

/** The WASM couldn't be fetched: offline before it was ever cached (ADR-0071 §4). */
class OfflineError extends Error {}

/**
 * The compiled WASM and the glue, made on the first compile. A failure is not
 * kept: offline now, the next compile tries the network again.
 */
let ready: Promise<{ wasm: WebAssembly.Module; factory: OpenscadFactory }> | undefined;

function load(): Promise<{ wasm: WebAssembly.Module; factory: OpenscadFactory }> {
  ready ??= (async () => {
    // The service worker caches it on the first fetch (ADR-0071 §4); a failed
    // fetch is the network, which the feature words as "not downloaded yet".
    const response = await fetch(new URL('../dist/openscad.wasm', import.meta.url)).catch(
      (error: unknown) => {
        throw new OfflineError(error instanceof Error ? error.message : String(error));
      },
    );
    if (!response.ok) throw new OfflineError(`the server answered ${response.status}`);
    const wasm = await WebAssembly.compileStreaming(response);
    const glue = (await import(
      /* @vite-ignore */ new URL('../dist/openscad.js', import.meta.url).href
    )) as {
      default: OpenscadFactory;
    };
    return { wasm, factory: glue.default };
  })();
  ready.catch(() => {
    ready = undefined;
  });
  return ready;
}

self.addEventListener('message', async (event: MessageEvent<CompileMessage>) => {
  const message = event.data;
  let reply: CompileReply;
  try {
    const { wasm, factory } = await load();
    reply = {
      id: message.id,
      raw: await runOpenscad(factory, wasm, message.request, message.heapMaxBytes),
    };
  } catch (error) {
    reply = {
      id: message.id,
      failure: error instanceof Error ? error.message : String(error),
      ...(error instanceof OfflineError && { offline: true }),
    };
  }
  self.postMessage(reply);
});
