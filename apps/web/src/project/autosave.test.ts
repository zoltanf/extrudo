import { createDocument, createDocumentStore, renameDocument } from '@extrudo/core';
import { memoryProjectStore, type ProjectStore } from '@extrudo/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Autosaver, createAutosaver, saveEverything } from './autosave';

beforeEach(() => {
  vi.useFakeTimers();
});
const created: Autosaver[] = [];
afterEach(() => {
  vi.useRealTimers();
  // Each test's autosavers leave the registry `saveEverything` reads.
  for (const autosaver of created.splice(0)) autosaver.dispose();
});

async function setup(projects: ProjectStore = memoryProjectStore()) {
  const doc = createDocument({ name: 'Bracket' });
  await projects.save(doc);
  const store = createDocumentStore(doc);
  const thumbnail = vi.fn(async () => new Blob([new Uint8Array([137, 80, 78, 71])]));
  const autosaver = createAutosaver({ store, projects, delay: 500, thumbnail });
  created.push(autosaver);
  const rename = (name: string) => store.getState().dispatch(renameDocument({ name }));
  const saved = async () => (await projects.load(doc.id)).name;
  return { doc, store, projects, autosaver, rename, saved, thumbnail };
}

describe('autosave', () => {
  it('saves once, shortly after the edits stop', async () => {
    const projects = memoryProjectStore();
    const save = vi.spyOn(projects, 'save');
    const { autosaver, rename, saved, thumbnail } = await setup(projects);
    save.mockClear();
    expect(autosaver.getState().status).toBe('saved');

    rename('One');
    await vi.advanceTimersByTimeAsync(300);
    rename('Two');
    expect(autosaver.getState().status).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(300);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosaver.getState().status).toBe('saved');
    expect(autosaver.getState().savedAt).toBeDefined();
    expect(await saved()).toBe('Two');
    // The thumbnail follows in idle time, off the save's path (ADR-0102 §1).
    expect(thumbnail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(thumbnail).toHaveBeenCalledTimes(1);
  });

  it('saves undo and redo too', async () => {
    const { store, autosaver, rename, saved } = await setup();
    rename('Renamed');
    await autosaver.flush();
    store.getState().undo();
    expect(autosaver.getState().status).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(600);
    expect(await saved()).toBe('Bracket');
  });

  it('saves a change made during a save right after it', async () => {
    const projects = memoryProjectStore();
    const { autosaver, rename, saved } = await setup(projects);
    const realSave = projects.save.bind(projects);
    const gates: (() => void)[] = [];
    vi.spyOn(projects, 'save').mockImplementation(async (doc) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return realSave(doc);
    });

    rename('First');
    await vi.advanceTimersByTimeAsync(600);
    expect(autosaver.getState().status).toBe('saving');

    rename('Second');
    gates.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(autosaver.getState().status).toBe('unsaved');
    expect(await saved()).toBe('First');

    await vi.advanceTimersByTimeAsync(600);
    gates.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(autosaver.getState().status).toBe('saved');
    expect(await saved()).toBe('Second');
  });

  it('reports a failed save, and retries on the next change', async () => {
    const projects = memoryProjectStore();
    const { autosaver, rename, saved } = await setup(projects);
    const save = vi
      .spyOn(projects, 'save')
      .mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));

    rename('Lost?');
    await vi.advanceTimersByTimeAsync(600);
    expect(autosaver.getState()).toMatchObject({
      status: 'error',
      error: 'The browser is out of storage space for this site.',
    });

    rename('Kept');
    expect(autosaver.getState().status).toBe('error');
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosaver.getState().status).toBe('saved');
    expect(await saved()).toBe('Kept');
  });

  it('retry saves at once after a failure', async () => {
    const projects = memoryProjectStore();
    const { autosaver, rename, saved } = await setup(projects);
    vi.spyOn(projects, 'save').mockRejectedValueOnce(new Error('Disk trouble'));
    rename('Again');
    await vi.advanceTimersByTimeAsync(600);
    expect(autosaver.getState().error).toBe('Disk trouble');
    await autosaver.retry();
    expect(autosaver.getState().status).toBe('saved');
    expect(await saved()).toBe('Again');
  });

  it('flush saves pending changes immediately; dispose stops watching', async () => {
    const { autosaver, rename, saved } = await setup();
    rename('Flushed');
    await autosaver.flush();
    expect(await saved()).toBe('Flushed');
    await autosaver.flush();

    autosaver.dispose();
    rename('After dispose');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await saved()).toBe('Flushed');
  });

  it('keeps saving when the thumbnail fails', async () => {
    const projects = memoryProjectStore();
    const doc = createDocument({ name: 'Bracket' });
    await projects.save(doc);
    const store = createDocumentStore(doc);
    const autosaver = createAutosaver({
      store,
      projects,
      thumbnail: () => Promise.reject(new Error('no WebGL')),
    });
    created.push(autosaver);
    store.getState().dispatch(renameDocument({ name: 'Still saved' }));
    await autosaver.flush();
    expect(autosaver.getState().status).toBe('saved');
    expect((await projects.get(doc.id))?.hasThumbnail).toBe(false);
  });

  describe('the thumbnail (ADR-0102 §1)', () => {
    async function thumbnails() {
      const projects = memoryProjectStore();
      const doc = createDocument({ name: 'Bracket' });
      await projects.save(doc);
      const store = createDocumentStore(doc);
      const take = vi.fn(async () => new Blob([new Uint8Array([137, 80, 78, 71])]));
      const setThumbnail = vi.spyOn(projects, 'setThumbnail');
      const view = { camera: { target: [0, 0, 0] } };
      // Stands in for the document object (in the app every change makes a new one).
      const picture = { doc: {} };
      let ready = true;
      const autosaver = createAutosaver({
        store,
        projects,
        delay: 500,
        thumbnail: take,
        thumbnailKey: () => [picture.doc, view.camera],
        thumbnailReady: () => ready,
      });
      created.push(autosaver);
      const rename = (name: string) => store.getState().dispatch(renameDocument({ name }));
      return {
        picture,
        autosaver,
        rename,
        take,
        setThumbnail,
        view,
        busy: (b: boolean) => {
          ready = !b;
        },
      };
    }

    it('skips a save whose picture would not change, takes one after a camera-only change', async () => {
      const { autosaver, rename, take, setThumbnail, view, picture } = await thumbnails();
      rename('One');
      await autosaver.flush();
      expect(take).toHaveBeenCalledTimes(1);
      expect(setThumbnail).toHaveBeenCalledTimes(1);

      // A change the picture doesn't show: no thumbnail.
      rename('Two');
      await vi.advanceTimersByTimeAsync(1000);
      expect(autosaver.getState().status).toBe('saved');
      expect(take).toHaveBeenCalledTimes(1);

      // Only the camera moved: the next save takes one.
      view.camera = { target: [1, 0, 0] };
      rename('Three');
      await vi.advanceTimersByTimeAsync(1000);
      expect(take).toHaveBeenCalledTimes(2);

      // The document the picture shows changed.
      picture.doc = {};
      rename('Four');
      await vi.advanceTimersByTimeAsync(1000);
      expect(take).toHaveBeenCalledTimes(3);
    });

    it('waits while the app is busy, then takes one for several saves', async () => {
      const { autosaver, rename, take, busy } = await thumbnails();
      busy(true);
      rename('One');
      await vi.advanceTimersByTimeAsync(800);
      expect(autosaver.getState().status).toBe('saved');
      rename('Two');
      await vi.advanceTimersByTimeAsync(2000);
      expect(take).not.toHaveBeenCalled();
      busy(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(take).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(take).toHaveBeenCalledTimes(1);
    });

    it('flush takes a pending thumbnail at once, busy or not', async () => {
      const { autosaver, rename, take, setThumbnail, busy } = await thumbnails();
      busy(true);
      rename('One');
      await autosaver.flush();
      expect(take).toHaveBeenCalledTimes(1);
      expect(setThumbnail).toHaveBeenCalledTimes(1);
    });

    it('takes no thumbnail after dispose', async () => {
      const { autosaver, rename, take } = await thumbnails();
      rename('One');
      await vi.advanceTimersByTimeAsync(500);
      autosaver.dispose();
      await vi.advanceTimersByTimeAsync(1000);
      expect(take).not.toHaveBeenCalled();
    });
  });

  describe('saveEverything (before a reload the person asked for)', () => {
    it('saves every open design and says everything is stored', async () => {
      const a = await setup();
      const b = await setup();
      a.rename('First');
      b.rename('Second');
      expect(await saveEverything()).toBe(true);
      expect(await a.saved()).toBe('First');
      expect(await b.saved()).toBe('Second');
      a.autosaver.dispose();
      b.autosaver.dispose();
    });

    it('says no while a save fails, so nothing reloads over unsaved work', async () => {
      const projects = memoryProjectStore();
      const a = await setup(projects);
      vi.spyOn(projects, 'save').mockRejectedValue(new Error('disk full'));
      a.rename('Unsaved');
      expect(await saveEverything()).toBe(false);
      expect(a.autosaver.getState().status).toBe('error');
      a.autosaver.dispose();
      // A disposed autosaver no longer counts.
      expect(await saveEverything()).toBe(true);
    });
  });
});
