/**
 * The rebuilds S12b's checks run on (ADR-0144): a mesh's `import`, a link's
 * copy, a compound's members placed as the compound places them. Each is
 * added in a transaction of its own, the design is rebuilt in the import
 * kernel measuring only the bodies asked for, and the transaction is kept
 * only when the check holds; anything else cancels it (the attachment and the
 * body metadata go back with it). One measure per body is remembered, so a
 * pivot or a target needs no rebuild of its own once its body has been seen.
 */
import type { Design } from '@extrudo/api';
import type { AttachmentId } from '@extrudo/core';
import { saneRebuild } from './bodies';
import type { CallOutcome, KernelBudget } from './budget';
import type { RebuildResult, ShapeMeasure } from './import-kernel';
import { clip } from './names';
import { forgetRemovedPlanes } from './sketch-place';

/** Why an attempt didn't hold: the budget's outcomes, a failed feature, a check that doesn't hold. */
export type BuildStop = 'kernel' | 'time' | 'import-time' | 'restarts' | 'failed' | 'check';

export interface Stopped {
  readonly stop: BuildStop;
  readonly detail?: string;
}

const failure = (o: Exclude<CallOutcome<unknown>, { kind: 'done' }>): Stopped => ({
  stop: o.kind,
  ...('detail' in o && o.detail ? { detail: o.detail } : {}),
});

export class StructureBuild {
  readonly #design: Design;
  readonly #budget: KernelBudget;
  /** Every attachment's bytes the design holds, by ID (what a rebuild sends). */
  readonly files: Map<AttachmentId, Uint8Array>;
  /** The live bodies after the last rebuild. */
  #ids: string[] | undefined;
  /** The last measure of each body seen. */
  readonly #measures = new Map<string, ShapeMeasure>();
  /** How many rebuilds this stage asked for. */
  rebuilds = 0;

  constructor(design: Design, budget: KernelBudget, files: Map<AttachmentId, Uint8Array>) {
    this.#design = design;
    this.#budget = budget;
    this.files = files;
  }

  /** The live bodies after the last rebuild (none before the first). */
  get ids(): readonly string[] {
    return this.#ids ?? [];
  }

  /**
   * Forgets the live bodies (after work outside an attempt changed the design: a compound's
   * members walked, or taken back): the next attempt rebuilds and measures every body first.
   */
  forget(): void {
    this.#ids = undefined;
  }

  /** The last measure of `id`, when a rebuild measured it. */
  measure(id: string): ShapeMeasure | undefined {
    return this.#measures.get(id);
  }

  /** The live bodies, from a rebuild that measures every one not yet measured. */
  async live(): Promise<string[] | Stopped> {
    if (this.#ids) return this.#ids;
    const r = await this.#rebuild(new Map(), []);
    return 'stop' in r ? r : r.ids;
  }

  /** Measures bodies that moved or were never seen (one rebuild, skipping the rest). */
  async remeasure(ids: readonly string[]): Promise<Stopped | undefined> {
    const r = await this.#rebuild(new Map(), ids);
    return 'stop' in r ? r : undefined;
  }

  async #rebuild(
    extra: ReadonlyMap<AttachmentId, Uint8Array>,
    wanted: readonly string[],
  ): Promise<{ ids: string[]; failed: RebuildResult['failed'] } | Stopped> {
    const want = new Set(wanted);
    // Measure only what is new or asked for: everything seen before is settled.
    const skip = this.#ids ? this.#ids.filter((id) => !want.has(id)) : [];
    let sent = new Set<string>();
    this.rebuilds++;
    const out = await this.#budget.call(
      () => {
        const json = this.#design.toJSON();
        sent = new Set(json.features.map((x) => x.id));
        const files = extra.size > 0 ? new Map([...this.files, ...extra]) : this.files;
        return this.#budget.kernel.rebuild(json, files, skip);
      },
      (reply: unknown): reply is RebuildResult => saneRebuild(reply, sent) !== undefined,
    );
    if (out.kind !== 'done') return failure(out);
    const r = saneRebuild(out.value, sent);
    if (!r) return { stop: 'kernel', detail: "the kernel's answer makes no sense" };
    for (const [id, m] of r.bodies) this.#measures.set(id, m);
    this.#ids = [...r.ids];
    return { ids: [...r.ids], failed: r.failed };
  }

  /**
   * Adds what `add` adds in one transaction, rebuilds (measuring the new
   * bodies and `remeasured`), and keeps it only when `check` passes. `check`
   * gets the bodies that are new since the last rebuild; it may set body
   * metadata, which the transaction keeps or drops with the rest.
   */
  async attempt<T>(
    label: string,
    add: () => { value: T; files?: ReadonlyMap<AttachmentId, Uint8Array> } | Stopped,
    check: (fresh: readonly string[], value: T) => string | undefined,
    remeasured: readonly string[] = [],
  ): Promise<{ value: T; fresh: string[] } | Stopped> {
    const before = await this.live();
    if ('stop' in before) return before;
    const known = new Set(before);
    const features = new Set(this.#design.doc.features.map((f) => f.id));
    const state = this.#design.state;
    state.beginTransaction(label);
    let committed = false;
    const ids = this.#ids;
    const kept = remeasured.map((id) => [id, this.#measures.get(id)] as const);
    try {
      const added = add();
      if ('stop' in added) return added;
      const r = await this.#rebuild(added.files ?? new Map(), remeasured);
      if ('stop' in r) return r;
      const mine = new Set(
        this.#design.doc.features.map((f) => f.id).filter((id) => !features.has(id)),
      );
      const failed = r.failed.find((f) => mine.has(f.feature as never));
      if (failed) return { stop: 'failed', detail: failed.message };
      const fresh = r.ids.filter((id) => !known.has(id));
      const wrong = check(fresh, added.value);
      if (wrong) return { stop: 'check', detail: clip(wrong) };
      state.commitTransaction();
      committed = true;
      for (const [id, bytes] of added.files ?? []) this.files.set(id, bytes);
      return { value: added.value, fresh };
    } catch (error) {
      return {
        stop: 'failed',
        detail: clip(`it failed: ${(error as Error)?.message ?? String(error)}`),
      };
    } finally {
      if (!committed) {
        state.cancelTransaction();
        // An offset plane a cancelled attempt's sketch made went with it.
        forgetRemovedPlanes(this.#design);
        // The bodies the cancelled rebuild saw are gone again, and the moved ones are back.
        this.#ids = ids;
        for (const [id, m] of kept) {
          if (m) this.#measures.set(id, m);
          else this.#measures.delete(id);
        }
      }
    }
  }
}
