/**
 * The project index on disk (P6-01, ADR-0075 §2): `ProjectIndex` over a
 * single `<dir>/index.json`. Every write is atomic — the JSON goes to a temp
 * file beside the index and is renamed over it — so a crash between the two
 * leaves the old index intact (the rename is the commit; a half-written temp
 * file is invisible to it). It is the same "index never points at a document
 * that wasn't written" rule the browser store follows (ADR-0009), with the
 * file system's rename as the atomic step.
 *
 * The whole app instance owns the directory (ADR-0075 §2's single-instance
 * lock), so one process writes it; a module-level queue still serialises the
 * read-modify-write of `put`/`delete` so two concurrent saves never drop each
 * other's entry.
 */
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ProjectIndex } from '../idb';
import type { ProjectId, ProjectSummary } from '../types';

export interface NodeIndexOptions {
  /**
   * Test hook: runs after the temp file is written and before the rename, as
   * a crash between the two would. Throwing leaves the old index in place.
   */
  beforeRename?(): void | Promise<void>;
}

/** A queue per index path: one read-modify-write at a time. */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(path: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(path) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => undefined);
  queues.set(path, tail);
  void tail.then(() => {
    if (queues.get(path) === tail) queues.delete(path);
  });
  return run;
}

interface IndexFile {
  projects?: ProjectSummary[];
}

function readSummaries(text: string): ProjectSummary[] {
  let parsed: IndexFile;
  try {
    parsed = JSON.parse(text) as IndexFile;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.projects)) return [];
  return parsed.projects.filter(
    (s): s is ProjectSummary => !!s && typeof s === 'object' && typeof s.id === 'string',
  );
}

export function nodeIndex(path: string, options: NodeIndexOptions = {}): ProjectIndex {
  const read = async (): Promise<Map<ProjectId, ProjectSummary>> => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw error;
    }
    const map = new Map<ProjectId, ProjectSummary>();
    for (const summary of readSummaries(text)) map.set(summary.id, { ...summary });
    return map;
  };

  const commit = (summaries: ProjectSummary[]): Promise<void> =>
    writeAtomic(
      path,
      `${JSON.stringify({ projects: summaries }, null, 2)}\n`,
      options.beforeRename,
    );

  return {
    async all() {
      return [...(await read()).values()];
    },
    async get(id) {
      const summary = (await read()).get(id);
      return summary ? { ...summary } : undefined;
    },
    async put(summary) {
      // The read and the write are one queued task: two overlapping saves of
      // different projects must not drop each other's entry (P6-01's review).
      await enqueue(path, async () => {
        const map = await read();
        map.set(summary.id, { ...summary });
        await commit([...map.values()]);
      });
    },
    async delete(id) {
      await enqueue(path, async () => {
        const map = await read();
        if (!map.delete(id)) return;
        await commit([...map.values()]);
      });
    },
  };
}

/**
 * Writes `text` to `path` atomically: a temp file beside it, flushed, renamed
 * over it (P6-01's review). Shared by the project index and the plugin index
 * (P6-03 slice 2).
 */
export async function writeAtomic(
  path: string,
  text: string,
  beforeRename?: () => void | Promise<void>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, text, 'utf8');
  // Flush the temp file before the rename: the rename is the commit, and a
  // power loss must never leave it pointing at a partial file (P6-01 review).
  const handle = await open(temp, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await beforeRename?.();
  try {
    await rename(temp, path);
  } catch (error) {
    // A failed rename must not leave the temp file behind for ever.
    await rm(temp, { force: true });
    throw error;
  }
}
