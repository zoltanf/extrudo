import {
  createDocument,
  createDocumentStore,
  createSessionStore,
  type FeatureId,
  type HistoryEvent,
  renameDocument,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  ACTION_LOG_KEY,
  memoryActionLogStorage,
  webActionLogStorage,
} from '../platform/actionLogStorage';
import {
  ACTION_LIMIT,
  ACTION_TEXT_LIMIT,
  actionLines,
  createActionLog,
  historyEntry,
  persistsActions,
  redactLabel,
  storedEntries,
  watchActions,
} from './actionLog';
import { startActionLog } from './startActionLog';

/** A log on a fake clock whose writes run when `run()` is called. */
function testLog(limit?: number) {
  let time = 1_000;
  const queued: (() => void)[] = [];
  const log = createActionLog({
    ...(limit !== undefined && { limit }),
    now: () => time,
    schedule: (write) => void queued.push(write),
  });
  return {
    log,
    tick: (ms: number) => {
      time += ms;
    },
    run: () => {
      for (const write of queued.splice(0)) write();
    },
    queued,
  };
}

describe('createActionLog', () => {
  it('keeps the newest 500 entries, oldest first', () => {
    const { log } = testLog();
    for (let i = 0; i < ACTION_LIMIT + 20; i++) log.info('history', `step ${i}`);
    const entries = log.entries();
    expect(entries).toHaveLength(ACTION_LIMIT);
    expect(entries[0]?.text).toBe('step 20');
    expect(entries.at(-1)?.text).toBe(`step ${ACTION_LIMIT + 19}`);
  });

  it('counts a repeat of the newest entry, by text or by key', () => {
    const { log, tick } = testLog();
    log.warn('sketch', 'Preview has no anchor');
    tick(100);
    log.warn('sketch', 'Preview has no anchor');
    log.info('history', 'sketch.move "Move point": new step 4', 'drag');
    log.info('history', 'sketch.move "Move point": new step 5', 'drag');
    log.info('history', 'sketch.move "Move point": new step 6', 'drag');
    // Another level or kind is another entry.
    log.info('sketch', 'Preview has no anchor');
    expect(log.entries()).toEqual([
      { t: 1100, level: 'warn', kind: 'sketch', text: 'Preview has no anchor', repeat: 2 },
      {
        t: 1100,
        level: 'info',
        kind: 'history',
        text: 'sketch.move "Move point": new step 6',
        repeat: 3,
        key: 'drag',
      },
      { t: 1100, level: 'info', kind: 'sketch', text: 'Preview has no anchor' },
    ]);
  });

  it('cuts a long text, hands out copies and clears', () => {
    const { log } = testLog();
    log.info('app', 'x'.repeat(ACTION_TEXT_LIMIT + 50));
    expect(log.entries()[0]?.text).toHaveLength(ACTION_TEXT_LIMIT);
    (log.entries()[0] as { text: string }).text = 'changed';
    expect(log.entries()[0]?.text).not.toBe('changed');
    log.clear();
    expect(log.entries()).toEqual([]);
  });

  it('writes nothing until it persists', () => {
    const { log, queued } = testLog();
    log.info('app', 'one');
    expect(queued).toHaveLength(0);
  });
});

