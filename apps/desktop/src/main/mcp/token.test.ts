import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOrCreateToken, regenerateToken } from './token';

const temp = () => join(mkdtempSync(join(tmpdir(), 'extrudo-token-')), 'mcp-token');

describe('the MCP token (ADR-0087 §2)', () => {
  it('is made on first start as 64 hex characters, mode 0600, and kept', () => {
    const file = temp();
    const token = readOrCreateToken(file);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readOrCreateToken(file)).toBe(token);
    expect(readFileSync(file, 'utf8').trim()).toBe(token);
  });

  it('replaces a damaged file', () => {
    const file = temp();
    writeFileSync(file, 'not a token');
    expect(readOrCreateToken(file)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('regenerates a different one', () => {
    const file = temp();
    const first = readOrCreateToken(file);
    const second = regenerateToken(file);
    expect(second).not.toBe(first);
    expect(readOrCreateToken(file)).toBe(second);
  });
});
