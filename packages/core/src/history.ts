/**
 * The undo/redo history (architecture §4.4, FR-TL-07).
 *
 * Entries are Immer patch pairs. Transactions nest: while one is open (sketch
 * mode, a feature dialog), undo and redo step through that transaction's own
 * entries only. Committing collapses them into one entry of the enclosing
 * level, so a whole sketch session becomes one timeline step; cancelling
 * reverts them.
 */
import { applyPatches, type Patch } from 'immer';
import type { ExtrudoDocument } from './schema';

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  /**
   * The step's identity, assigned by `record` (P6-07). `lastStepId` and
   * `amendInto` find a step by it, so a change that follows from a past step
   * (an auto-projected constraint) can join that step, not the latest one.
   */
  id?: number;
}

interface Level {
  label: string;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

export interface HistoryOptions {
  /** Most undo steps kept at the top level. Older ones are dropped. */
  limit?: number;
}

export class UndoHistory {
  readonly #limit: number;
  readonly #levels: Level[] = [{ label: '', undo: [], redo: [] }];
  /** The next step id (P6-07): never reused, so a stale pending can't hit a new step. */
  #nextId = 1;

  constructor(options: HistoryOptions = {}) {
    this.#limit = options.limit ?? 500;
  }

  get #top(): Level {
    // biome-ignore lint/style/noNonNullAssertion: the root level is never removed.
    return this.#levels.at(-1)!;
  }

  /** Records a change that has already been applied. Clears the redo steps. */
  record(entry: HistoryEntry): void {
    if (entry.patches.length === 0) return;
    const level = this.#top;
    level.undo.push({ ...entry, id: this.#nextId++ });
    level.redo.length = 0;
    if (this.#levels.length === 1 && level.undo.length > this.#limit) level.undo.shift();
  }

  /**
   * Adds a change that has already been applied to the latest step, as if
   * that step had made it (ADR-0030: names for the bodies a step made). The
   * latest step is the innermost open level's, or, while that has none, the
   * nearest enclosing level's; cancelling a transaction then leaves the
   * change, since it belongs to the step before. With no step anywhere
   * (a freshly opened document) the change isn't recorded. Redo steps stay.
   * Returns whether the change joined a step. With `relabel`, the step takes
   * the entry's label (P4-12: an include names its step once it knows how many
   * curves it brought).
   */
  amend(entry: HistoryEntry, relabel = false): boolean {
    if (entry.patches.length === 0) return false;
    for (let i = this.#levels.length - 1; i >= 0; i--) {
      const last = this.#levels[i]?.undo.at(-1);
      if (!last) continue;
      this.#join(last, entry, relabel);
      return true;
    }
    return false;
  }

  /**
   * Adds a change that has already been applied to the step `stepId`, wherever
   * it is in the undo stack (P6-07): an auto-projected constraint follows from
   * the step that added the projection, which may no longer be the latest one
   * (the user drew on). Patches are appended, inverse patches prepended, as
   * `amend` does. Returns false when the step no longer exists — it was undone,
   * or a new branch dropped it — so the caller can drop what followed from it.
   */
  amendInto(stepId: number, entry: HistoryEntry, relabel = false): boolean {
    if (entry.patches.length === 0) return this.hasStep(stepId);
    for (const level of this.#levels) {
      const step = level.undo.find((e) => e.id === stepId);
      if (!step) continue;
      this.#join(step, entry, relabel);
      return true;
    }
    return false;
  }

  /** The latest step's id, as `amend` would join (P6-07), or undefined with no step. */
  get lastStepId(): number | undefined {
    for (let i = this.#levels.length - 1; i >= 0; i--) {
      const last = this.#levels[i]?.undo.at(-1);
      if (last) return last.id;
    }
    return undefined;
  }

  /** Whether a step with this id is still in an undo stack (P6-07). */
  hasStep(stepId: number): boolean {
    return this.#levels.some((level) => level.undo.some((e) => e.id === stepId));
  }

  #join(step: HistoryEntry, entry: HistoryEntry, relabel: boolean): void {
    if (relabel) step.label = entry.label;
    step.patches = [...step.patches, ...entry.patches];
    step.inversePatches = [...entry.inversePatches, ...step.inversePatches];
  }

  get canUndo(): boolean {
    return this.#top.undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#top.redo.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.#top.undo.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.#top.redo.at(-1)?.label;
  }

  /** Open transactions. 0 at the timeline level. */
  get depth(): number {
    return this.#levels.length - 1;
  }

  /** Reverts the latest step. Returns the document unchanged if there is none. */
  undo(doc: ExtrudoDocument): ExtrudoDocument {
    const entry = this.#top.undo.pop();
    if (!entry) return doc;
    this.#top.redo.push(entry);
    return applyPatches(doc, entry.inversePatches);
  }

  redo(doc: ExtrudoDocument): ExtrudoDocument {
    const entry = this.#top.redo.pop();
    if (!entry) return doc;
    this.#top.undo.push(entry);
    return applyPatches(doc, entry.patches);
  }

  begin(label: string): void {
    this.#levels.push({ label, undo: [], redo: [] });
  }

  /** Closes the innermost transaction; its steps become one step labelled with its label. */
  commit(): void {
    const level = this.#closeTransaction();
    if (level.undo.length === 0) return;
    this.record({
      label: level.label,
      patches: level.undo.flatMap((e) => e.patches),
      inversePatches: level.undo.toReversed().flatMap((e) => e.inversePatches),
    });
  }

  /** Closes the innermost transaction and reverts its steps. */
  cancel(doc: ExtrudoDocument): ExtrudoDocument {
    const level = this.#closeTransaction();
    return level.undo.reduceRight((d, e) => applyPatches(d, e.inversePatches), doc);
  }

  clear(): void {
    this.#levels.length = 1;
    this.#top.undo.length = 0;
    this.#top.redo.length = 0;
  }

  #closeTransaction(): Level {
    if (this.#levels.length === 1) throw new Error('No transaction is open.');
    // biome-ignore lint/style/noNonNullAssertion: checked above.
    return this.#levels.pop()!;
  }
}
