import type { KernelApi, KernelConnection } from '@extrudo/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_KERNEL_DIED, workerImportKernel } from './importKernel';
import { IMPORT_KERNEL_WORKER_NAME } from './kernelNames';
import { spawnProjectKernel } from './spawnKernel';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A connection whose calls never answer unless told to, and which can die. */
function fakeConnection(answer?: unknown) {
  const listeners: ((error: Error) => void)[] = [];
  const c = {
    terminated: false,
    calls: 0,
    die: (message: string) => {
      for (const l of listeners) l(new Error(message));
    },
    connection: {
      api: {
        storedShapeToStep: () => {
          c.calls++;
          return answer === undefined ? new Promise(() => {}) : Promise.resolve(answer);
        },
      } as unknown as KernelApi,
      terminate: () => {
        c.terminated = true;
      },
      onFatal: (listener: (error: Error) => void) => listeners.push(listener),
    } satisfies KernelConnection,
  };
  return c;
}

describe("the FreeCAD import's kernel worker (ADR-0144 decision 5)", () => {
  it('starts the kernel on the first call, replaces it on restart and ends it on dispose', async () => {
    const made: ReturnType<typeof fakeConnection>[] = [];
    const kernel = workerImportKernel(() => {
      const c = fakeConnection({ step: 'S', solids: 1 });
      made.push(c);
      return c.connection;
    });
    expect(made).toHaveLength(0);
    await expect(kernel.storedShapeToStep('text', [])).resolves.toMatchObject({ step: 'S' });
    expect(made).toHaveLength(1);
    await kernel.restart();
    expect(made[0]?.terminated).toBe(true);
    expect(made).toHaveLength(2);
    await kernel.storedShapeToStep('text', []);
    expect(made[1]?.calls).toBe(1);
    kernel.dispose();
    expect(made[1]?.terminated).toBe(true);
  });

  it('fails the call in progress at once when the kernel worker dies', async () => {
    const c = fakeConnection();
    const kernel = workerImportKernel(() => c.connection);
    const call = kernel.storedShapeToStep('text', []);
    c.die('out of memory');
    await expect(call).rejects.toThrow(`${IMPORT_KERNEL_DIED}: out of memory`);
  });
});

describe('which kernel worker is an import kernel (ADR-0144 decision 5)', () => {
  it("is named so only by the import's spawner, never by a project's", async () => {
    const started: { url: string; name?: string }[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        constructor(url: URL, options?: WorkerOptions) {
          started.push({ url: String(url), ...(options?.name ? { name: options.name } : {}) });
        }
        addEventListener() {}
        removeEventListener() {}
        postMessage() {}
        terminate() {}
      },
    );
    spawnProjectKernel().terminate();
    const kernel = workerImportKernel();
    void kernel.storedShapeToStep('text', []).catch(() => {});
    kernel.dispose();
    expect(started).toHaveLength(2);
    expect(started[0]?.name).toBe('extrudo-kernel');
    expect(started[1]?.name).toBe(IMPORT_KERNEL_WORKER_NAME);
    // The same entry: one kernel bundle in the build, not two.
    expect(started[1]?.url.replace(/\?.*$/, '')).toBe(started[0]?.url.replace(/\?.*$/, ''));
  });
});
