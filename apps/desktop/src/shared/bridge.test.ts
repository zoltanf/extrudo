import { describe, expect, it } from 'vitest';
import { createApi, type IpcRendererLike } from '../shared/bridge';
import { CHANNELS } from '../shared/ipc';

/** A fake `ipcRenderer` that records calls and answers the sync ones from a map. */
function fakeIpc(answers: Record<string, (...args: unknown[]) => unknown> = {}) {
  const calls: { channel: string; args: unknown[]; kind: 'invoke' | 'send' | 'sendSync' }[] = [];
  const listeners = new Map<string, ((event: unknown, ...args: unknown[]) => void)[]>();
  const ipc: IpcRendererLike = {
    async invoke(channel, ...args) {
      calls.push({ channel, args, kind: 'invoke' });
      return answers[channel]?.(...args);
    },
    send(channel, ...args) {
      calls.push({ channel, args, kind: 'send' });
    },
    sendSync(channel, ...args) {
      calls.push({ channel, args, kind: 'sendSync' });
      return answers[channel]?.(...args);
    },
    on(channel, listener) {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
    },
    removeListener(channel, listener) {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((l) => l !== listener),
      );
    },
  };
  const emit = (channel: string, ...args: unknown[]) => {
    for (const listener of listeners.get(channel) ?? []) listener({}, ...args);
  };
  return { ipc, calls, emit, listeners };
}

