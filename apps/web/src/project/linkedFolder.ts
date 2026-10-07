/**
 * A linked project's end of the linked folder (FR-PRJ-06, P4-09, ADR-0065
 * §3): the browser's copy stays primary and this file is written beside it —
 * after each autosave (throttled, see `linkedSync`), when the project closes,
 * and once for the first time from the "Save to Linked Folder" command.
 *
 * Not React: the two answers a conflict toast offers are clicked from the
 * notification store, long after the render that made the toast, so what the
 * toast needs is a plain object with a `LinkSync` inside. The decisions are
 * `linkedSync`'s (pure, tested); this is the part that knows about documents,
 * the project index and toasts.
 */
import type { DocumentStore, ExtrudoDocument } from '@extrudo/core';
import { type LinkedFile, type ProjectStore, readArchive } from '@extrudo/storage';
import type { ToastOptions } from '../design-system';
import type { ExternalFiles, FolderLink, LinkedFolders } from '../platform';
import { describeError } from './actions';
import type { Autosaver } from './autosave';
import {
  createLinkSync,
  type LinkContext,
  type LinkOutcome,
  type LinkTimer,
  linkedName,
  nameTaken,
} from './linkedSync';
import { endBeforeRestore } from './restoreGuard';

export interface LinkedContext {
  /** The folder this browser has linked (ADR-0065 §3). */
  folders: LinkedFolders;
  /**
   * Where an `external` link writes (P6-01 slice 2, finding 3). Desktop only;
   * an external link with no `externalFiles` (the web) reads as "not in the
   * linked folder", as it did before.
   */
  externalFiles?: ExternalFiles;
  projects: ProjectStore;
  store: DocumentStore;
  /** The browser's own save, flushed before the file is written so the two agree. */
  autosave: Pick<Autosaver, 'flush'>;
  /** The link in the project index, as the app read it while opening. */
  link?: LinkedFile;
  /** Says something to the user. */
  notify(tone: 'info' | 'success' | 'error', text: string, options?: ToastOptions): void;
  /** Brings a document into the open design as one undo step (ADR-0036's path). */
  restore(doc: ExtrudoDocument, label: string): Promise<void>;
  /** Clock and timer, for tests. */
  now?(): number;
  timer?: LinkTimer;
}

export interface LinkedProject {
  /** The file this project is linked to, or undefined. */
  link(): LinkedFile | undefined;
  /** Called after each successful autosave; writes at most once every 10 s. */
  afterSave(): Promise<void>;
  /** A last write, whatever the throttle says (the project is closing). */
  close(): Promise<LinkOutcome>;
  /**
   * Writes `<project name>.extrudo` into the folder and links the project to
   * it. Refuses a name that is already there (ADR-0065 §3).
   */
  linkNow(): Promise<LinkOutcome>;
}

