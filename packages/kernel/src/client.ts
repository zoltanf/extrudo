import { isKernelCrash, type KernelApi, KernelCrashError, type KernelInfo } from './service';

/** One running kernel: a worker in the app, or an in-process service in tests. */
export interface KernelConnection {
  api: KernelApi;
  /** Stops the kernel for good (terminates the worker). */
  terminate(): void;
  /**
   * Registers a listener for deaths outside a call, such as an uncaught error
   * that kills the worker. Pending calls never settle in that case, so the
   * client rejects them itself.
   */
  onFatal(listener: (error: Error) => void): void;
}

export type SpawnKernel = () => KernelConnection;

export type KernelStatus = 'idle' | 'starting' | 'ready' | 'restarting' | 'failed';

export interface KernelClientOptions {
  /** Restarts allowed within `restartWindowMs` before giving up. Default 3. */
  maxRestarts?: number;
  restartWindowMs?: number;
  onStatus?: (status: KernelStatus, detail?: string) => void;
  /**
   * Called after a restart, once the new kernel is ready. Phase 2 re-sends
   * the document here and marks the feature that crashed as an error.
   */
  onRestart?: (restarts: number) => void;
}

/**
 * Owns the kernel from the UI thread and keeps it alive (NFR-03). When a call
 * crashes the kernel, the call rejects with KernelCrashError and a fresh
 * kernel starts in the background. The crashing call is not retried: it would
 * probably crash again.
 */
export class KernelClient {
  readonly #spawn: SpawnKernel;
  readonly #options: KernelClientOptions;
  #connection: KernelConnection | undefined;
  #ready: Promise<KernelInfo> | undefined;
  #status: KernelStatus = 'idle';
  #crashTimes: number[] = [];
  #restarts = 0;
  readonly #pending = new Set<(error: Error) => void>();

  constructor(spawn: SpawnKernel, options: KernelClientOptions = {}) {
    this.#spawn = spawn;
    this.#options = options;
  }

  get status(): KernelStatus {
    return this.#status;
  }

  get restarts(): number {
    return this.#restarts;
  }

  /** Starts the kernel if needed and resolves once it is ready. */
  start(): Promise<KernelInfo> {
    this.#ready ??= this.#boot('starting');
    return this.#ready;
  }

  /** Runs `task` against the kernel. Rejects with KernelCrashError if the kernel dies meanwhile. */
  async call<T>(task: (api: KernelApi) => Promise<T>): Promise<T> {
    await this.start();
    const connection = this.#connection;
    if (!connection) throw new KernelCrashError('The kernel is not running.');
    let reject: ((error: Error) => void) | undefined;
    const died = new Promise<never>((_, r) => {
      reject = r;
    });
    if (reject) this.#pending.add(reject);
    try {
      return await Promise.race([task(connection.api), died]);
    } catch (error) {
      if (isKernelCrash(error) && this.#connection === connection) this.#crashed(error as Error);
      throw error;
    } finally {
      if (reject) this.#pending.delete(reject);
    }
  }

  /** Stops the kernel. The client can be started again. */
  dispose(): void {
    this.#connection?.terminate();
    this.#connection = undefined;
    this.#ready = undefined;
    this.#setStatus('idle');
  }

  async #boot(status: 'starting' | 'restarting'): Promise<KernelInfo> {
    this.#setStatus(status);
    const connection = this.#spawn();
    this.#connection = connection;
    connection.onFatal((error) => {
      if (this.#connection !== connection) return;
      const crash = new KernelCrashError(`The kernel stopped: ${error.message}`);
      for (const reject of this.#pending) reject(crash);
      this.#crashed(crash);
    });
    try {
      const info = await connection.api.init();
      if (this.#connection === connection) this.#setStatus('ready');
      return info;
    } catch (error) {
      this.#setStatus('failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  #crashed(error: Error): void {
    this.#connection?.terminate();
    this.#connection = undefined;
    const now = Date.now();
    const window = this.#options.restartWindowMs ?? 60_000;
    this.#crashTimes = [...this.#crashTimes.filter((t) => now - t < window), now];
    if (this.#crashTimes.length > (this.#options.maxRestarts ?? 3)) {
      this.#ready = Promise.reject(
        new KernelCrashError(`The kernel keeps stopping; last error: ${error.message}`),
      );
      this.#ready.catch(() => {});
      this.#setStatus('failed', error.message);
      return;
    }
    this.#restarts++;
    const ready = this.#boot('restarting');
    this.#ready = ready;
    ready.then(
      () => this.#options.onRestart?.(this.#restarts),
      () => {},
    );
  }

  #setStatus(status: KernelStatus, detail?: string): void {
    this.#status = status;
    this.#options.onStatus?.(status, detail);
  }
}
