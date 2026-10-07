import { memoryProjectStore, type ProjectStore, sha256Hex } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { isErrorEnvelope } from '../shared/errors';
import { storeCall } from './store-call';

describe('storeCall serialises errors for the bridge (P6-01 review)', () => {
  it('passes a normal answer through', async () => {
    const store = memoryProjectStore();
    expect(await storeCall(store, 'list', [])).toEqual([]);
  });

  it('returns the store’s error classes as data', async () => {
    const store = memoryProjectStore();
    const missing = await storeCall(store, 'load', ['00000000-0000-4000-8000-000000000001']);
    expect(isErrorEnvelope(missing)).toBe(true);
    expect(missing).toMatchObject({
      error: { name: 'ProjectNotFoundError' },
    });

    const archive = await storeCall(store, 'importFile', [new Uint8Array([1, 2, 3])]);
    expect(archive).toMatchObject({ error: { name: 'ArchiveError', code: 'not-a-zip' } });

    const bytes = new Uint8Array([1]);
    const traversal = await storeCall(store, 'writeAttachment', [
      '../../x',
      sha256Hex(bytes),
      bytes,
    ]);
    expect(traversal).toMatchObject({ error: { name: 'StorageError', id: '../../x' } });
  });

  it('keeps an unknown error’s message', async () => {
    const store = {
      load: async () => {
        throw new Error('something else');
      },
    } as unknown as ProjectStore;
    const result = await storeCall(store, 'load', ['x']);
    expect(result).toEqual({ error: { name: 'Error', message: 'something else' } });
  });
});
