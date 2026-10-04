import { describe, expect, it } from 'vitest';
import {
  createLinkSync,
  LINK_THROTTLE_MS,
  type LinkContext,
  type LinkOutcome,
  type LinkTimer,
  linkedName,
  nameTaken,
} from './linkedSync';

/** A timer the test fires itself, so the trailing write is not a real wait. */
function fakeTimer() {
  const queued = new Map<number, { at: number; fn: () => void }>();
  let handle = 0;
  const timer: LinkTimer = {
    later(fn, ms) {
      const id = ++handle;
      queued.set(id, { at: ms, fn });
      return id;
    },
    cancel: (h) => void queued.delete(h as number),
  };
  return {
    timer,
    /** The writes waiting for the throttle, with the delay each has left. */
    waiting: () => [...queued.values()].map((q) => q.at),
    /** Runs the waiting writes and waits for them to finish. */
    fire: async () => {
      const all = [...queued.values()];
      queued.clear();
      for (const q of all) q.fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

/** A linked sync with the link, the disk and the writes all under the test's control. */
function setup(
  options: { modified?: number; onDisk?: number; gone?: boolean; unlinked?: boolean } = {},
) {
  const { timer, waiting, fire } = fakeTimer();
  let clock = 1_000;
  let link = { file: 'Bracket.extrudo', modified: options.modified ?? 500 };
  const writes: { name: string; bytes: Uint8Array }[] = [];
  const archives: number[] = [];
  // What the design looks like when the archive is built, as the app's is.
  let state = 0;
  const ctx: { report?(outcome: LinkOutcome): void } & LinkContext = {
    link: () => (options.unlinked ? undefined : link),
    saveLink: async (next) => {
      link = next ?? link;
    },
    onDisk: async () => (options.gone ? undefined : (options.onDisk ?? link.modified)),
    archive: async () => {
      archives.push(state);
      return new Uint8Array([state]);
    },
    write: async (name, bytes) => {
      writes.push({ name, bytes });
      link = { file: name, modified: 900 };
      return 900;
    },
    now: () => clock,
    timer,
  };
  const reported: LinkOutcome[] = [];
  ctx.report = (outcome) => void reported.push(outcome);
  const sync = createLinkSync(ctx);
  return {
    sync,
    writes,
    archives,
    reported,
    waiting,
    fire,
    /** What the file on disk says, as another program's write changes it. */
    set onDiskValue(value: number) {
      ctx.onDisk = async () => value;
    },
    /** Moves the test's clock. */
    advance(ms: number) {
      clock += ms;
    },
    /** The state the archive is built from, as an edit changes it. */
    edit(next: number) {
      state = next;
    },
    /** The link as the project index holds it. */
    get link() {
      return link;
    },
  };
}

describe('linkedSync (P4-09, ADR-0065 §3)', () => {
  it('writes the archive after a save and records what the file then said', async () => {
    const t = setup();
    t.edit(1);
    const outcome = await t.sync.saved();
    expect(outcome).toEqual({ kind: 'written', file: 'Bracket.extrudo', modified: 900 });
    expect(t.writes.map((w) => w.name)).toEqual(['Bracket.extrudo']);
    expect(t.writes[0]?.bytes).toEqual(new Uint8Array([1]));
    expect(t.archives).toEqual([1]);
    expect(t.link).toEqual({ file: 'Bracket.extrudo', modified: 900 });
    expect(t.sync.pending()).toBe(false);
  });

  it('writes at most once every 10 s, and the trailing write holds the newest state', async () => {
    const t = setup();
    expect(await t.sync.saved()).toMatchObject({ kind: 'written' });
    // Three saves in the next few seconds: none may write.
    t.edit(2);
    for (let i = 0; i < 3; i++) {
      t.advance(1_000);
      t.edit(3 + i);
      expect(await t.sync.saved()).toEqual({ kind: 'skipped' });
    }
    expect(t.writes).toHaveLength(1);
    expect(t.sync.pending()).toBe(true);
    // The archive is built when the write happens, not when a save is noticed.
    expect(t.archives).toHaveLength(1);
    // Only one trailing write is waiting, for when the throttle is up: the
    // delay is measured from the last save, not the first.
    expect(t.waiting()).toEqual([LINK_THROTTLE_MS - 3_000]);

    // The design moved on while the write waited; it carries that state.
    t.advance(2_000);
    await t.fire();
    expect(t.writes).toHaveLength(2);
    expect(t.writes[1]?.bytes).toEqual(new Uint8Array([5]));
    expect(t.archives).toHaveLength(2);
    expect(t.sync.pending()).toBe(false);
  });

  it('a save after the throttle is up writes at once', async () => {
    const t = setup();
    await t.sync.saved();
    t.advance(LINK_THROTTLE_MS);
    expect(await t.sync.saved()).toMatchObject({ kind: 'written' });
    expect(t.writes).toHaveLength(2);
  });

  it('says nothing when the project is not linked', async () => {
    const t = setup({ unlinked: true });
    expect(await t.sync.saved()).toEqual({ kind: 'skipped' });
    expect(t.writes).toEqual([]);
  });

  it('reports a trailing write too, when it comes ten seconds later', async () => {
    const t = setup();
    await t.sync.saved();
    t.reported.length = 0;
    t.advance(1_000);
    // The save that has to wait: its outcome is reported when the write runs.
    expect(await t.sync.saved()).toEqual({ kind: 'skipped' });
    expect(t.reported).toEqual([]);
    // Someone else has the file by the time the write comes.
    t.onDiskValue = 42;
    await t.fire();
    expect(t.writes).toHaveLength(1);
    expect(t.reported).toEqual([{ kind: 'conflict', file: 'Bracket.extrudo', onDisk: 42 }]);
  });

  it('a file that changed on disk is a conflict, and nothing is written', async () => {
    const t = setup({ modified: 500, onDisk: 777 });
    const outcome = await t.sync.saved();
    expect(outcome).toEqual({ kind: 'conflict', file: 'Bracket.extrudo', onDisk: 777 });
    expect(t.writes).toEqual([]);
    // The recorded time is untouched: the next save still sees the conflict.
    expect(t.link.modified).toBe(500);
  });

  it('a file that is gone is an error result, not a write', async () => {
    const t = setup({ gone: true });
    const outcome = await t.sync.saved();
    expect(outcome).toEqual({
      kind: 'error',
      file: 'Bracket.extrudo',
      message: "Bracket.extrudo isn't in the linked folder any more.",
    });
    expect(t.writes).toEqual([]);
  });

  it('permission lost is an error result, and nothing is thrown', async () => {
    const { timer } = fakeTimer();
    const sync = createLinkSync({
      link: () => ({ file: 'Bracket.extrudo', modified: 500 }),
      saveLink: async () => {},
      onDisk: async () => 500,
      archive: async () => new Uint8Array([1]),
      write: async () => {
        throw new DOMException('The request was aborted.', 'NotAllowedError');
      },
      now: () => 1_000,
      timer,
    });
    await expect(sync.saved()).resolves.toEqual({
      kind: 'error',
      file: 'Bracket.extrudo',
      message: 'The request was aborted.',
    });
  });

  it('a closing project writes whatever the throttle says', async () => {
    const t = setup();
    await t.sync.saved();
    t.advance(100);
    expect(await t.sync.flush()).toMatchObject({ kind: 'written' });
    expect(t.writes).toHaveLength(2);
  });
});

describe('linked names', () => {
  it('is the project name as an .extrudo file, as an export names it', () => {
    expect(linkedName('Wall bracket')).toBe('Wall bracket.extrudo');
    expect(linkedName(' a/b ')).toBe('a b.extrudo');
    expect(linkedName('')).toBe('Untitled.extrudo');
  });

  it('knows a name that is already taken', () => {
    expect(nameTaken([{ name: 'A.extrudo' }], 'A.extrudo')).toBe(true);
    expect(nameTaken([{ name: 'A.extrudo' }], 'B.extrudo')).toBe(false);
  });
});
