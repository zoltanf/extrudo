/**
 * The MCP server's bearer token (P6-08, ADR-0087 §2): 32 random bytes as hex,
 * made on first start and kept in `userData/mcp-token`, readable only by the
 * user (mode 0600). Regenerating writes a new one; the old one stops working at
 * once because the server compares against the current value.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const TOKEN = /^[0-9a-f]{64}$/;

export const newToken = (): string => randomBytes(32).toString('hex');

function writeToken(file: string, token: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${token}\n`, { mode: 0o600 });
  // `mode` applies only when the file is created; make sure of it either way.
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

/** The token on disk, or a new one written there when it is missing or damaged. */
export function readOrCreateToken(file: string): string {
  try {
    const token = readFileSync(file, 'utf8').trim();
    if (TOKEN.test(token)) return token;
  } catch {
    // Missing: the first start.
  }
  return regenerateToken(file);
}

/** Writes and returns a fresh token. */
export function regenerateToken(file: string): string {
  const token = newToken();
  writeToken(file, token);
  return token;
}