describe('persistence (edge and dev builds)', () => {
  it('round-trips: a new page reads what the last wrote, its own entries after', () => {
    const storage = memoryActionLogStorage();
    const first = testLog();
    first.log.persist(storage);
    first.log.info('history', 'sketch.add "Draw": new step 12');
    first.log.warn('sketch', 'Commit (dimension) added nothing to the sketch');
    // One write per burst, when the scheduled write runs.
    expect(storage.writes).toBe(0);
    first.run();
    expect(storage.writes).toBe(1);

    const second = testLog();
    second.log.info('app', 'App started');
    second.log.persist(storage);
    expect(second.log.entries().map((e) => e.text)).toEqual([
      'sketch.add "Draw": new step 12',
      'Commit (dimension) added nothing to the sketch',
      'App started',
    ]);
    expect(second.log.entries()[1]?.level).toBe('warn');
  });

  it('keeps only the newest 500 there too', () => {
    const storage = memoryActionLogStorage(
      Array.from({ length: ACTION_LIMIT }, (_, i) => ({
        t: i,
        level: 'info',
        kind: 'history',
        text: `old ${i}`,
      })),
    );
    const { log, run } = testLog();
    log.persist(storage);
    for (let i = 0; i < 10; i++) log.info('pick', `new ${i}`);
    run();
    const stored = storage.value as { text: string }[];
    expect(stored).toHaveLength(ACTION_LIMIT);
    expect(stored[0]?.text).toBe('old 10');
    expect(stored.at(-1)?.text).toBe('new 9');
  });

  it('flushes a pending write at once (the page is going away)', () => {
    const storage = memoryActionLogStorage();
    const { log } = testLog();
    log.persist(storage);
    log.info('app', 'one');
    log.flush();
    expect(storage.writes).toBe(1);
    log.flush();
    expect(storage.writes).toBe(1);
  });

  it('drops stored values that are not entries', () => {
    expect(storedEntries('nope')).toEqual([]);
    expect(
      storedEntries([
        { t: 1, level: 'info', kind: 'tool', text: 'Tool: line' },
        { t: 'x', level: 'info', kind: 'tool', text: 'bad time' },
        { t: 2, level: 'loud', kind: 'tool', text: 'bad level' },
        { t: 3, level: 'info', kind: 'doc', text: 'bad kind' },
        null,
        { t: 4, level: 'warn', kind: 'sketch', text: 'twice', repeat: 2, key: 'k' },
      ]),
    ).toEqual([
      { t: 1, level: 'info', kind: 'tool', text: 'Tool: line' },
      { t: 4, level: 'warn', kind: 'sketch', text: 'twice', repeat: 2, key: 'k' },
    ]);
  });

  it('keeps it in localStorage under one key, and survives a broken store', () => {
    const items = new Map<string, string>();
    const local = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    } as Storage;
    const web = webActionLogStorage(local);
    web.write([{ t: 1, level: 'info', kind: 'app', text: 'App started' }]);
    expect(JSON.parse(items.get(ACTION_LOG_KEY) ?? '')).toHaveLength(1);
    expect(storedEntries(web.read())).toHaveLength(1);
    const broken = webActionLogStorage({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    } as unknown as Storage);
    expect(broken.read()).toBeUndefined();
    expect(() => broken.write([])).not.toThrow();
  });
});

describe('startActionLog', () => {
  const boot = (channel: 'stable' | 'edge' | 'dev') => {
    const storage = memoryActionLogStorage([
      { t: 1, level: 'info', kind: 'history', text: 'before the reload' },
    ]);
    const listeners: Record<string, () => void> = {};
    const target = {
      addEventListener: (type: string, listener: () => void) => {
        listeners[type] = listener;
      },
    } as unknown as Window;
    const { log } = testLog();
    startActionLog({
      log,
      build: { channel, version: '0.9.0+edge.3', commit: 'abc1234' },
      target,
      storage: () => storage,
    });
    return { log, storage, target, pagehide: () => listeners.pagehide?.() };
  };

  it('persists nothing on a release: memory only, nothing read or written', () => {
    expect(persistsActions('stable')).toBe(false);
    const { log, storage, pagehide } = boot('stable');
    log.info('pick', 'Click (line): snap endpoint');
    pagehide();
    expect(storage.writes).toBe(0);
    expect(log.entries().map((e) => e.text)).toEqual([
      'App started: 0.9.0+edge.3 (stable, abc1234)',
      'Click (line): snap endpoint',
    ]);
  });

  it('persists on edge and dev: reads the last page, writes on pagehide', () => {
    expect([persistsActions('edge'), persistsActions('dev')]).toEqual([true, true]);
    const { log, storage, pagehide } = boot('edge');
    expect(log.entries().map((e) => e.text)).toEqual([
      'before the reload',
      'App started: 0.9.0+edge.3 (edge, abc1234)',
    ]);
    pagehide();
    expect(storage.writes).toBe(1);
    expect((storage.value as unknown[]).length).toBe(2);
  });

  it('sets the read-only handle: the report lines, a copy each call', () => {
    const { target, log } = boot('edge');
    const lines = target.__extrudoRecentActions?.();
    expect(lines).toEqual(actionLines(log.entries()));
    lines?.push('tampered');
    expect(target.__extrudoRecentActions?.()).toHaveLength(2);
  });
});

