/**
 * Rescue copies of unsaved documents (a platform interface, architecture
 * §8). Autosave writes to IndexedDB and OPFS, which are asynchronous, and a
 * page that reloads or closes stops that write half-way: the last edit was
 * lost. So when the page is hidden with unsaved changes, the document also
 * goes into a store that writes synchronously (localStorage on the web; the
 * desktop build can write a file). A save that catches up clears the copy;
 * at startup, `recoverRescued` saves the copies left behind as their
 * projects before anything opens.
 */
import { type ExtrudoDocument, loadDocument } from '@extrudo/core';
import type { ProjectId, ProjectStore } from '@extrudo/storage';

export interface RescueStore {
  /** Keeps a copy of the document before returning. False if it couldn't (quota). */
  put(doc: ExtrudoDocument): boolean;
  clear(id: ProjectId): void;
  /** Every copy left behind, as stored (not yet migrated or validated). */
  list(): { id: ProjectId; raw: unknown }[];
}

const PREFIX = 'extrudo.rescue.';

/** Rescue copies in localStorage. Storage errors are reported by `put` or ignored. */
export function webRescue(storage: Storage | undefined = globalThis.localStorage): RescueStore {
  return {
    put(doc) {
      try {
        storage?.setItem(PREFIX + doc.id, JSON.stringify(doc));
        return !!storage;
      } catch {
        return false;
      }
    },
    clear(id) {
      try {
        storage?.removeItem(PREFIX + id);
      } catch {
        // Nothing to clear if storage can't be read.
      }
    },
    list() {
      const out: { id: ProjectId; raw: unknown }[] = [];
      try {
        if (!storage) return out;
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key?.startsWith(PREFIX)) continue;
          let raw: unknown;
          try {
            raw = JSON.parse(storage.getItem(key) ?? 'null');
          } catch {
            raw = null;
          }
          out.push({ id: key.slice(PREFIX.length) as ProjectId, raw });
        }
      } catch {
        // Unreadable storage holds nothing to recover.
      }
      return out;
    },
  };
}

/** Rescue copies in memory, for tests. */
export function memoryRescue(): RescueStore & { copies: Map<string, string> } {
  const copies = new Map<string, string>();
  return {
    copies,
    put(doc) {
      copies.set(doc.id, JSON.stringify(doc));
      return true;
    },
    clear: (id) => void copies.delete(id),
    list: () => [...copies].map(([id, json]) => ({ id: id as ProjectId, raw: JSON.parse(json) })),
  };
}

/**
 * Saves every rescue copy as its project, then drops it. The copy is newer
 * than the stored project: it was taken from the open document when the
 * page went away, after any save that page could have finished. A copy that
 * isn't a readable document is dropped; one that fails to save is kept for
 * the next start. Resolves to the IDs it recovered.
 */
export async function recoverRescued(
  projects: ProjectStore,
  rescue: RescueStore,
): Promise<ProjectId[]> {
  const recovered: ProjectId[] = [];
  for (const { id, raw } of rescue.list()) {
    let doc: ExtrudoDocument;
    try {
      doc = loadDocument(raw).doc;
    } catch {
      rescue.clear(id);
      continue;
    }
    try {
      await projects.save(doc);
      rescue.clear(id);
      recovered.push(doc.id);
    } catch {
      // Kept: the next start tries again.
    }
  }
  return recovered;
}
