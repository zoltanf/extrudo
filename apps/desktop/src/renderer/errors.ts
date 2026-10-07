/**
 * Rebuilding the classes `store-call.ts` serialised (P6-01's review). The
 * renderer's `proxy.ts` and `platform.ts` call `unwrap` on every `invoke`
 * result: a normal value passes through, an error envelope is turned back into
 * the same class so `describeError`'s `instanceof` branches and the linked
 * folder's wording keep working. Only the class names are registered here; an
 * unknown one becomes a plain `Error` that keeps its name and message.
 */
import { DocumentLoadError, type DocumentLoadErrorCode } from '@extrudo/core';
import {
  ArchiveError,
  type ArchiveErrorCode,
  ProjectNotFoundError,
  StorageError,
} from '@extrudo/storage';
import { LinkedFileError } from '@extrudo/web/platform/folders';
import { isErrorEnvelope, type SerializedError } from '../shared/errors';

/** The class the data stands for, with its fields put back. */
export function deserializeError(data: SerializedError): Error {
  let error: Error;
  switch (data.name) {
    case 'ArchiveError':
      error = new ArchiveError(data.code as ArchiveErrorCode, data.message);
      break;
    case 'ProjectNotFoundError':
      error = new ProjectNotFoundError(typeof data.id === 'string' ? data.id : '');
      break;
    case 'StorageError':
      error = new StorageError(typeof data.id === 'string' ? data.id : '');
      break;
    case 'DocumentLoadError':
      error = new DocumentLoadError(data.code as DocumentLoadErrorCode, data.message);
      break;
    case 'LinkedFileError':
      error = new LinkedFileError(data.message);
      break;
    default:
      error = new Error(data.message);
  }
  // Keep the exact name/message the main process sent (a class may word its
  // own message from an id). `name` is a readonly class field, so set it.
  Object.defineProperty(error, 'name', { value: data.name, configurable: true });
  error.message = data.message;
  return error;
}

/** Passes a value through; throws the rebuilt error when the value is an envelope. */
export function unwrap<T>(value: T | { error: SerializedError }): T {
  if (isErrorEnvelope(value)) throw deserializeError(value.error);
  return value as T;
}
