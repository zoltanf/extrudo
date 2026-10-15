/**
 * Where the `export` tool's files go (P6-08, ADR-0087 §5): main writes them
 * under `userData/agent-exports/<design>-<n>.<ext>` and answers the path; the
 * renderer sends only the design's name, the format and the bytes, never a
 * path (ADR-0075's external-files rule). A file over 20 MB is refused.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpExportFile } from '../../shared/mcp';

/** The largest file an agent may export. */
export const MAX_EXPORT_BYTES = 20 * 1024 * 1024;

/** A design name as a file-name stem: letters, digits, space, `-` and `_`, at most 64. */
export function exportStem(design: string): string {
  const stem = design
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim();
  return stem === '' ? 'design' : stem;
}

export interface AgentExports {
  /** Writes the file and returns its path. */
  write(file: McpExportFile): Promise<string>;
}

export function createAgentExports(dir: string): AgentExports {
  return {
    async write(file) {
      if (file.bytes.length > MAX_EXPORT_BYTES) {
        throw new Error('The export is over 20 MB: not written.');
      }
      await mkdir(dir, { recursive: true });
      const stem = exportStem(file.design);
      for (let n = 1; ; n++) {
        const path = join(dir, `${stem}-${n}.${file.format}`);
        try {
          // `wx`: never overwrite, so a number already taken moves on.
          await writeFile(path, file.bytes, { flag: 'wx' });
          return path;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || n >= 10_000) throw error;
        }
      }
    },
  };
}
