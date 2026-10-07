import { describe, expect, it } from 'vitest';
import { createApi, type IpcRendererLike } from '../shared/bridge';
import { CHANNELS } from '../shared/ipc';

/** A fake `ipcRenderer` that records calls and answers the sync ones from a map. */
function fakeIpc(answers: Record<string, (...args: unknown[]) => unknown> = {}) {
  const calls: { channel: string; args: unknown[]; kind: 'invoke' | 'send' | 'sendSync' }[] = [];
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
  };
  return { ipc, calls };
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
});
