/**
 * One `ProjectStore` call over the bridge (P6-01, ADR-0075 §3): the plain
 * methods pass through, and the four that need marshalling for structured
 * clone are handled here — `load`/`importFile` collect the leniency notices
 * (the callback cannot cross IPC) into the answer, `thumbnail`/`exportFile`
 * return bytes where the store returns a Blob, and `setThumbnail` takes bytes.
 * A throw is caught and returned as `{ error: … }` data (P6-01's review), so
 * the store's error classes survive `invoke` and the renderer can rebuild them.
 * Free of Electron, so it is unit-tested against a memory store.
 */
import type { ProjectStore } from '@extrudo/storage';
import { type ErrorEnvelope, serializeError } from '../shared/errors';
import type { Noticed, StoreMethod } from '../shared/ipc';

export async function storeCall(
  store: ProjectStore,
  method: StoreMethod,
  args: unknown[],
): Promise<unknown | ErrorEnvelope> {
  try {
    return await runStoreCall(store, method, args);
  } catch (error) {
    return { error: serializeError(error) } satisfies ErrorEnvelope;
  }
}

async function runStoreCall(
  store: ProjectStore,
  method: StoreMethod,
  args: unknown[],
): Promise<unknown> {
  switch (method) {
    case 'load': {
      const notices: string[] = [];
      const value = await store.load(args[0] as Parameters<ProjectStore['load']>[0], {
        onNotice: (message) => notices.push(message),
      });
      return { value, notices } satisfies Noticed<unknown>;
    }
    case 'importFile': {
      const notices: string[] = [];
      const value = await store.importFile(new Blob([args[0] as Uint8Array<ArrayBuffer>]), {
        onNotice: (message) => notices.push(message),
      });
      return { value, notices } satisfies Noticed<unknown>;
    }
    case 'thumbnail': {
      const blob = await store.thumbnail(args[0] as Parameters<ProjectStore['thumbnail']>[0]);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    }
    case 'setThumbnail':
      await store.setThumbnail(
        args[0] as Parameters<ProjectStore['setThumbnail']>[0],
        new Blob([args[1] as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
      );
      return undefined;
    case 'exportFile': {
      const blob = await store.exportFile(args[0] as Parameters<ProjectStore['exportFile']>[0]);
      return new Uint8Array(await blob.arrayBuffer());
    }
    default: {
      const run = store[method] as (...callArgs: unknown[]) => Promise<unknown>;
      return run(...args);
    }
  }
}
