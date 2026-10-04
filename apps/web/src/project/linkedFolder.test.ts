import { createDocument, createDocumentStore, renameDocument } from '@extrudo/core';
import { memoryProjectStore, readArchive, writeArchive } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import type { ToastOptions } from '../design-system';
import type { FolderFile, LinkedFolders } from '../platform';
import { createLinkedProject, type LinkedProject } from './linkedFolder';

/** A folder of files in a Map, with the clock the File System Access API gives. */
function fakeFolder(name = 'Designs') {
  const files = new Map<string, { bytes: Uint8Array; modified: number }>();
  let permission: 'granted' | 'prompt' = 'granted';
  const folders: LinkedFolders = {
    link: async () => undefined,
    current: async () => ({
      name,
      permission: async () => permission,
      request: async () => {
        permission = 'granted';
        return true;
      },
      list: async (): Promise<FolderFile[]> =>
        [...files.entries()]
          .map(([file, f]) => ({ name: file, modified: f.modified, size: f.bytes.length }))
          .sort((a, b) => b.modified - a.modified),
      read: async (file) => {
        const entry = files.get(file);
        if (!entry) throw new Error(`${file} isn't in ${name} any more.`);
        return entry;
      },
      write: async (file, bytes) => {
        // A real file system moves its own clock on by at least a tick.
        const modified = (files.get(file)?.modified ?? 0) + 1_000;
        files.set(file, { bytes, modified });
        return { modified };
      },
    }),
    unlink: async () => {},
  };
  return {
    folders,
    files,
    /** Someone else wrote the file, as a synced folder would. */
    change: (file: string, doc = createDocument({ name: 'From disk' })) => {
      files.set(file, { bytes: writeArchive(doc), modified: 9_999 });
    },
    setPermission: (state: 'granted' | 'prompt') => {
      permission = state;
    },
  };
}

/** A saved project in a folder, as the app opens one. */
async function setup(folder = fakeFolder()) {
  const projects = memoryProjectStore();
  const store = createDocumentStore(createDocument({ name: 'Bracket' }));
  await projects.save(store.getState().doc);
  const notifications: { tone: string; text: string; options?: ToastOptions }[] = [];
  const restored: { doc: unknown; label: string }[] = [];
  let clock = 1_000;
  const project: LinkedProject = createLinkedProject({
    folders: folder.folders,
    projects,
    store,
    autosave: { flush: async () => {} },
    notify: (tone, text, options) => notifications.push({ tone, text, options }),
    restore: async (doc, label) => {
      restored.push({ doc, label });
    },
    // The writes are throttled (ADR-0065 §3), so the tests move the clock.
    now: () => clock,
  });
  return {
    folder,
    projects,
    store,
    project,
    notifications,
    restored,
    /** Seconds past the throttle, so the next save writes at once. */
    passThrottle: () => {
      clock += 20_000;
    },
    /** The file's archive, as the document inside it. */
    documentIn: async (file: string) =>
      readArchive(folder.files.get(file)?.bytes ?? new Uint8Array()).doc,
  };
}

describe('a linked project (P4-09, ADR-0065 §3)', () => {
  it('writes the file after a save, and records the link in the index', async () => {
    const t = await setup();
    await t.project.linkNow();
    expect(t.folder.files.has('Bracket.extrudo')).toBe(true);
    expect((await t.projects.get(t.store.getState().doc.id))?.linked).toEqual({
      file: 'Bracket.extrudo',
      modified: 1_000,
    });
    expect(t.notifications).toEqual([
      { tone: 'success', text: 'Saved Bracket.extrudo to the linked folder.', options: undefined },
    ]);
  });

  it('refuses a name that is already in the folder', async () => {
    const t = await setup();
    await t.project.linkNow();
    t.folder.change('Bracket.extrudo');
    const second = await setup(t.folder);
    // The same project name, a folder that already has the file.
    await second.project.linkNow();
    expect(second.notifications).toEqual([
      { tone: 'error', text: 'A file named Bracket.extrudo is already there.', options: undefined },
    ]);
    // Nothing was written: the file on disk is the other one.
    expect((await t.documentIn('Bracket.extrudo')).name).toBe('From disk');
  });

  it('writes the newest design after an edit', async () => {
    const t = await setup();
    await t.project.linkNow();
    t.store.getState().dispatch(renameDocument({ name: 'Wall hook' }));
    // The project index keeps the link under the name the file has.
    await t.projects.save(t.store.getState().doc);
    t.passThrottle();
    await t.project.afterSave();
    expect((await t.documentIn('Bracket.extrudo')).name).toBe('Wall hook');
  });

  it('says the file changed on disk, and offers both ways out', async () => {
    const t = await setup();
    await t.project.linkNow();
    t.store.getState().dispatch(renameDocument({ name: 'Mine' }));
    await t.projects.save(t.store.getState().doc);
    t.folder.change('Bracket.extrudo');
    t.passThrottle();
    await t.project.afterSave();

    const toast = t.notifications.at(-1);
    expect(toast?.tone).toBe('error');
    expect(toast?.text).toBe('Bracket.extrudo changed on disk.');
    const actions = toast?.options?.actions ?? [];
    expect(actions.map((a) => a.label)).toEqual(['Load from disk', 'Overwrite']);
    // Nothing was written: the other document is still the file's.
    expect((await t.documentIn('Bracket.extrudo')).name).toBe('From disk');
    for (const action of actions) expect(action.available?.()).toBe(true);

    // Overwrite takes the file as it is now and writes over it.
    actions[1]?.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await t.documentIn('Bracket.extrudo')).name).toBe('Mine');
    // Both buttons are spent.
    for (const action of actions) expect(action.available?.()).toBe(false);
  });

  it('Load from disk brings the file in as one undo step', async () => {
    const t = await setup();
    await t.project.linkNow();
    t.store.getState().dispatch(renameDocument({ name: 'Mine' }));
    await t.projects.save(t.store.getState().doc);
    t.folder.change('Bracket.extrudo');
    t.passThrottle();
    await t.project.afterSave();
    const action = t.notifications.at(-1)?.options?.actions?.[0];
    expect(action?.label).toBe('Load from disk');
    action?.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.restored).toHaveLength(1);
    expect(t.restored[0]?.label).toBe('Bracket.extrudo');
    // The file's own document, under this project's ID.
    expect(t.restored[0]?.doc).toMatchObject({
      id: t.store.getState().doc.id,
      name: 'From disk',
    });
    expect(t.notifications.at(-1)).toMatchObject({
      tone: 'success',
      text: 'Loaded Bracket.extrudo from the linked folder.',
    });
  });

  it('says a folder it may not write to, and keeps the browser copy', async () => {
    const t = await setup();
    await t.project.linkNow();
    t.folder.setPermission('prompt');
    t.passThrottle();
    await t.project.afterSave();
    expect(t.notifications.at(-1)).toMatchObject({
      tone: 'error',
      text: 'Extrudo may not write to Designs yet. Reconnect it on the home screen.',
    });
  });
});
