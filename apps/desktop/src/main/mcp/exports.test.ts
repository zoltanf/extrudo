import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentExports, exportStem, MAX_EXPORT_BYTES } from './exports';

describe('agent exports (ADR-0087 §5)', () => {
  it('makes a design name a safe stem', () => {
    expect(exportStem('Box with lid')).toBe('Box with lid');
    expect(exportStem('../../etc/passwd')).toBe('etcpasswd');
    expect(exportStem('a/b\\c:d')).toBe('abcd');
    expect(exportStem('...')).toBe('design');
    expect(exportStem('x'.repeat(100))).toHaveLength(64);
  });

  it('writes <design>-<n>.<ext> without overwriting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'extrudo-exports-'));
    const exports = createAgentExports(dir);
    const bytes = new Uint8Array([1, 2, 3]);
    const first = await exports.write({ design: 'Bracket', format: 'stl', bytes });
    const second = await exports.write({ design: 'Bracket', format: 'stl', bytes });
    expect(basename(first)).toBe('Bracket-1.stl');
    expect(basename(second)).toBe('Bracket-2.stl');
    expect([...readFileSync(first)]).toEqual([1, 2, 3]);
  });

  it('refuses a file over 20 MB', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'extrudo-exports-'));
    await expect(
      createAgentExports(dir).write({
        design: 'Big',
        format: '3mf',
        bytes: new Uint8Array(MAX_EXPORT_BYTES + 1),
      }),
    ).rejects.toThrow('over 20 MB');
  });
});
