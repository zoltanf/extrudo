/**
 * Errors across `ipcRenderer.invoke` (P6-01's review). Electron turns a
 * rejected `invoke` into a plain `Error` whose message carries the IPC
 * envelope ("Error invoking remote method 'extrudo:store:call': …"), so the
 * renderer loses the class and the worded message `describeError` shows.
 *
 * Instead the main process catches an error and returns it as data — `{ name,
 * message, …the error's own string/number/boolean fields }` (the store's
 * `ArchiveError.code`, `ProjectNotFoundError.id`, …) — and the renderer's
 * `errors.ts` rebuilds the same class. This file has no class imports, so main
 * and renderer share it without pulling packages into either bundle.
 */

/** An error as plain data: its name, message and own primitive fields. */
export interface SerializedError {
  name: string;
  message: string;
  [field: string]: unknown;
}

/** The shape an `invoke` handler returns instead of rejecting. */
export interface ErrorEnvelope {
  error: SerializedError;
}

/** The data form of any thrown value. */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const serialized: SerializedError = { name: error.name, message: error.message };
    for (const [key, value] of Object.entries(error)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        serialized[key] = value;
      }
    }
    return serialized;
  }
  return { name: 'Error', message: String(error) };
}

/** Whether an `invoke` result is an error envelope rather than a value. */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { name?: unknown }).name === 'string'
  );
}
