import { describe, expect, it, vi } from 'vitest';
import type { ExtrudoApi, OpenedFile } from '../shared/ipc';
import { desktopMenus } from './menus';

function fakeApi() {
  const set = vi.fn();
  const reset = vi.fn();
  const listening = vi.fn();
  const onRun = vi.fn();
  const offRun = vi.fn();
  const onOpenFile = vi.fn();
  const offOpenFile = vi.fn();
  const remove = vi.fn();
  const quit = vi.fn();
  const api = {
    menus: { set, reset, listening, onRun, offRun, onOpenFile, offOpenFile },
    recent: { remove },
    app: { ready: vi.fn(), quit },
  } as unknown as ExtrudoApi;
  return {
    api,
    mocks: {
      set,
      reset,
      listening,
      onRun,
      offRun,
      onOpenFile,
      offOpenFile,
      remove,
      quit,
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const model = [{ label: 'File', items: [] }];

describe('desktopMenus (P6-01 slice 2)', () => {
  it("sends the model alone, debounced (Open Recent is main's list)", async () => {
    const { api, mocks } = fakeApi();
    const menus = desktopMenus(api, 0);
    menus.set(model);
    await flush();
    expect(mocks.set).toHaveBeenCalledWith(model);
    // No second argument can carry a recent path from the renderer.
    expect(mocks.set.mock.calls[0]).toHaveLength(1);
  });

  it('reset cancels a pending send and forgets the model', async () => {
    const { api, mocks } = fakeApi();
    const menus = desktopMenus(api, 20);
    menus.set(model);
    menus.reset();
    await flush();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.reset).toHaveBeenCalledOnce();
    // A later mode change still sends (the model is set again).
    menus.set(model);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(mocks.set).toHaveBeenCalledWith(model);
  });

  it('passes run and open-file handlers through and unsubscribes, and quits', () => {
    const { api, mocks } = fakeApi();
    const menus = desktopMenus(api, 0);
    const run = (id: string) => void id;
    const offRun = menus.onRun(run);
    expect(mocks.onRun).toHaveBeenCalledWith(run);
    offRun();
    expect(mocks.offRun).toHaveBeenCalledOnce();

    const opened: OpenedFile[] = [];
    menus.onOpenFile((file) => opened.push(file));
    expect(mocks.onOpenFile).toHaveBeenCalledOnce();

    menus.listening(true);
    expect(mocks.listening).toHaveBeenCalledWith(true);
    menus.forgetRecent('/tmp/corrupt.extrudo');
    expect(mocks.remove).toHaveBeenCalledWith('/tmp/corrupt.extrudo');
    menus.quit();
    expect(mocks.quit).toHaveBeenCalledOnce();
  });
});
