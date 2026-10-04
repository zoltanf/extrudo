import { describe, expect, it, vi } from 'vitest';
import type { ToastOptions, ToastTone } from '../design-system/notifications';
import {
  BLOCKED_TEXT,
  closedStorage,
  DATABASE_TOAST_MS,
  STORAGE_CLOSED_TEXT,
  showBlocked,
  showUpdatedElsewhere,
  UPDATED_ELSEWHERE_TEXT,
} from './databaseNotice';

/** A push that keeps what it was given, and hands out toast IDs. */
function pusher() {
  const sent: { tone: ToastTone; text: string; options?: ToastOptions }[] = [];
  let next = 1;
  const push = (tone: ToastTone, text: string, options?: ToastOptions) => {
    sent.push({ tone, text, options });
    return next++;
  };
  return { push, sent };
}

const deps = () => {
  const { push, sent } = pusher();
  return {
    deps: {
      push,
      saveEverything: vi.fn(async () => true),
      reload: vi.fn(),
      unsaved: vi.fn(),
    },
    sent,
  };
};

describe('the storage upgrade notices (P4-09)', () => {
  it('hands back the toast to take away once the open goes through', () => {
    const { push } = pusher();
    expect(showBlocked(push)).toBeGreaterThan(0);
  });

  it('words the blocked open, with a long life', () => {
    const { push, sent } = pusher();
    showBlocked(push);
    expect(sent).toEqual([
      { tone: 'info', text: BLOCKED_TEXT, options: { lifetime: DATABASE_TOAST_MS } },
    ]);
    expect(BLOCKED_TEXT).toContain('other tabs');
  });

  it('saves, then asks for a reload when another tab upgraded the database', async () => {
    const d = deps();
    showUpdatedElsewhere(d.deps);
    // The save starts as the callback runs: the connection closes right after.
    expect(d.deps.saveEverything).toHaveBeenCalledOnce();
    const toast = d.sent.at(-1);
    expect(toast).toMatchObject({ tone: 'info', text: UPDATED_ELSEWHERE_TEXT });
    toast?.options?.action?.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(d.deps.saveEverything).toHaveBeenCalledTimes(2);
    expect(d.deps.reload).toHaveBeenCalledOnce();
    expect(d.deps.unsaved).not.toHaveBeenCalled();
  });

  it('does not reload when a save failed', async () => {
    const d = deps();
    d.deps.saveEverything.mockResolvedValue(false);
    showUpdatedElsewhere(d.deps);
    d.sent.at(-1)?.options?.action?.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(d.deps.reload).not.toHaveBeenCalled();
    expect(d.deps.unsaved).toHaveBeenCalledOnce();
  });

  it('says the same thing as the toast when the closed connection is used', async () => {
    const store = {
      async save() {
        throw new DOMException(
          "Failed to execute 'transaction' on 'IDBDatabase'.",
          'InvalidStateError',
        );
      },
      list: async () => [],
      name: 'real property',
    };
    const closed = closedStorage(store, STORAGE_CLOSED_TEXT);
    expect(closed.name).toBe('real property');
    await expect(closed.list()).resolves.toEqual([]);
    await expect(closed.save()).rejects.toThrow(UPDATED_ELSEWHERE_TEXT);
    // A method that throws synchronously is caught the same way.
    const broken = closedStorage(
      {
        get(): string {
          throw new DOMException('The database connection is closing.', 'InvalidStateError');
        },
      },
      STORAGE_CLOSED_TEXT,
    );
    expect(() => broken.get()).toThrow(UPDATED_ELSEWHERE_TEXT);
  });

  it('leaves every other message alone', async () => {
    const store = {
      load: async () => {
        throw new Error("This project doesn't exist. It may have been deleted.");
      },
      save: async () => {
        throw new DOMException(
          'The browser is out of storage space for this site.',
          'QuotaExceededError',
        );
      },
    };
    const closed = closedStorage(store, STORAGE_CLOSED_TEXT);
    await expect(closed.load()).rejects.toThrow("This project doesn't exist.");
    await expect(closed.save()).rejects.toThrow('out of storage space');
  });
});
