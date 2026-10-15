/**
 * Who may call the MCP server (P6-08, ADR-0087 §2), as one pure function over
 * the request's headers, so the rules have a table of unit tests and no
 * Electron. The order matters: a request a browser page or a rebound DNS name
 * could have sent is refused (403) before the token is even looked at, so a
 * guessing page learns nothing; then a body over the cap (413); then the
 * token (401, one line, no details).
 */
import { timingSafeEqual } from 'node:crypto';

/** The largest request body the server reads: 1 MB. */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface AdmitRequest {
  host: string | undefined;
  origin: string | undefined;
  authorization: string | undefined;
  /** The `Content-Length` header, when the client sent one. */
  contentLength: string | undefined;
}

export interface AdmitConfig {
  port: number;
  token: string;
}

export type Admission = { ok: true } | { ok: false; status: 401 | 403 | 413; error: string };

const LOOPBACK_NAMES = ['127.0.0.1', 'localhost'] as const;

/** `Host` must name the loopback address with our port, as a local client sends it. */
export function isLocalHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  return LOOPBACK_NAMES.some((name) => host.toLowerCase() === `${name}:${port}`);
}

/**
 * An `Origin` is only present when a browser (or a page in one) sent the
 * request. Absent is fine (a command-line client); present, it must be the
 * loopback over plain HTTP, with no port or ours.
 */
export function isLocalOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  const value = origin.toLowerCase();
  return LOOPBACK_NAMES.some(
    (name) => value === `http://${name}` || value === `http://${name}:${port}`,
  );
}

/** Compares in constant time; a different length is simply false. */
function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function admit(request: AdmitRequest, config: AdmitConfig): Admission {
  if (!isLocalHost(request.host, config.port) || !isLocalOrigin(request.origin, config.port)) {
    return { ok: false, status: 403, error: 'Forbidden.' };
  }
  if (request.contentLength !== undefined) {
    const length = Number(request.contentLength);
    if (!Number.isFinite(length) || length > MAX_BODY_BYTES) {
      return { ok: false, status: 413, error: 'Request body too large.' };
    }
  }
  const match = /^Bearer ([^\s]+)$/.exec(request.authorization ?? '');
  if (!match?.[1] || config.token.length === 0 || !sameToken(match[1], config.token)) {
    return { ok: false, status: 401, error: 'Unauthorized.' };
  }
  return { ok: true };
}
