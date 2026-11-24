/**
 * The import kernel's budgets and failures (ADR-0144 S3's rules, which S5
 * extends to the history walk): each call has its time (`SHAPE_TIMEOUT_MS`)
 * within the import's (`IMPORT_TIMEOUT_MS`); a call that throws, runs over
 * its time or answers with something that makes no sense restarts the kernel
 * (at most `MAX_RESTARTS` times, then every later call is refused), and a late
 * answer from the old kernel is never used. One budget is shared by the walk
 * over the bodies and the shapes import after it.
 *
 * S13: an error the kernel itself raises about its input (`KernelError` and
 * its kinds: OCCT refused the text, the shape, the operation) is an answer,
 * not a failure: the kernel that raised it is sound, so it costs no restart
 * and doesn't count against `MAX_RESTARTS`. Only a kernel that died, trapped,
 * ran over its time or answered nonsense is replaced.
 */
import type { ImportKernel } from './import-kernel';

/** One shape's conversion, or one rebuild or measure. The library's slowest takes a few seconds. */
export const SHAPE_TIMEOUT_MS = 60_000;
/** The whole import. The library's slowest file takes about twenty seconds. */
export const IMPORT_TIMEOUT_MS = 10 * 60_000;
/** How many times a failed kernel is replaced before every later call is refused. */
export const MAX_RESTARTS = 3;

/**
 * The names of the kernel's own refusals (`KernelError` and every class that
 * extends it, at any depth, in `@extrudo/kernel`; a test keeps the list in step). A class that
 * doesn't set its own name crosses a worker as `KernelError`. A crash is
 * `KernelCrashError`, a dead worker a plain `Error`: neither is here.
 */
export const KERNEL_REFUSALS: ReadonlySet<string> = new Set([
  'KernelError',
  'MeshError',
  'MeshBodyError',
  'FilletError',
  'ChamferError',
  'ShellError',
  'OffsetFaceError',
  'RemoveFacesError',
  'DraftError',
  'SweepError',
  'LoftError',
  'PathError',
  'ScriptRunError',
  'LostReferenceError',
  'MissingFileError',
  'Unavailable',
]);

/**
 * The kinds of `KernelError` that mean the kernel failed rather than refused (none today); a
 * test fails on a class that extends `KernelError`, at any depth, in neither list.
 */
export const KERNEL_FAILURES: ReadonlySet<string> = new Set<string>();

/** Whether `error` is the kernel refusing its input, by its name (it crosses a worker as a copy). */
export const isKernelRefusal = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { name?: unknown }).name === 'string' &&
  KERNEL_REFUSALS.has((error as { name: string }).name);

/**
 * S13: after a refusal, the kernel is replaced when its heap's top has passed this many bytes
 * (a failed allocation inside OCCT comes back as a refusal too, and leaves the heap grown):
 * the project kernel's own threshold for a fresh worker (`HEAP_RECYCLE_BYTES` in
 * `@extrudo/kernel`, ADR-0067 §H4; a test keeps them equal). The heap only grows, so a kernel
 * that kept refusing large shapes would otherwise go on with a heap near the limit of its build.
 */
export const IMPORT_HEAP_RECYCLE_BYTES = 1024 * 1024 * 1024;

/**
 * S13: the share of the import's time refused calls may take together, each counted only past
 * `REFUSAL_ALLOWANCE_MS`. A quick refusal costs nothing; a file whose shapes each keep the
 * kernel busy and are then refused gets a quarter of the import, and every call after that is
 * left out with the import's time, as the restarts used to end such a file after four calls.
 * The share is tested when a call starts, so one call may take it past by its own time (at most
 * a shape's 60 s); the heap read after a refusal is inside the import's time too.
 */
export const MAX_REFUSED_SHARE = 0.25;

/**
 * S13: the time a refused call may take before it counts toward `MAX_REFUSED_SHARE`, ms. The
 * kernel refuses text it can't read at the first table it fails on, in milliseconds (the
 * hostile tests' refusals); a second is far past that and far under a shape's 60 s, so only a
 * refusal that kept the kernel working counts, and only for the time past the allowance.
 */
export const REFUSAL_ALLOWANCE_MS = 1_000;

/** The detail of a call not made because refusals took their share of the import's time. */
export const REFUSED_TIME = 'the geometry kernel refused shapes for too long';

/** The detail for a reply that fails its sanity check. */
export const NONSENSE_REPLY = "the kernel's answer makes no sense";

/** What a call came to. Anything but `done` has restarted the kernel when it could. */
export type CallOutcome<T> =
  | { readonly kind: 'done'; readonly value: T }
  /**
   * The kernel threw, or its answer makes no sense (`detail` says which).
   * `refused`: it raised one of its own refusals, so it was not restarted.
   */
  | { readonly kind: 'kernel'; readonly detail: string; readonly refused?: true }
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
  /** `IMPORT_HEAP_RECYCLE_BYTES`, for tests. */
  readonly heapRecycleBytes?: number;
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
  readonly #heapLimit: number;
  #restarts = 0;
  #refusals = 0;
  #refusedMs = 0;
  #broken = false;

  constructor(kernel: ImportKernel, options: BudgetOptions = {}) {
    this.kernel = kernel;
    this.#now = options.now ?? Date.now;
    this.#start = this.#now();
    this.#shapeMs = options.shapeTimeoutMs ?? SHAPE_TIMEOUT_MS;
    this.#importMs = options.importTimeoutMs ?? IMPORT_TIMEOUT_MS;
    this.#maxRestarts = options.maxRestarts ?? MAX_RESTARTS;
    this.#heapLimit = options.heapRecycleBytes ?? IMPORT_HEAP_RECYCLE_BYTES;
  }

  /** How many times the kernel was replaced. */
  get restarts(): number {
    return this.#restarts;
  }

  /** How many calls the kernel refused (S13): answers, so no restart. */
  get refusals(): number {
    return this.#refusals;
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
    if (this.#refusedMs >= MAX_REFUSED_SHARE * this.#importMs)
      return { kind: 'import-time', detail: REFUSED_TIME };
    const started = this.#now();
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
            (error: unknown) => ({ error: message(error), refused: isKernelRefusal(error) }),
          ),
        late,
      ]);
      if (raced === 'time') {
        const detail = `over ${Math.round(ms / 1000)} s`;
        outcome =
          this.#shapeMs <= left ? { kind: 'time', detail } : { kind: 'import-time', detail };
      } else if ('error' in raced) {
        // The kernel's own refusal: the kernel that answered stays, unless its heap has grown
        // past what a fresh worker would be started for (the words of a refusal can quote the
        // file, so they decide nothing).
        if (raced.refused) {
          this.#refusals++;
          this.#refusedMs += Math.max(0, this.#now() - started - REFUSAL_ALLOWANCE_MS);
          if (!(await this.#heapTooLarge()))
            return { kind: 'kernel', detail: raced.error, refused: true };
        }
        outcome = { kind: 'kernel', detail: raced.error };
      } else if (!sane(raced.value)) outcome = { kind: 'kernel', detail: NONSENSE_REPLY };
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

  /** Whether the kernel's heap top is past `IMPORT_HEAP_RECYCLE_BYTES` (false when it can't say). */
  async #heapTooLarge(): Promise<boolean> {
    const heap = this.kernel.heap;
    if (!heap) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const top = await Promise.race([
        heap.call(this.kernel).then((h) => h.top),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), Math.min(5_000, Math.max(0, this.left())));
        }),
      ]);
      return typeof top === 'number' && top > this.#heapLimit;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
