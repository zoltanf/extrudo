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
    level.undo.push(entry);
    level.redo.length = 0;
    if (this.#levels.length === 1 && level.undo.length > this.#limit) level.undo.shift();
  }

  /**
   * Adds a change that has already been applied to the latest step of the
   * innermost level, as if it had been part of it, and leaves the redo
   * steps alone. With no step to join (a document just opened), the change
   * isn't recorded at all: undo can't take it back. For changes that follow
   * from the last one rather than from the user (P2-09: projected geometry
   * catching up with the model it follows).
   */
  amend(entry: Omit<HistoryEntry, 'label'>): void {
    if (entry.patches.length === 0) return;
    const last = this.#top.undo.at(-1);
    if (!last) return;
    this.#top.undo[this.#top.undo.length - 1] = {
      label: last.label,
      patches: [...last.patches, ...entry.patches],
      inversePatches: [...entry.inversePatches, ...last.inversePatches],
    };
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
