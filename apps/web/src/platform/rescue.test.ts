import { createDocument, type DocumentId } from '@extrudo/core';
import { memoryProjectStore } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { memoryRescue, recoverRescued, webRescue } from './rescue';

function fakeStorage(fail = false): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail) throw new Error('QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (i) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe('webRescue', () => {
  it('keeps one copy per document, lists and clears them', () => {
    const storage = fakeStorage();
    storage.setItem('extrudo.theme', '"dark"');
    const rescue = webRescue(storage);
    const doc = createDocument({ name: 'Plate' });
    expect(rescue.put(doc)).toBe(true);
    expect(rescue.put({ ...doc, name: 'Plate 2' })).toBe(true);
    expect(rescue.list()).toEqual([{ id: doc.id, raw: { ...doc, name: 'Plate 2' } }]);
    rescue.clear(doc.id);
    expect(rescue.list()).toEqual([]);
    expect(storage.getItem('extrudo.theme')).toBe('"dark"');
  });

  it('reports a copy it could not keep', () => {
    expect(webRescue(fakeStorage(true)).put(createDocument({ name: 'Plate' }))).toBe(false);
    expect(webRescue(undefined).put(createDocument({ name: 'Plate' }))).toBe(false);
  });
});

describe('recoverRescued', () => {
  it('saves a copy over its stored project and drops it', async () => {
    const projects = memoryProjectStore();
    const rescue = memoryRescue();
    const doc = createDocument({ name: 'Plate' });
    await projects.save(doc);
    // The edit the page couldn't save before it went away.
    rescue.put({ ...doc, name: 'Plate v2' });

    expect(await recoverRescued(projects, rescue)).toEqual([doc.id]);
    expect((await projects.load(doc.id)).name).toBe('Plate v2');
    expect(rescue.copies.size).toBe(0);
  });

  it('drops a copy that is not a document, and keeps one that fails to save', async () => {
    const projects = memoryProjectStore();
    const rescue = memoryRescue();
    rescue.copies.set('junk', '{"hello":1}');
    const doc = createDocument({ name: 'Plate' });
    rescue.put(doc);
    const failing = { ...projects, save: () => Promise.reject(new Error('quota')) };

    expect(await recoverRescued(failing, rescue)).toEqual([]);
    expect([...rescue.copies.keys()]).toEqual([doc.id as DocumentId]);
    expect(await recoverRescued(projects, rescue)).toEqual([doc.id]);
    expect(rescue.copies.size).toBe(0);
  });
});
