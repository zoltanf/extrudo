/**
 * One `PluginStore` call over the bridge (P6-03 slice 2, ADR-0077 §4): the
 * method is one of `PLUGIN_METHODS`, and its arguments are checked here before
 * the store sees them — an ID is a string, `enabled` a boolean, a file a
 * `Uint8Array` — so a renderer can't hand main anything else. Every answer is
 * structured-clonable as the store gives it (summaries, bytes, a read file). A
 * throw comes back as `{ error: … }` data like `store-call.ts`'s, so the
 * renderer rebuilds the class and the reader's words survive.
 */
import type { PluginStore } from '@extrudo/storage';
import { type ErrorEnvelope, serializeError } from '../shared/errors';
import { isPluginMethod, type PluginMethod } from '../shared/ipc';

export async function pluginCall(
  store: PluginStore,
  method: PluginMethod,
  args: unknown[],
): Promise<unknown | ErrorEnvelope> {
  try {
    return await runPluginCall(store, method, args);
  } catch (error) {
    return { error: serializeError(error) } satisfies ErrorEnvelope;
  }
}

const id = (value: unknown): string => {
  if (typeof value !== 'string') throw new TypeError('A plugin ID must be a string.');
  return value;
};

async function runPluginCall(
  store: PluginStore,
  method: PluginMethod,
  args: unknown[],
): Promise<unknown> {
  if (!isPluginMethod(method)) throw new Error(`Unknown plugin method: ${String(method)}`);
  switch (method) {
    case 'list':
      return store.list();
    case 'install': {
      const bytes = args[0];
      if (!(bytes instanceof Uint8Array)) throw new TypeError('A plugin file must be bytes.');
      return store.install(bytes);
    }
    case 'remove':
      return store.remove(id(args[0]));
    case 'setEnabled': {
      if (typeof args[1] !== 'boolean') throw new TypeError('`enabled` must be true or false.');
      return store.setEnabled(id(args[0]), args[1]);
    }
    case 'bytes':
      return store.bytes(id(args[0]));
    case 'read':
      return store.read(id(args[0]));
  }
}