describe('preload bridge (ADR-0075 §1)', () => {
  it('reads the whole preference map through invoke', async () => {
    const { ipc, calls } = fakeIpc({ [CHANNELS.prefsRead]: () => ({ theme: 'dark' }) });
    const api = createApi(ipc);
    expect(await api.prefs.read()).toEqual({ theme: 'dark' });
    expect(calls).toEqual([{ channel: CHANNELS.prefsRead, args: [], kind: 'invoke' }]);
  });

  it('sends preference writes without waiting', () => {
    const { ipc, calls } = fakeIpc();
    createApi(ipc).prefs.write('theme', 'light');
    expect(calls).toEqual([
      { channel: CHANNELS.prefsWrite, args: ['theme', 'light'], kind: 'send' },
    ]);
  });

  it('invokes a store method through the one channel and refuses an unknown one', async () => {
    const { ipc, calls } = fakeIpc({ [CHANNELS.storeCall]: () => 'ok' });
    const api = createApi(ipc);
    await expect(api.store.call('list', [])).resolves.toBe('ok');
    expect(calls[0]).toEqual({ channel: CHANNELS.storeCall, args: ['list', []], kind: 'invoke' });
    await expect(api.store.call('dropDatabase' as never, [])).rejects.toThrow(
      'Unknown store method',
    );
    expect(calls).toHaveLength(1);
  });

  it('invokes a plugin store method through plugin:call and refuses another (P6-03)', async () => {
    const { ipc, calls } = fakeIpc({ [CHANNELS.pluginCall]: () => [] });
    const api = createApi(ipc);
    await expect(api.plugins.call('setEnabled', ['tiny', false])).resolves.toEqual([]);
    expect(calls).toEqual([
      { channel: 'extrudo:plugin:call', args: ['setEnabled', ['tiny', false]], kind: 'invoke' },
    ]);
    await expect(api.plugins.call('save' as never, [])).rejects.toThrow('Unknown plugin method');
    expect(calls).toHaveLength(1);
  });

  it('writes the rescue copy synchronously and reads the list synchronously', () => {
    const { ipc, calls } = fakeIpc({
      [CHANNELS.rescuePut]: () => true,
      [CHANNELS.rescueList]: () => [{ id: 'p1', raw: '{}' }],
    });
    const api = createApi(ipc);
    expect(api.rescue.put('p1', '{}')).toBe(true);
    expect(api.rescue.list()).toEqual([{ id: 'p1', raw: '{}' }]);
    expect(calls.map((c) => c.kind)).toEqual(['sendSync', 'sendSync']);
  });

  it('routes files, storage and folders to their channels', async () => {
    const { ipc, calls } = fakeIpc({
      [CHANNELS.fileDownload]: () => undefined,
      [CHANNELS.filePick]: () => ({ name: 'a.svg', bytes: new Uint8Array([1]) }),
      [CHANNELS.storagePersistence]: () => 'persistent',
      [CHANNELS.foldersCurrent]: () => ({ name: 'Models' }),
      [CHANNELS.folderWrite]: () => ({ modified: 5 }),
    });
    const api = createApi(ipc);
    await api.files.download(new Uint8Array([1]), 'a.3mf');
    expect(await api.files.pick('.svg')).toEqual({ name: 'a.svg', bytes: new Uint8Array([1]) });
    expect(await api.storage.persistence()).toBe('persistent');
    expect(await api.folders.current()).toEqual({ name: 'Models' });
    expect(await api.folders.write('a.extrudo', new Uint8Array([2]))).toEqual({ modified: 5 });
    expect(calls.map((c) => c.channel)).toEqual([
      CHANNELS.fileDownload,
      CHANNELS.filePick,
      CHANNELS.storagePersistence,
      CHANNELS.foldersCurrent,
      CHANNELS.folderWrite,
    ]);
  });

  it('sends the menu model, registers the menu/open-file handlers and unregisters them', () => {
    const { ipc, calls, emit, listeners } = fakeIpc();
    const api = createApi(ipc);
    api.menus.set([{ label: 'File', items: [] }]);
    api.menus.listening(true);
    api.menus.reset();
    expect(calls).toEqual([
      {
        channel: CHANNELS.menuSet,
        args: [[{ label: 'File', items: [] }]],
        kind: 'send',
      },
      { channel: CHANNELS.menuListening, args: [true], kind: 'send' },
      { channel: CHANNELS.menuReset, args: [], kind: 'send' },
    ]);

    const ran: string[] = [];
    const opened: string[] = [];
    api.menus.onRun((id) => ran.push(id));
    api.menus.onOpenFile((file) => opened.push(file.path));
    emit(CHANNELS.menuRun, 'extrude');
    emit(CHANNELS.fileOpenPath, {
      path: '/b.extrudo',
      name: 'b.extrudo',
      bytes: new Uint8Array(),
      modified: 1,
    });
    expect(ran).toEqual(['extrude']);
    expect(opened).toEqual(['/b.extrudo']);
    api.menus.offRun();
    api.menus.offOpenFile();
    emit(CHANNELS.menuRun, 'ignored');
    expect(ran).toEqual(['extrude']);
    expect(listeners.get(CHANNELS.menuRun)).toHaveLength(0);
  });

  it('lists and clears recent files, and subscribe to a changed event (P6-01 slice 2)', async () => {
    const { ipc, calls, emit } = fakeIpc({
      [CHANNELS.recentList]: () => [{ path: '/a.extrudo', name: 'a.extrudo' }],
      [CHANNELS.recentClear]: () => undefined,
    });
    const api = createApi(ipc);
    expect(await api.recent.list()).toEqual([{ path: '/a.extrudo', name: 'a.extrudo' }]);
    await api.recent.clear();
    api.recent.remove('/b.extrudo');
    let changes = 0;
    api.recent.onChanged(() => changes++);
    emit(CHANNELS.recentChanged);
    api.recent.offChanged();
    emit(CHANNELS.recentChanged);
    expect(changes).toBe(1);
    api.app.ready();
    api.app.quit();
    expect(calls.map((c) => c.channel)).toEqual([
      CHANNELS.recentList,
      CHANNELS.recentClear,
      CHANNELS.recentRemove,
      CHANNELS.appReady,
      CHANNELS.appQuit,
    ]);
  });

  it('routes the external-file write, stat and read channels', async () => {
    const { ipc, calls } = fakeIpc({
      [CHANNELS.fileWritePath]: () => ({ modified: 7 }),
      [CHANNELS.fileStatPath]: () => ({ modified: 8 }),
      [CHANNELS.fileReadPath]: () => ({ bytes: new Uint8Array([1]), modified: 9 }),
    });
    const api = createApi(ipc);
    expect(await api.external.write('/tmp/a.extrudo', new Uint8Array([1]))).toEqual({
      modified: 7,
    });
    expect(await api.external.stat('/tmp/a.extrudo')).toEqual({ modified: 8 });
    expect(await api.external.read('/tmp/a.extrudo')).toEqual({
      bytes: new Uint8Array([1]),
      modified: 9,
    });
    expect(calls.map((c) => c.channel)).toEqual([
      CHANNELS.fileWritePath,
      CHANNELS.fileStatPath,
      CHANNELS.fileReadPath,
    ]);
  });

  it('routes the slicer list and open channels (P6-02)', async () => {
    const file = { name: 'a.3mf', bytes: new Uint8Array([1]), format: '3mf' as const };
    const { ipc, calls } = fakeIpc({
      [CHANNELS.slicerList]: () => [{ id: 'cura', path: '/usr/bin/cura' }],
      [CHANNELS.slicerOpen]: () => true,
    });
    const api = createApi(ipc);
    expect(await api.slicer.list()).toEqual([{ id: 'cura', path: '/usr/bin/cura' }]);
    expect(await api.slicer.open(file, 'cura')).toBe(true);
    expect(calls).toEqual([
      { channel: CHANNELS.slicerList, args: [], kind: 'invoke' },
      { channel: CHANNELS.slicerOpen, args: [file, 'cura'], kind: 'invoke' },
    ]);
  });

  it('subscribes to update:status once and sends check, apply and release (P6-01 slice 4)', () => {
    const { ipc, calls, emit, listeners } = fakeIpc();
    const api = createApi(ipc);
    const seen: unknown[] = [];
    api.updates.onStatus((status) => seen.push(status));
    // A second registration replaces the first rather than doubling it.
    api.updates.onStatus((status) => seen.push(status));
    expect(listeners.get(CHANNELS.updateStatus)).toHaveLength(1);
    emit(CHANNELS.updateStatus, { state: 'ready', version: '0.5.0' });
    expect(seen).toEqual([{ state: 'ready', version: '0.5.0' }]);
    api.updates.offStatus();
    emit(CHANNELS.updateStatus, { state: 'idle' });
    expect(seen).toHaveLength(1);

    api.updates.check();
    api.updates.apply();
    api.updates.openRelease();
    expect(calls).toEqual([
      { channel: CHANNELS.updateCheck, args: [], kind: 'send' },
      { channel: CHANNELS.updateApply, args: [], kind: 'send' },
      { channel: CHANNELS.updateRelease, args: [], kind: 'send' },
    ]);
  });

  it('sends a docs path over docs:open (P6-06 S9)', () => {
    const { ipc, calls } = fakeIpc();
    createApi(ipc).docs.open('/tools/extrude/');
    expect(calls).toEqual([
      { channel: CHANNELS.docsOpen, args: ['/tools/extrude/'], kind: 'send' },
    ]);
  });

  it('asks main for Open File…, the recent names and an Open Recent by index and name', async () => {
    const { ipc, calls } = fakeIpc({ [CHANNELS.recentNames]: () => ['a.extrudo'] });
    const api = createApi(ipc);
    api.files.openDialog();
    expect(await api.recent.names()).toEqual(['a.extrudo']);
    api.recent.open(0, 'a.extrudo');
    expect(calls).toEqual([
      { channel: CHANNELS.fileOpenDialog, args: [], kind: 'send' },
      { channel: CHANNELS.recentNames, args: [], kind: 'invoke' },
      { channel: CHANNELS.recentOpen, args: [0, 'a.extrudo'], kind: 'send' },
    ]);
  });
});
