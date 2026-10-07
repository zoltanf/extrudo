/**
 * The plugin index on disk (P6-03 slice 2, ADR-0077 §4): `plugins/index.json`
 * under the desktop's `userData`, written through a temp file and a rename like
 * the project index (`writeAtomic`), so a crash leaves the old index whole.
 */
import { readFile } from 'node:fs/promises';
import type { PluginIndexFile } from '../plugins';
import { writeAtomic } from './fs-index';

export function nodePluginIndex(
  path: string,
  options: { beforeRename?(): void | Promise<void> } = {},
): PluginIndexFile {
  return {
    async read() {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    write: (text) => writeAtomic(path, text, options.beforeRename),
  };
}
