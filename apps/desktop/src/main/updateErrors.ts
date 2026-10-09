/**
 * What a failed update check means (ADR-0075's 2026-10-09 amendment). The
 * updater's errors are long: electron-updater appends the HTTP response's
 * headers and body to its message, and a repository with no published release
 * (a draft is invisible) answers 406 or 404, which is a normal state, not a
 * fault. Three kinds, so an automatic check can stay silent and a manual one
 * can answer in a sentence:
 *
 * - `no-release`: nothing has been published to update to yet;
 * - `offline`: the network is down or GitHub can't be reached;
 * - `other`: anything else, worded as the error's first line, never the dump.
 *
 * Pure, so `updateErrors.test.ts` runs it over real error strings.
 */
export type UpdateFailure = 'no-release' | 'offline' | 'other';

/** The longest piece of an error's own text shown to a person. */
export const MAX_ERROR_LINE = 140;

export const NO_RELEASE_TEXT = "There's no published release to update to yet.";
export const OFFLINE_TEXT = "Couldn't check for updates: you seem to be offline.";
export const OTHER_PREFIX = "Couldn't check for updates.";

const NO_RELEASE = [
  /unable to find latest version/i,
  /ensure a production release exists/i,
  /no published versions/i,
  /cannot find latest[^ ]*\.yml/i,
  // The releases feed or its manifest answering "not found" / "not acceptable".
  /\bHttpError:\s*(404|406)\b/,
  /\bstatus(?: code)?:?\s*(404|406)\b/i,
];

const OFFLINE = [
  /\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EPIPE)\b/,
  /net::ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|CONNECTION_\w+|TIMED_OUT|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED|NETWORK_ACCESS_DENIED)/,
  /getaddrinfo/i,
  /socket hang up/i,
];

const textOf = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}${error.stack ?? ''}`;
  return String(error);
};

export function classifyUpdateError(error: unknown): UpdateFailure {
  const text = textOf(error);
  if (NO_RELEASE.some((pattern) => pattern.test(text))) return 'no-release';
  if (OFFLINE.some((pattern) => pattern.test(text))) return 'offline';
  return 'other';
}

/** The first non-empty line of a message, cut to `max` characters with an ellipsis. */
export function firstLine(message: string, max = MAX_ERROR_LINE): string {
  const line =
    message
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The sentence an `other` failure is reported as. */
export function otherFailureText(error: unknown, prefix = OTHER_PREFIX): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = firstLine(message);
  return line ? `${prefix} ${line}` : prefix;
}
