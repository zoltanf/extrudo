/**
 * The compiler's worker in Node (ADR-0071 §3). Node runs this file's
 * TypeScript as it is, so its imports carry their extension.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import type { CompileMessage, CompileReply } from './compiler.ts';
import { type OpenscadFactory, runOpenscad } from './run.ts';

const { dist } = workerData as { dist: string };
const ready = (async () => {
  const wasm = await WebAssembly.compile(readFileSync(`${dist}openscad.wasm`));
  const glue = (await import(pathToFileURL(`${dist}openscad.js`).href)) as {
    default: OpenscadFactory;
  };
  return { wasm, factory: glue.default };
})();

parentPort?.on('message', async (message: CompileMessage) => {
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
  parentPort?.postMessage(reply);
});
