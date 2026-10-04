/**
 * Writing a linked project back to its file in the linked folder (FR-PRJ-06,
 * P4-09, ADR-0065 §3). Pure: the caller says what the file looks like on disk
 * and how to write bytes, and this decides between writing, waiting and
 * saying that the file changed under it. Nothing here knows about toasts,
 * documents or React — the app's glue (see `useLinkedFolder`) reads the
 * outcome.
 *
 * A save writes the archive (`ProjectStore.archiveBytes`, exactly what an
 * export downloads) into the file, at most once every {@link
 * LINK_THROTTLE_MS} and with the throttle trailing, and once more when the
 * project closes. Before writing, the file's own `lastModified` is compared
 * with the one recorded in the project index: someone else changed the file,
 * so nothing is written.
 */
import { FILE_EXTENSION } from '@extrudo/core';
import type { LinkedFile } from '@extrudo/storage';
import { safeFileName } from '../platform/files';

/** How long a linked file waits between writes; the last save in a burst gets through. */
export const LINK_THROTTLE_MS = 10_000;

/** The name a project takes in the linked folder, as for an export. */
export const linkedName = (projectName: string): string =>
  safeFileName(projectName, FILE_EXTENSION);

export type LinkOutcome =
  /** The file was written, at `modified`. */
  | { kind: 'written'; file: string; modified: number }
  /** Nothing to do: no link, or a write is already on its way. */
  | { kind: 'skipped' }
  /** The file on disk isn't the one we wrote (someone else has it). */
  | { kind: 'conflict'; file: string; onDisk: number }
  /** The file is gone, or we may not write it: nothing was written. */
  | { kind: 'error'; file: string; message: string };

/** A timer the throttle schedules through, so a test can run the write itself. */
export interface LinkTimer {
  later(fn: () => void, ms: number): void;
  cancel(handle: unknown): void;
}

const realTimer: LinkTimer = {
  // The handle is what `cancel` needs, so it isn't thrown away.
  later: (fn, ms) => setTimeout(fn, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LinkContext {
  /** The file this project is linked to, or `undefined` when it isn't linked. */
  link(): LinkedFile | undefined;
  /** Records the link (or clears it) in the project index (ADR-0065 §3). */
  saveLink(link: LinkedFile | undefined): Promise<void>;
  /** The file's `lastModified` right now, or `undefined` when it isn't there. */
  onDisk(name: string): Promise<number | undefined>;
  /**
   * The project's `.extrudo` bytes, built when the write happens: the trailing
   * write then holds the newest state, not the one from ten seconds ago.
   */
  archive(): Promise<Uint8Array>;
  /** Writes the bytes and answers the file's new `lastModified`. */
  write(name: string, bytes: Uint8Array): Promise<number>;
  /**
   * Called with every outcome, **including the one a trailing write gives ten
   * seconds after the last save**: a write the caller didn't await still has to
   * be able to say that the file changed on disk.
   */
  report?(outcome: LinkOutcome): void;
  /** Clock, for tests. */
  now?(): number;
  /** Timer, for tests. */
  timer?: LinkTimer;
}

export interface LinkSync {
  /**
   * Called after each autosave. Writes at most once every
   * {@link LINK_THROTTLE_MS}: an earlier call than that schedules the write
   * for when the throttle is up, with whatever state the project has then.
   */
  saved(): Promise<LinkOutcome>;
  /** A last write, whatever the throttle says (the project is closing). */
  flush(): Promise<LinkOutcome>;
  /**
   * Starts writing this project to `file`, creating it: the "Save to Linked
   * Folder" command (ADR-0065 §3). Whether a file of that name is already
   * there is the caller's business — it refuses — so this writes whatever is
   * there and records the link with the time the file then says.
   */
  link(file: string): Promise<LinkOutcome>;
  /** Whether a trailing write is waiting. */
  readonly pending: () => boolean;
}

export function createLinkSync(ctx: LinkContext): LinkSync {
  const now = ctx.now ?? (() => Date.now());
  const timer = ctx.timer ?? realTimer;
  let lastWrite = Number.NEGATIVE_INFINITY;
  let waiting: unknown;
  let running: Promise<LinkOutcome> | undefined;

  /** Writes the bytes into `file`, recording the link with the file's new time. */
  const writeFile = async (file: string): Promise<LinkOutcome> => {
    try {
      const bytes = await ctx.archive();
      const modified = await ctx.write(file, bytes);
      await ctx.saveLink({ file, modified });
      lastWrite = now();
      return { kind: 'written', file, modified };
    } catch (error) {
      // Permission can lapse at any reload, and a file can be removed while the
      // project is open: a message, never an error thrown into autosave.
      return { kind: 'error', file, message: messageOf(error) };
    }
  };

  const write = async (): Promise<LinkOutcome> => {
    const link = ctx.link();
    if (!link) return { kind: 'skipped' };
    const { file } = link;
    try {
      const onDisk = await ctx.onDisk(file);
      if (onDisk === undefined) {
        return { kind: 'error', file, message: `${file} isn't in the linked folder any more.` };
      }
      if (onDisk !== link.modified) return { kind: 'conflict', file, onDisk };
    } catch (error) {
      return { kind: 'error', file, message: messageOf(error) };
    }
    return writeFile(file);
  };

  const settle = async (write: Promise<LinkOutcome>): Promise<LinkOutcome> => {
    const outcome = await write;
    ctx.report?.(outcome);
    return outcome;
  };

  const sync = async (force: boolean): Promise<LinkOutcome> => {
    // One write at a time: a save while a write runs joins it.
    if (running) return running;
    const link = ctx.link();
    if (!link) return { kind: 'skipped' };
    const wait = LINK_THROTTLE_MS - (now() - lastWrite);
    if (!force && wait > 0) {
      if (waiting !== undefined) timer.cancel(waiting);
      waiting = timer.later(() => {
        waiting = undefined;
        void sync(true);
      }, wait);
      return { kind: 'skipped' };
    }
    running = settle(write()).finally(() => {
      running = undefined;
    });
    return running;
  };

  return {
    saved: () => sync(false),
    flush: () => sync(true),
    link: (file: string) => settle(writeFile(file)),
    pending: () => waiting !== undefined,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a file of that name is already in the folder: "Save to Linked
 * Folder" refuses rather than overwriting a file nobody made here
 * (ADR-0065 §3).
 */
export function nameTaken(files: readonly { name: string }[], file: string): boolean {
  return files.some((f) => f.name === file);
}
