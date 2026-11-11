/**
 * The import kernel's budgets and failures (ADR-0144 S3's rules, which S5
 * extends to the history walk): each call has its time (`SHAPE_TIMEOUT_MS`)
 * within the import's (`IMPORT_TIMEOUT_MS`); a call that throws, runs over
 * its time or answers with something that makes no sense restarts the kernel
 * (at most `MAX_RESTARTS` times, then every later call is refused), and a late
 * answer from the old kernel is never used. One budget is shared by the walk
 * over the bodies and the shapes import after it.
 */
import type { ImportKernel } from './import-kernel';

/** One shape's conversion, or one rebuild or measure. The library's slowest takes a few seconds. */
export const SHAPE_TIMEOUT_MS = 60_000;
/** The whole import. The library's slowest file takes about twenty seconds. */
export const IMPORT_TIMEOUT_MS = 10 * 60_000;
/** How many times a failed kernel is replaced before every later call is refused. */
export const MAX_RESTARTS = 3;

/** The detail for a reply that fails its sanity check. */
export const NONSENSE_REPLY = "the kernel's answer makes no sense";

/** What a call came to. Anything but `done` has restarted the kernel when it could. */
export type CallOutcome<T> =
  | { readonly kind: 'done'; readonly value: T }
  /** The kernel threw, or its answer makes no sense (`detail` says which). */
  | { readonly kind: 'kernel'; readonly detail: string }
  /** The call ran over its own time. */
  | { readonly kind: 'time'; readonly detail: string }
  /** The import's time ran out, before or during the call. */
  | { readonly kind: 'import-time'; readonly detail?: string }
  /** The kernel failed too often: the call was not made. */
  | { readonly kind: 'restarts' };

export interface BudgetOptions {
  readonly shapeTimeoutMs?: number;
  readonly importTimeoutMs?: number;
  readonly maxRestarts?: number;
  /** The clock (`Date.now` by default). */
  readonly now?: () => number;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class KernelBudget {
  readonly kernel: ImportKernel;
  readonly #now: () => number;
  readonly #start: number;
  readonly #shapeMs: number;
  readonly #importMs: number;
  readonly #maxRestarts: number;
  #restarts = 0;
  #broken = false;

  constructor(kernel: ImportKernel, options: BudgetOptions = {}) {
    this.kernel = kernel;
    this.#now = options.now ?? Date.now;
    this.#start = this.#now();
    this.#shapeMs = options.shapeTimeoutMs ?? SHAPE_TIMEOUT_MS;
    this.#importMs = options.importTimeoutMs ?? IMPORT_TIMEOUT_MS;
    this.#maxRestarts = options.maxRestarts ?? MAX_RESTARTS;
  }

  /** How many times the kernel was replaced. */
  get restarts(): number {
    return this.#restarts;
  }

  /** The kernel failed too often: no further call is made. */
  get broken(): boolean {
    return this.#broken;
  }

  /** The import's time left, ms. */
  left(): number {
    return this.#start + this.#importMs - this.#now();
  }

  /**
   * Runs `work` on the kernel under the budget. An answer is used only when
   * `sane` passes; a failure of any kind restarts the kernel before the next call.
   */
  async call<T>(
    work: () => Promise<T>,
    sane: (reply: unknown) => reply is T,
  ): Promise<CallOutcome<T>> {
    if (this.#broken) return { kind: 'restarts' };
    const left = this.left();
    if (left <= 0) return { kind: 'import-time' };
    const ms = Math.min(this.#shapeMs, left);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'time'>((resolve) => {
      timer = setTimeout(() => resolve('time'), Math.max(0, ms));
    });
    let outcome: CallOutcome<T>;
    try {
      const raced = await Promise.race([
        // A `work` that throws before it returns a promise fails like one that rejects.
        Promise.resolve()
          .then(work)
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error: message(error) }),
          ),
        late,
      ]);
      if (raced === 'time') {
        const detail = `over ${Math.round(ms / 1000)} s`;
        outcome =
          this.#shapeMs <= left ? { kind: 'time', detail } : { kind: 'import-time', detail };
      } else if ('error' in raced) outcome = { kind: 'kernel', detail: raced.error };
      else if (!sane(raced.value)) outcome = { kind: 'kernel', detail: NONSENSE_REPLY };
      else return { kind: 'done', value: raced.value };
    } finally {
      clearTimeout(timer);
    }
    // A failed kernel may be corrupted: nothing more from it.
    if (this.#restarts >= this.#maxRestarts) this.#broken = true;
    else {
      this.#restarts++;
      try {
        await this.kernel.restart();
      } catch {
        this.#broken = true;
      }
    }
    return outcome;
  }
}