describe('historyEntry', () => {
  const text = (event: HistoryEvent) => historyEntry(event);

  it('names the step a change made or joined (PR #199: a dimension joining "Draw")', () => {
    expect(
      text({ type: 'dispatch', command: 'sketch.add', label: 'Add to sketch', step: 13 }),
    ).toEqual({
      level: 'info',
      text: 'sketch.add "Add to sketch": new step 13',
      key: 'dispatch sketch.add "Add to sketch"',
    });
    expect(
      text({
        type: 'amend',
        command: 'sketch.add',
        label: 'Dimension',
        into: 12,
        changed: true,
        step: 12,
        stepLabel: 'Draw',
        relabel: false,
      }).text,
    ).toBe('sketch.add "Dimension": joined step 12 "Draw"');
    expect(
      text({
        type: 'amend',
        command: 'sketch.addProjection',
        label: 'Project',
        into: undefined,
        changed: true,
        step: 12,
        stepLabel: 'Draw',
        relabel: false,
      }).text,
    ).toBe('sketch.addProjection "Project": joined the latest step 12 "Draw"');
  });

  it('warns for the silent no-ops', () => {
    expect(
      text({ type: 'dispatch', command: 'sketch.add', label: 'Add to sketch', step: undefined }),
    ).toEqual({ level: 'warn', text: 'sketch.add "Add to sketch": changed nothing' });
    expect(
      text({
        type: 'amend',
        command: 'sketch.add',
        label: 'Dimension',
        into: 7,
        changed: true,
        step: undefined,
        stepLabel: undefined,
        relabel: false,
      }),
    ).toEqual({ level: 'warn', text: 'sketch.add "Dimension": dropped, step 7 is gone' });
    expect(text({ type: 'revert', target: 3, changed: false }).level).toBe('warn');
  });

  it('says undo, redo and transactions with their steps', () => {
    expect(text({ type: 'undo', step: 12, label: 'Draw' }).text).toBe('Undo step 12 "Draw"');
    expect(text({ type: 'redo', step: undefined, label: undefined }).text).toBe(
      'Redo: nothing to redo',
    );
    expect(text({ type: 'commit', label: 'Edit sketch', step: 40, depth: 0 }).text).toBe(
      'Commit "Edit sketch": step 40',
    );
    expect(text({ type: 'begin', label: 'Move', depth: 2 }).text).toBe('Begin "Move" (depth 2)');
  });

  it('never keeps a name the person chose', () => {
    expect(redactLabel('Change width')).toBe('Change …');
    expect(redactLabel('Replace with Bracket macro')).toBe('Replace with …');
    expect(redactLabel('Import drawing-of-home.dxf')).toBe('Import …');
    expect(redactLabel('Draw')).toBe('Draw');
    expect(redactLabel('x'.repeat(80))).toHaveLength(60);
    expect(text({ type: 'begin', label: 'Change wall_thickness', depth: 1 }).text).toBe(
      'Begin "Change …" (depth 1)',
    );
  });
});

describe('actionLines', () => {
  it('gives seconds since the first entry, the level of a warning, the kind and repeats', () => {
    expect(
      actionLines([
        { t: 5_000, level: 'info', kind: 'tool', text: 'Tool: dimension' },
        { t: 6_250, level: 'warn', kind: 'sketch', text: 'No anchor', repeat: 3 },
        { t: 7_000, level: 'error', kind: 'error', text: 'Uncaught TypeError' },
      ]),
    ).toEqual([
      '   0.000 tool: Tool: dimension',
      '   1.250 WARN sketch: No anchor (×3)',
      '   2.000 ERROR error: Uncaught TypeError',
    ]);
  });
});

describe('watchActions', () => {
  it('logs the open design: its history, mode and tool changes, by id', () => {
    const store = createDocumentStore(createDocument());
    const session = createSessionStore();
    const { log } = testLog();
    const stop = watchActions({ store, session }, log);
    store.getState().dispatch(renameDocument({ name: 'Secret name' }));
    session.getState().enterSketch('f1' as FeatureId);
    session.getState().setTool('dimension');
    session.getState().setTool(undefined);
    store.getState().undo();
    stop();
    store.getState().dispatch(renameDocument({ name: 'After' }));
    session.getState().setTool('line');
    const texts = log.entries().map((e) => `${e.kind}: ${e.text}`);
    expect(texts).toEqual([
      'app: Design opened: 0 features',
      'history: document.rename "Rename document": new step 1',
      'tool: Sketch mode: f1',
      'tool: Tool: dimension',
      'tool: Tool: none',
      'history: Undo step 1 "Rename document"',
      'app: Design closed',
    ]);
    expect(texts.join('\n')).not.toContain('Secret');
  });
});
