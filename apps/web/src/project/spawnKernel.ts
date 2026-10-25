import { connectKernelWorker, type KernelConnection } from '@extrudo/kernel';

/**
 * Starts a project's kernel in its own module worker (`kernelWorker.ts`): the
 * kernel with the script runner (P5-02, ADR-0070 §2). Pass it to the
 * `Recomputer` as its `spawn`. Takes the spare kernel
 * `prewarmProjectKernel` started on the home screen, if any (ADR-0102 §8).
 */
export function spawnProjectKernel(): KernelConnection {
  return pool.spawn();
}

function startWorker(): KernelConnection {
  return connectKernelWorker(
    new Worker(new URL('./kernelWorker.ts', import.meta.url), {
      type: 'module',
      name: 'extrudo-kernel',
    }),
  );
}

const pool = createKernelPool(startWorker);

/**
 * Starts a spare kernel worker ahead of need (ADR-0102 §8), so the first
 * project finds the worker running and the OCCT WASM already compiled. No-op
 * where `Worker` is undefined (jsdom, Node).
 */
export function prewarmProjectKernel(): void {
  if (typeof Worker === 'undefined') return;
  pool.prewarm();
}

/**
 * A spare kernel started ahead of need, handed to the next spawn once
 * (ADR-0102 §8). At most one spare at a time: `prewarm()` is idempotent.
 * The spare registers `onFatal`: while it is still a spare, a death
 * terminates and drops it, and the next `spawn()` makes a fresh one; once it
 * is taken, that listener does nothing and the `KernelClient` registers its
 * own. `prewarm()` calls `api.init()` on the spare and swallows a rejection:
 * the client's own `init()` will see the same failure and report it as today.
 */
export function createKernelPool(make: () => KernelConnection): {
  /** Starts one spare if there is none. */
  prewarm(): void;
  /** Takes the spare once (then there is none), else makes a connection. */
  spawn(): KernelConnection;
} {
  let spare: KernelConnection | undefined;
  return {
    prewarm(): void {
      if (spare) return;
      const connection = make();
      spare = connection;
      connection.onFatal(() => {
        if (spare !== connection) return;
        spare = undefined;
        connection.terminate();
      });
      void connection.api.init().catch(() => {
        // The client's own `init()` reports the same failure as today.
      });
    },
    spawn(): KernelConnection {
      const taken = spare;
      spare = undefined;
      return taken ?? make();
    },
  };
}