/** The folder we may write, or a message saying why we may not. */
async function writable(folders: LinkedFolders): Promise<FolderLink> {
  const folder = await folders.current();
  if (!folder) {
    throw new Error('There is no linked folder. Link one on the home screen.');
  }
  if ((await folder.permission()) !== 'granted') {
    throw new Error(
      `Extrudo may not write to ${folder.name} yet. Reconnect it on the home screen.`,
    );
  }
  return folder;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createLinkedProject(ctx: LinkedContext): LinkedProject {
  const id = ctx.store.getState().doc.id;
  let link: LinkedFile | undefined = ctx.link;
  /** The file that changed on disk, and what was on it: what a conflict toast answers. */
  let conflict: { file: string; onDisk: number } | undefined;
  /**
   * The link is in the project index, not the document (ADR-0065 §3), so it is
   * read when the project opens. A write waits for it: the first autosave must
   * not be the one that finds no link and does nothing.
   */
  const ready: Promise<void> = ctx.projects
    .get(id)
    .then((summary) => {
      link ??= summary?.linked;
    })
    .catch(() => {});

  /** Whether the current link is to a real path main issued (P6-01 slice 2). */
  const isExternal = () => link?.external === true;

  /** The file's time on disk: an external path through main, else the folder. */
  const onDisk = async (name: string): Promise<number | undefined> => {
    if (isExternal()) {
      const external = ctx.externalFiles;
      // The web has no path write-back: an external link reads as gone.
      if (!external) return undefined;
      return (await external.stat(name))?.modified;
    }
    const folder = await writable(ctx.folders);
    return (await folder.list()).find((f) => f.name === name)?.modified;
  };

  /** The file's bytes: an external path through main, else the folder. */
  const readFile = async (name: string): Promise<{ bytes: Uint8Array; modified: number }> => {
    if (isExternal()) {
      const external = ctx.externalFiles;
      if (!external) throw new Error(`${name} isn't in the linked folder any more.`);
      return external.read(name);
    }
    return writable(ctx.folders).then((folder) => folder.read(name));
  };

  const sync = createLinkSync({
    link: () => link,
    saveLink: async (next) => {
      // The external flag is the link's, not the write's: carry it through.
      link = next && isExternal() ? { ...next, external: true } : next;
      await ctx.projects.link(id, link);
    },
    onDisk,
    archive: () => ctx.projects.archiveBytes(id),
    write: async (name, bytes) => {
      if (isExternal()) {
        const external = ctx.externalFiles;
        if (!external) throw new Error(`${name} isn't in the linked folder any more.`);
        return (await external.write(name, bytes)).modified;
      }
      return (await writable(ctx.folders)).write(name, bytes).then((w) => w.modified);
    },
    // Every outcome, including the one a trailing write gives ten seconds
    // later: a conflict the user never hears about is data they can lose.
    report: say,
    now: ctx.now,
    timer: ctx.timer,
  } satisfies LinkContext);

  /** A conflict only matters while the file is still linked and still differs. */
  const applies = () => conflict !== undefined && link?.file === conflict?.file;

  /** What an outcome means to the user: a conflict with two answers, or a message. */
  function say(outcome: LinkOutcome): LinkOutcome {
    if (outcome.kind === 'conflict') {
      conflict = { file: outcome.file, onDisk: outcome.onDisk };
      ctx.notify('error', `${outcome.file} changed on disk.`, {
        // Errors stay until dismissed: someone else has the file, and only the
        // user can say which side wins.
        actions: [
          { label: 'Load from disk', run: () => void loadFromDisk(), available: applies },
          { label: 'Overwrite', run: () => void overwrite(), available: applies },
        ],
      });
    } else if (outcome.kind === 'error') {
      ctx.notify('error', outcome.message);
    }
    return outcome;
  }

  /** Puts the file's document into the design, one undo step (ADR-0065 §3). */
  const loadFromDisk = async (): Promise<void> => {
    const current = conflict;
    if (!current || !applies()) return;
    conflict = undefined;
    try {
      const { bytes } = await readFile(current.file);
      const archive = readArchive(bytes);
      // The bytes before the document that names them (ADR-0061 §2).
      for (const [sha256, file] of archive.attachments) {
        if (!(await ctx.projects.readAttachment(id, sha256))) {
          await ctx.projects.writeAttachment(id, sha256, file);
        }
      }
      // A whole document in one undo step: end whatever holds a transaction.
      endBeforeRestore();
      await ctx.restore({ ...archive.doc, id }, current.file);
      ctx.notify('success', `Loaded ${current.file} from the linked folder.`);
    } catch (error) {
      ctx.notify('error', `Couldn't load ${current.file}: ${describeError(error)}`);
    }
  };

  /** Takes the file as it is now and writes over it. */
  const overwrite = async (): Promise<void> => {
    const current = conflict;
    if (!current || !applies()) return;
    conflict = undefined;
    // The file as it is on disk is what we take over, so the write doesn't see
    // its own change as someone else's.
    link = {
      file: current.file,
      modified: current.onDisk,
      ...(link?.external ? { external: true as const } : {}),
    };
    await ctx.projects.link(id, link);
    await sync.flush();
  };

  return {
    link: () => link,
    async afterSave() {
      await ready;
      await sync.saved();
    },
    async close(): Promise<LinkOutcome> {
      await ready;
      await ctx.autosave.flush();
      return sync.flush();
    },
    async linkNow() {
      const file = linkedName(ctx.store.getState().doc.name);
      await ready;
      await ctx.autosave.flush();
      try {
        const folder = await writable(ctx.folders);
        if (nameTaken(await folder.list(), file)) {
          const message = `A file named ${file} is already there.`;
          ctx.notify('error', message);
          return { kind: 'error', file, message };
        }
        const outcome = await sync.link(file);
        // The command ran once on purpose, so it says it worked (an export does).
        if (outcome.kind === 'written') {
          ctx.notify('success', `Saved ${file} to the linked folder.`);
        }
        return outcome;
      } catch (error) {
        const message = messageOf(error);
        ctx.notify('error', message);
        return { kind: 'error', file, message };
      }
    },
  };
}
