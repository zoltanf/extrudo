/**
 * Commands (architecture §4.4). Every document change is a command: a type, a
 * label for the undo menu, a serialisable payload, and an Immer recipe that
 * edits a draft of the document. `applyCommand` runs it and returns the new
 * document with forward and inverse patches, which feed the undo history.
 *
 * Recipes must be deterministic: no `newId()`, no clock, no randomness. The
 * caller puts new IDs in the payload, so redo and replay give the same result.
 * A recipe rejects an invalid change by throwing `CommandError`; Immer then
 * discards the draft and the document is unchanged.
 */
import { type Draft, enablePatches, type Patch, produceWithPatches } from 'immer';
import type { ExtrudoDocument } from './schema';

enablePatches();

export type DocumentDraft = Draft<ExtrudoDocument>;

export interface Command<P = unknown> {
  /** Namespaced ID, for logs and tests: `feature.rename`. */
  readonly type: string;
  /** Shown in the undo menu: "Undo Rename feature". */
  readonly label: string;
  readonly payload: P;
  // A method, not a function property, so `Command<P>` is assignable to `Command<unknown>`.
  recipe(draft: DocumentDraft, payload: P): void;
}

export type CommandFactory<P> = ((payload: P) => Command<P>) & { readonly type: string };

export function defineCommand<P>(
  type: string,
  label: string,
  recipe: (draft: DocumentDraft, payload: P) => void,
): CommandFactory<P> {
  return Object.assign((payload: P): Command<P> => ({ type, label, payload, recipe }), { type });
}

export class CommandError extends Error {
  override readonly name = 'CommandError';
}

export interface CommandResult {
  doc: ExtrudoDocument;
  patches: Patch[];
  inversePatches: Patch[];
}

export function applyCommand<P>(doc: ExtrudoDocument, command: Command<P>): CommandResult {
  const [next, patches, inversePatches] = produceWithPatches(doc, (draft) => {
    command.recipe(draft, command.payload);
  });
  return { doc: next, patches, inversePatches };
}
