/**
 * The compiler's worker in a browser (ADR-0071 §3): the WASM is a build asset
 * compiled while it streams in, the glue a module of its own. Neither
 * evaluates a string, so the app's content policy needs nothing new
 * (`'wasm-unsafe-eval'` is there for OCCT already).
 */
import type { CompileMessage, CompileReply } from './compiler';
import { type OpenscadFactory, runOpenscad } from './run';

const ready = (async () => {
  const wasm = await WebAssembly.compileStreaming(
    fetch(new URL('../dist/openscad.wasm', import.meta.url)),
  );
  const glue = (await import(/* @vite-ignore */ new URL('../dist/openscad.js', import.meta.url).href)) as {
    default: OpenscadFactory;
  };
  return { wasm, factory: glue.default };
})();

self.addEventListener('message', async (event: MessageEvent<CompileMessage>) => {
  const message = event.data;
  let reply: CompileReply;
  try {
    const { wasm, factory } = await ready;
    reply = {
      id: message.id,
      raw: await runOpenscad(factory, wasm, message.request, message.heapMaxBytes),
    };
  } catch (error) {
    reply = { id: message.id, failure: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(reply);
});
