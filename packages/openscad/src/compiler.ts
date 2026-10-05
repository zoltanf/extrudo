/**
 * The compiler on the caller's side (ADR-0071 §3): one worker that holds the
 * compiled WASM, one compile at a time, a time limit that terminates the
 * worker (a new one starts with the next compile) and the wording of what
 * came back. `./node` and `./browser` give it their kind of worker.
 */
import type { ScadCompiler, ScadLimits, ScadRequest, ScadResult } from './index';
import { DEFAULT_HEAP_MAX_BYTES, DEFAULT_TIMEOUT_MS, explainRun } from './messages';
import type { RawRun } from './run';

/** A message to the worker: one compile. */
export interface CompileMessage {
  id: number;
  request: ScadRequest;
  heapMaxBytes: number;
}

/** The worker's answer: the run, or why it couldn't start one. */
export type CompileReply = { id: number; raw: RawRun } | { id: number; failure: string };

/** What the compiler needs of a worker, in either world. */
export interface CompilerWorker {
  post(message: CompileMessage): void;
  /** Busy: keep the process alive (Node) while a compile runs. */
  busy(busy: boolean): void;
  terminate(): void;
}

export type SpawnWorker = (handlers: {
  reply(reply: CompileReply): void;
  /** The worker died (a load failure, an uncaught error). */
  fail(message: string): void;
}) => CompilerWorker;

export class WorkerCompiler implements ScadCompiler {
  readonly #spawn: SpawnWorker;
  readonly #timeoutMs: number;
  readonly #heapMaxBytes: number;
  #worker: CompilerWorker | undefined;
  #next = 0;
  #pending:
    | { id: number; request: ScadRequest; resolve(result: ScadResult): void; timer: unknown }
    | undefined;
  /** Compiles run one after another. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(spawn: SpawnWorker, limits: ScadLimits = {}) {
    this.#spawn = spawn;
    this.#timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#heapMaxBytes = limits.heapMaxBytes ?? DEFAULT_HEAP_MAX_BYTES;
  }

  compile(request: ScadRequest): Promise<ScadResult> {
    const run = this.#queue.then(() => this.#compile(request));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  dispose(): void {
    this.#stop();
    this.#settle(failure('The OpenSCAD compiler was stopped.'));
  }

  #compile(request: ScadRequest): Promise<ScadResult> {
    const worker = this.#ensure();
    const id = this.#next++;
    return new Promise<ScadResult>((resolve) => {
      const timer = setTimeout(() => {
        // A compile can't be interrupted: the worker goes, and the next
        // compile starts a new one (ADR-0071 §3).
        this.#stop();
        const seconds = Math.round(this.#timeoutMs / 1000);
        this.#settle(
          failure(
            `${request.fileName} took longer than ${seconds} s to compile, so Extrudo stopped it: simplify the model (a lower $fn, fewer minkowski steps).`,
            this.#timeoutMs,
          ),
        );
      }, this.#timeoutMs);
      this.#pending = { id, request, resolve, timer };
      worker.busy(true);
      // The bytes are copied, not moved: the caller keeps its file.
      worker.post({ id, request, heapMaxBytes: this.#heapMaxBytes });
    });
  }

  #ensure(): CompilerWorker {
    this.#worker ??= this.#spawn({
      reply: (reply) => {
        const pending = this.#pending;
        if (!pending || pending.id !== reply.id) return;
        this.#settle(
          'raw' in reply
            ? explainRun(reply.raw, pending.request, { heapMaxBytes: this.#heapMaxBytes })
            : failure(`OpenSCAD couldn't start: ${reply.failure}`),
        );
      },
      fail: (message) => {
        this.#stop();
        const name = this.#pending?.request.fileName ?? 'the file';
        this.#settle(failure(`OpenSCAD stopped while compiling ${name}: ${message}.`));
      },
    });
    return this.#worker;
  }

  #settle(result: ScadResult): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = undefined;
    clearTimeout(pending.timer as ReturnType<typeof setTimeout>);
    this.#worker?.busy(false);
    pending.resolve(result);
  }

  #stop(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
  }
}

function failure(error: string, ms = 0): ScadResult {
  return { ok: false, error, warnings: [], ms };
}
